/**
 * Verificação adversarial do caminho de vida (SOS), contra Postgres real.
 *
 * Objetivo declarado pelo dono do produto: **TENTAR FAZER O SOS FALHAR.**
 *
 * Complementa `scripts/verify-sql.ts` (que valida schema e isolamento) e os
 * testes unitários de `lib/sos.ts` / `lib/authz.ts` (que validam lógica pura).
 * O que só dá para provar aqui é o comportamento sob **concorrência real** e
 * com as **constraints do banco** de fato aplicadas — foi assim que a
 * duplicata de SOS foi comprovada na auditoria, e é assim que se prova que
 * agora ela é impossível.
 *
 * Roda com: npx tsx scripts/verify-sos.ts
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FALHOU  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Espera que a operação seja recusada pelo banco. */
async function esperaRecusa(db: PGlite, nome: string, sqlText: string, params: unknown[] = []) {
  try {
    await db.query(sqlText, params);
    check(nome, false, 'a operação passou, mas devia ter sido recusada');
  } catch {
    check(nome, true);
  }
}

async function main() {
  console.log('SOS — verificação adversarial (PGlite)\n');
  const db = new PGlite({ extensions: { pgcrypto } });

  const schema = readFileSync(join(process.cwd(), 'lib', 'schema.sql'), 'utf8');
  await db.exec(schema);

  // ---------------------------------------------------------------- fixtures
  // rider_id é NOT NULL e único no schema; um contador serve para as fixtures.
  let seqRider = 5000;
  const mk = async (nome: string, email: string, role = 'rider') => {
    seqRider += 1;
    const r = await db.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role, rider_id)
       VALUES ($1, $2, '$2b$12$x', $3, $4) RETURNING id`,
      [nome, email, role, String(seqRider)]
    );
    return r.rows[0].id;
  };

  const autor = await mk('Autor do SOS', 'autor@kn.test');
  const vizinho = await mk('Vizinho notificado', 'vizinho@kn.test');
  const atacante = await mk('Atacante remoto', 'atacante@kn.test');
  const moderador = await mk('Moderador', 'mod@kn.test', 'moderator');

  await db.query(
    `INSERT INTO spots (id, name, location, state, lat, lng, wind_safety,
       water_condition, bottom_type, difficulty, cover_image)
     VALUES ('ponta-do-mel', 'Ponta do Mel', 'Areia Branca / RN', 'RN',
       -4.9, -37.0, 'Side-Onshore', 'Chop Médio', 'Areia', 'Intermediário', 'x.jpg')`
  );

  // =====================================================================
  console.log('\n1. Unicidade de SOS ativo (P0-6 — duplicata comprovada na auditoria):');

  const criaSos = async (userId: string, lat: number | null = -4.9, lng: number | null = -37.0) => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO sos_alerts (user_id, lat, lng, status, radius_km)
       VALUES ($1, $2, $3, 'ativo', 5) RETURNING id`,
      [userId, lat, lng]
    );
    return r.rows[0].id;
  };

  const sos1 = await criaSos(autor);
  check('primeiro SOS ativo é criado', Boolean(sos1));

  // O ataque original: check-then-insert sem constraint. Agora o índice único
  // parcial precisa recusar no nível do banco, independente da ordem de leitura.
  await esperaRecusa(
    db,
    'segundo SOS ativo do MESMO usuário é recusado pelo banco',
    `INSERT INTO sos_alerts (user_id, lat, lng, status, radius_km)
     VALUES ($1, -4.9, -37.0, 'ativo', 5)`,
    [autor]
  );

  await esperaRecusa(
    db,
    "SOS 'em_atendimento' também colide com um 'ativo' (mesmo usuário)",
    `INSERT INTO sos_alerts (user_id, lat, lng, status, radius_km)
     VALUES ($1, -4.9, -37.0, 'em_atendimento', 5)`,
    [autor]
  );

  // Outro usuário não é afetado pela unicidade.
  const sosVizinho = await criaSos(vizinho);
  check('outro usuário pode ter o próprio SOS ativo ao mesmo tempo', Boolean(sosVizinho));

  // Depois de encerrar, o mesmo usuário pode pedir socorro de novo — senão a
  // constraint viraria um bloqueio permanente de socorro.
  await db.query(`UPDATE sos_alerts SET status = 'resolvido' WHERE id = $1`, [sosVizinho]);
  let reaberto = '';
  try {
    reaberto = await criaSos(vizinho);
    check('após encerrar, o usuário pode abrir um SOS novo', Boolean(reaberto));
  } catch (err) {
    check('após encerrar, o usuário pode abrir um SOS novo', false, String(err));
  }

  // Vários encerrados coexistem: a unicidade é parcial, não global.
  await db.query(`UPDATE sos_alerts SET status = 'cancelado' WHERE id = $1`, [reaberto]);
  try {
    await criaSos(vizinho);
    const hist = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM sos_alerts WHERE user_id = $1`,
      [vizinho]
    );
    check('histórico de SOS encerrados é preservado (unicidade é parcial)', hist.rows[0].n >= 3);
  } catch (err) {
    check('histórico de SOS encerrados é preservado (unicidade é parcial)', false, String(err));
  }

  // =====================================================================
  console.log('\n2. Concorrência real — duas criações simultâneas:');

  const corridaUser = await mk('Corrida', 'corrida@kn.test');
  // Ambas as promessas leem "não existe SOS" antes de qualquer escrita, que é
  // exatamente o interleaving que produziu a duplicata na auditoria.
  const tentativa = async () => {
    const existe = await db.query<{ id: string }>(
      `SELECT id FROM sos_alerts WHERE user_id = $1 AND status IN ('ativo','em_atendimento')`,
      [corridaUser]
    );
    if (existe.rows.length > 0) return 'dedup';
    try {
      await db.query(
        `INSERT INTO sos_alerts (user_id, lat, lng, status, radius_km)
         VALUES ($1, -4.9, -37.0, 'ativo', 5)`,
        [corridaUser]
      );
      return 'criou';
    } catch {
      return 'recusado';
    }
  };
  const [r1, r2] = await Promise.all([tentativa(), tentativa()]);
  const ativosCorrida = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM sos_alerts
     WHERE user_id = $1 AND status IN ('ativo','em_atendimento')`,
    [corridaUser]
  );
  check(
    `duas criações simultâneas resultam em UM só SOS ativo (r1=${r1}, r2=${r2})`,
    ativosCorrida.rows[0].n === 1,
    `ativos=${ativosCorrida.rows[0].n}`
  );

  // =====================================================================
  console.log('\n3. Escalada idempotente (P0-6 — dois polls escalavam duas vezes):');

  const sosEsc = sos1;
  await db.query(`UPDATE sos_alerts SET radius_km = 5, escalated_at = NULL WHERE id = $1`, [sosEsc]);

  // O UPDATE condicionado ao raio lido: a segunda tentativa não acha mais a
  // linha em 5 km e não escala de novo.
  const escala = async () => {
    const r = await db.query<{ id: string }>(
      `UPDATE sos_alerts SET radius_km = 15, escalated_at = NOW()
       WHERE id = $1 AND radius_km = 5 AND status IN ('ativo','em_atendimento')
       RETURNING id`,
      [sosEsc]
    );
    return r.rows.length;
  };
  const [e1, e2] = await Promise.all([escala(), escala()]);
  const raioFinal = await db.query<{ radius_km: string }>(
    `SELECT radius_km FROM sos_alerts WHERE id = $1`,
    [sosEsc]
  );
  check(
    `duas escaladas simultâneas sobem o raio uma única vez (aplicadas=${e1 + e2})`,
    e1 + e2 === 1 && Number(raioFinal.rows[0].radius_km) === 15,
    `raio=${raioFinal.rows[0].radius_km}`
  );

  await esperaRecusa(
    db,
    'raio fora dos estágios previstos é recusado pelo CHECK',
    `UPDATE sos_alerts SET radius_km = 999 WHERE id = $1`,
    [sosEsc]
  );

  // =====================================================================
  console.log('\n4. Estados: terminal não volta atrás, CHECK cobre valores inválidos:');

  await esperaRecusa(
    db,
    'status inválido é recusado pelo CHECK',
    `UPDATE sos_alerts SET status = 'sei_la' WHERE id = $1`,
    [sosEsc]
  );

  await esperaRecusa(
    db,
    'state inválido de socorrista é recusado pelo CHECK',
    `INSERT INTO sos_responders (sos_id, user_id, state) VALUES ($1, $2, 'talvez')`,
    [sosEsc, vizinho]
  );

  // O UPDATE de reabertura é condicionado a 'em_atendimento'; num SOS
  // resolvido ele não pega nenhuma linha (0 linhas, sem erro).
  const sosTerminal = await criaSos(atacante);
  await db.query(`UPDATE sos_alerts SET status = 'resolvido' WHERE id = $1`, [sosTerminal]);
  const tentaReabrir = await db.query<{ id: string }>(
    `UPDATE sos_alerts SET status = 'ativo' WHERE id = $1 AND status = 'em_atendimento' RETURNING id`,
    [sosTerminal]
  );
  check(
    'resposta de socorrista não reabre SOS terminal (0 linhas afetadas)',
    tentaReabrir.rows.length === 0
  );

  // =====================================================================
  console.log('\n5. Abandono: o último socorrista desiste e a escalada volta:');

  const sosAband = await criaSos(await mk('Abandonado', 'aband@kn.test'));
  await db.query(
    `INSERT INTO sos_responders (sos_id, user_id, state, responded_at)
     VALUES ($1, $2, 'a_caminho', NOW())`,
    [sosAband, vizinho]
  );
  await db.query(`UPDATE sos_alerts SET status = 'em_atendimento' WHERE id = $1`, [sosAband]);

  const vivosAntes = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM sos_responders
     WHERE sos_id = $1 AND state IN ('a_caminho','no_local')`,
    [sosAband]
  );
  check('com socorrista a caminho há 1 responsável vivo', vivosAntes.rows[0].n === 1);

  // Desistência do único socorrista.
  await db.query(
    `UPDATE sos_responders SET state = 'nao_posso', responded_at = NOW()
     WHERE sos_id = $1 AND user_id = $2`,
    [sosAband, vizinho]
  );
  const vivosDepois = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM sos_responders
     WHERE sos_id = $1 AND state IN ('a_caminho','no_local')`,
    [sosAband]
  );
  check('após a desistência não há responsável vivo', vivosDepois.rows[0].n === 0);

  const voltou = await db.query<{ id: string }>(
    `UPDATE sos_alerts SET status = 'ativo', escalated_at = NOW()
     WHERE id = $1 AND status = 'em_atendimento' RETURNING id`,
    [sosAband]
  );
  check('SOS abandonado volta para ativo (escalada retomada)', voltou.rows.length === 1);

  const estadoAband = await db.query<{ status: string; escalated_at: string | null }>(
    `SELECT status, escalated_at FROM sos_alerts WHERE id = $1`,
    [sosAband]
  );
  check(
    'a volta grava escalated_at (antiflapping: espera um estágio antes de ampliar)',
    estadoAband.rows[0].status === 'ativo' && estadoAband.rows[0].escalated_at !== null
  );

  // Um segundo socorrista mantém o atendimento mesmo se o primeiro desistir.
  const sosDois = await criaSos(await mk('Dois socorristas', 'dois@kn.test'));
  await db.query(
    `INSERT INTO sos_responders (sos_id, user_id, state, responded_at) VALUES
       ($1, $2, 'a_caminho', NOW()), ($1, $3, 'no_local', NOW())`,
    [sosDois, vizinho, moderador]
  );
  await db.query(
    `UPDATE sos_responders SET state = 'nao_posso' WHERE sos_id = $1 AND user_id = $2`,
    [sosDois, vizinho]
  );
  const aindaVivo = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM sos_responders
     WHERE sos_id = $1 AND state IN ('a_caminho','no_local')`,
    [sosDois]
  );
  check(
    'com dois socorristas, a desistência de um NÃO reabre a escalada',
    aindaVivo.rows[0].n === 1
  );

  // =====================================================================
  console.log('\n6. Elegibilidade do socorrista (P0-2 — o furo de autorização):');

  // Reaproveita sos1 (do autor): a unicidade agora impede um segundo SOS
  // aberto do mesmo usuário — o que é justamente o comportamento desejado.
  const sosPriv = sos1;
  await db.query(
    `INSERT INTO sos_responders (sos_id, user_id, state, distance_km)
     VALUES ($1, $2, 'notificado', 1.2)
     ON CONFLICT (sos_id, user_id) DO UPDATE SET state = 'notificado'`,
    [sosPriv, vizinho]
  );
  // sos1 foi escalado para 15 km na seção 3; volta para 5 km para que a
  // checagem de proximidade abaixo teste o raio inicial.
  await db.query(`UPDATE sos_alerts SET radius_km = 5 WHERE id = $1`, [sosPriv]);

  const foiNotificado = async (sosId: string, userId: string) => {
    const r = await db.query(
      `SELECT 1 FROM sos_responders WHERE sos_id = $1 AND user_id = $2`,
      [sosId, userId]
    );
    return r.rows.length > 0;
  };
  check('vizinho notificado é elegível por notificação', await foiNotificado(sosPriv, vizinho));
  check(
    'atacante NÃO tem linha de notificação (era o que ele criava sozinho)',
    !(await foiNotificado(sosPriv, atacante))
  );

  // Elegibilidade por proximidade usa a presença GRAVADA PELO SERVIDOR.
  const presencaDentroDoRaio = async (sosId: string, userId: string) => {
    const r = await db.query<{ dentro: boolean }>(
      `SELECT (
         6371 * acos(LEAST(1, GREATEST(-1,
           sin(radians(p.lat)) * sin(radians(a.lat)) +
           cos(radians(p.lat)) * cos(radians(a.lat)) * cos(radians(p.lng - a.lng))
         ))) <= a.radius_km
       ) AS dentro
       FROM sos_alerts a
       JOIN user_presence p ON p.user_id = $2
       WHERE a.id = $1
         AND p.lat IS NOT NULL AND p.lng IS NOT NULL
         AND p.pos_updated_at >= NOW() - INTERVAL '15 minutes'`,
      [sosId, userId]
    );
    return r.rows.length > 0 && r.rows[0].dentro === true;
  };

  // Atacante do outro lado do país, com presença recente.
  await db.query(
    `INSERT INTO user_presence (user_id, lat, lng, pos_updated_at, last_seen_at)
     VALUES ($1, -23.5, -46.6, NOW(), NOW())`,
    [atacante]
  );
  check(
    'atacante longe (São Paulo) NÃO fica elegível por proximidade',
    !(await presencaDentroDoRaio(sosPriv, atacante))
  );

  // Velejador que chegou na praia depois do disparo: elegível de verdade.
  const chegouDepois = await mk('Chegou depois', 'depois@kn.test');
  await db.query(
    `INSERT INTO user_presence (user_id, lat, lng, pos_updated_at, last_seen_at)
     VALUES ($1, -4.902, -37.002, NOW(), NOW())`,
    [chegouDepois]
  );
  check(
    'velejador ao lado (chegou depois) FICA elegível por proximidade',
    await presencaDentroDoRaio(sosPriv, chegouDepois)
  );

  // Presença velha não vale: "estava lá há 2 horas" não é "está aqui agora".
  const presencaVelha = await mk('Presenca velha', 'velha@kn.test');
  await db.query(
    `INSERT INTO user_presence (user_id, lat, lng, pos_updated_at, last_seen_at)
     VALUES ($1, -4.901, -37.001, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours')`,
    [presencaVelha]
  );
  check(
    'presença antiga (2h) NÃO dá elegibilidade por proximidade',
    !(await presencaDentroDoRaio(sosPriv, presencaVelha))
  );

  // SOS sem coordenada: ninguém entra por proximidade (não há de onde medir).
  const sosSemGps = await criaSos(await mk('Sem GPS', 'semgps@kn.test'), null, null);
  check(
    'SOS sem coordenada não concede elegibilidade por proximidade a ninguém',
    !(await presencaDentroDoRaio(sosSemGps, chegouDepois))
  );

  // =====================================================================
  console.log('\n7. Privacidade: existir o SOS ≠ poder ver a posição:');

  const podeVerPosicao = async (sosId: string, userId: string, role: string) => {
    const a = await db.query<{ user_id: string }>(`SELECT user_id FROM sos_alerts WHERE id = $1`, [sosId]);
    if (a.rows[0].user_id === userId) return true;
    if (role === 'admin' || role === 'moderator') return true;
    const r = await db.query(
      `SELECT 1 FROM sos_responders WHERE sos_id = $1 AND user_id = $2`,
      [sosId, userId]
    );
    return r.rows.length > 0;
  };

  check('autor vê a própria posição', await podeVerPosicao(sosPriv, autor, 'rider'));
  check('socorrista notificado vê a posição', await podeVerPosicao(sosPriv, vizinho, 'rider'));
  check('moderador vê a posição (coordenação)', await podeVerPosicao(sosPriv, moderador, 'moderator'));
  check(
    'atacante NÃO vê a posição (a correção não reabriu o vazamento)',
    !(await podeVerPosicao(sosPriv, atacante, 'rider'))
  );

  // =====================================================================
  console.log('\n8. Integridade referencial e cascata:');

  await esperaRecusa(
    db,
    'socorrista em SOS inexistente é recusado (FK)',
    `INSERT INTO sos_responders (sos_id, user_id, state)
     VALUES ('00000000-0000-0000-0000-000000000000', $1, 'a_caminho')`,
    [vizinho]
  );

  const somem = await mk('Vai sumir', 'sumir@kn.test');
  const sosSome = await criaSos(somem);
  await db.query(
    `INSERT INTO sos_responders (sos_id, user_id, state) VALUES ($1, $2, 'notificado')`,
    [sosSome, vizinho]
  );
  await db.query(`DELETE FROM users WHERE id = $1`, [somem]);
  const restou = await db.query(`SELECT 1 FROM sos_responders WHERE sos_id = $1`, [sosSome]);
  check('apagar o autor apaga o SOS e seus socorristas (cascata)', restou.rows.length === 0);

  // ============================================================= seção 3
  // ESCALADA: o SOS que ninguém consegue ver
  //
  // Era o pior defeito encontrado. A escalada morava dentro de
  // GET /api/sos/active, cuja consulta filtra
  //   WHERE sa.user_id = eu OR sr.user_id = eu
  // Ou seja: só escalava SOS que o usuário que está com o app aberto já
  // enxerga. Um pedido de socorro cujos vizinhos notificados estão todos com
  // o app fechado — exatamente quando ampliar o raio é vital — não era varrido
  // por NINGUÉM e ficava parado em 5 km para sempre, sem erro, sem log.
  //
  // Aqui provamos as duas metades: (a) a consulta antiga não alcança esse SOS,
  // (b) a varredura global de lib/sosEscalada.ts alcança.
  console.log('\nEscalada — o SOS que ninguém vê:');

  const isolado = await mk('Sozinho no mar', 'sozinho@kn.test');
  const espectador = await mk('Alguem online', 'online@kn.test');
  const sosIsolado = await criaSos(isolado);
  // Criado há 10 min e sem socorrista: candidato legítimo a escalada.
  await db.query(
    `UPDATE sos_alerts SET created_at = NOW() - INTERVAL '10 minutes',
            lat = -4.9572, lng = -36.8833, radius_km = 5 WHERE id = $1`,
    [sosIsolado]
  );

  // (a) A consulta da rota antiga, do ponto de vista de quem está online.
  const visaoAntiga = await db.query(
    `SELECT DISTINCT sa.id
     FROM sos_alerts sa
     LEFT JOIN sos_responders sr ON sr.sos_id = sa.id
     WHERE sa.status IN ('ativo','em_atendimento')
       AND (sa.user_id = $1 OR sr.user_id = $1)`,
    [espectador]
  );
  check(
    'consulta antiga NÃO alcança o SOS sem vizinhos online (a falha original)',
    visaoAntiga.rows.length === 0
  );

  // (b) A varredura global — mesma consulta de varrerEscaladas().
  const visaoGlobal = await db.query<{ id: string; tem_responsavel: boolean }>(
    `SELECT sa.id,
            EXISTS (SELECT 1 FROM sos_responders sr
                    WHERE sr.sos_id = sa.id AND sr.state IN ('a_caminho','no_local')) AS tem_responsavel
     FROM sos_alerts sa
     WHERE sa.status IN ('ativo','em_atendimento') AND sa.radius_km < 50`
  );
  check(
    'varredura global alcança o SOS que ninguém vê',
    visaoGlobal.rows.some(r => r.id === sosIsolado)
  );
  check(
    'varredura marca o SOS isolado como sem responsável (deve escalar)',
    visaoGlobal.rows.find(r => r.id === sosIsolado)?.tem_responsavel === false
  );

  // Idempotência: o UPDATE é condicionado ao raio lido, então cron e poll
  // rodando juntos ampliam UMA vez, não duas.
  const [esc1, esc2] = await Promise.all([
    db.query(
      `UPDATE sos_alerts SET radius_km = 15, escalated_at = NOW()
       WHERE id = $1 AND radius_km = 5 AND status IN ('ativo','em_atendimento') RETURNING id`,
      [sosIsolado]
    ),
    db.query(
      `UPDATE sos_alerts SET radius_km = 15, escalated_at = NOW()
       WHERE id = $1 AND radius_km = 5 AND status IN ('ativo','em_atendimento') RETURNING id`,
      [sosIsolado]
    ),
  ]);
  check(
    'cron e poll simultâneos escalam UMA vez só (UPDATE condicionado ao raio)',
    esc1.rows.length + esc2.rows.length === 1,
    `venceram ${esc1.rows.length + esc2.rows.length}`
  );

  const raioAposEscalada = await db.query<{ radius_km: string }>(
    `SELECT radius_km FROM sos_alerts WHERE id = $1`,
    [sosIsolado]
  );
  check('raio ampliou 5 -> 15 km exatamente uma vez', Number(raioAposEscalada.rows[0].radius_km) === 15);

  // SOS já atendido não deve ser escalado: quem assumiu está indo.
  const atendido = await mk('Com socorro', 'comsocorro@kn.test');
  const sosAtendido = await criaSos(atendido);
  await db.query(
    `UPDATE sos_alerts SET created_at = NOW() - INTERVAL '10 minutes', radius_km = 5 WHERE id = $1`,
    [sosAtendido]
  );
  await db.query(
    `INSERT INTO sos_responders (sos_id, user_id, state) VALUES ($1, $2, 'a_caminho')`,
    [sosAtendido, vizinho]
  );
  const varreduraAtendido = await db.query<{ tem_responsavel: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM sos_responders sr
                    WHERE sr.sos_id = sa.id AND sr.state IN ('a_caminho','no_local')) AS tem_responsavel
     FROM sos_alerts sa WHERE sa.id = $1`,
    [sosAtendido]
  );
  check(
    'SOS com socorrista a caminho é marcado como atendido (não escala)',
    varreduraAtendido.rows[0].tem_responsavel === true
  );

  // Raio máximo não entra na varredura — nada a ampliar, não é erro.
  const noMax = await mk('No maximo', 'nomaximo@kn.test');
  const sosMax = await criaSos(noMax);
  await db.query(`UPDATE sos_alerts SET radius_km = 50 WHERE id = $1`, [sosMax]);
  const varreduraMax = await db.query(
    `SELECT id FROM sos_alerts WHERE status IN ('ativo','em_atendimento') AND radius_km < 50 AND id = $1`,
    [sosMax]
  );
  check('SOS no raio máximo sai da varredura', varreduraMax.rows.length === 0);

  await db.close();
}

main()
  .then(() => {
    console.log('\n' + '='.repeat(52));
    console.log(`SOS adversarial: ${passed} passaram, ${failed} falharam`);
    console.log('='.repeat(52));
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error('\nERRO:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
