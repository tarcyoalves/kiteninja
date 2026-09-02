/**
 * Valida o schema e as queries das rotas contra um Postgres real, em processo
 * (PGlite). Não precisa de Neon nem de rede — serve para pegar coluna
 * inexistente, violação de constraint e erro de sintaxe antes do deploy.
 *
 *   npx tsx scripts/verify-sql.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { splitSqlStatements } from '../lib/splitSqlStatements';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Espera que a query FALHE (constraint deve barrar). */
async function expectFail(db: PGlite, name: string, sql: string, params: unknown[] = []) {
  try {
    await db.query(sql, params);
    check(name, false, 'a query passou, mas devia ter sido rejeitada');
  } catch {
    check(name, true);
  }
}

/** Espera que a query FUNCIONE. */
async function expectOk(
  db: PGlite,
  name: string,
  sql: string,
  params: unknown[] = []
): Promise<Record<string, unknown>[]> {
  try {
    const res = await db.query(sql, params);
    check(name, true);
    return res.rows as Record<string, unknown>[];
  } catch (err) {
    check(name, false, err instanceof Error ? err.message.split('\n')[0] : String(err));
    return [];
  }
}


/**
 * Varredura de TODO sql`` de app/api contra o schema real.
 *
 * POR QUE ISTO EXISTE
 *
 * O mapa ao vivo do downwind (`/api/downwind/[id]/live`) devolvia 500 para
 * todo mundo, o tempo todo — a tela nunca funcionou. A rota consultava
 * `d.origem_spot_id`, `d.distancia_estimada_km`, `dp.criado_em` e
 * `p.velocidade_nos`: quatro colunas que NUNCA existiram. A rota de convite
 * de downwind tinha o mesmo problema com `d.spot_saida_id`.
 *
 * Nada disso é pego por build, typecheck, teste unitário ou lint: para o
 * TypeScript uma query é uma string, e o nome de coluna errado só aparece
 * quando o Postgres recusa — em produção, no meio de uma travessia.
 *
 * Os 270+ checks à mão que este arquivo já tinha também não pegaram, porque
 * cada um cobre uma consulta ESCOLHIDA. Esta varredura inverte isso: pega
 * todas, e uma rota nova entra na cobertura por existir, sem ninguém lembrar
 * de escrever o check.
 *
 * COMO FUNCIONA: extrai cada template sql``, troca as interpolações por NULL
 * e pede um EXPLAIN ao Postgres. O EXPLAIN valida tabelas, colunas, joins e
 * funções sem executar nada. Só SELECT — em INSERT/UPDATE/DELETE o EXPLAIN
 * executaria de verdade.
 */
function listarArquivosTs(dir: string, out: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) listarArquivosTs(caminho, out);
    else if (caminho.endsWith('.ts')) out.push(caminho);
  }
  return out;
}

/**
 * Conteúdo de cada template sql``, com as interpolações viradas NULL.
 *
 * Percorre caractere a caractere em vez de usar regex porque `${...}` pode
 * conter chaves aninhadas (`${a ? {x:1} : null}`) e uma regex gulosa cortaria
 * no lugar errado.
 */
function extrairTemplatesSql(fonte: string): string[] {
  const encontrados: string[] = [];
  const inicio = /\bsql`/g;
  let m: RegExpExecArray | null;
  while ((m = inicio.exec(fonte))) {
    let i = m.index + m[0].length;
    let corpo = '';
    for (; i < fonte.length; i++) {
      const c = fonte[i];
      if (c === '\\') {
        corpo += fonte[i] + (fonte[i + 1] ?? '');
        i++;
        continue;
      }
      if (c === '$' && fonte[i + 1] === '{') {
        let prof = 1;
        i += 2;
        for (; i < fonte.length && prof > 0; i++) {
          if (fonte[i] === '{') prof++;
          else if (fonte[i] === '}') prof--;
        }
        i--;
        corpo += 'NULL';
        continue;
      }
      if (c === '`') break;
      corpo += c;
    }
    encontrados.push(corpo);
  }
  return encontrados;
}

async function varrerSelectsDasRotas(db: PGlite): Promise<void> {
  const arquivos = listarArquivosTs(join(process.cwd(), 'app', 'api'));
  const falhasLeitura: string[] = [];
  const falhasEscrita: string[] = [];
  let lidas = 0;
  let escritas = 0;
  let preparadas = 0;

  for (const arquivo of arquivos) {
    const nomeCurto = arquivo.replace(process.cwd() + '/', '');
    for (const template of extrairTemplatesSql(readFileSync(arquivo, 'utf8'))) {
      const limpo = template.replace(/--[^\n]*/g, '').trim();

      if (/^SELECT\b/i.test(limpo)) {
        try {
          await db.query(`EXPLAIN ${limpo}`);
          lidas++;
        } catch (err) {
          const motivo = err instanceof Error ? err.message.split('\n')[0] : String(err);
          falhasLeitura.push(`${nomeCurto}: ${motivo}`);
        }
        continue;
      }

      /*
       * ESCRITAS — a metade que faltava.
       *
       * A primeira versão desta varredura só cobria SELECT, porque EXPLAIN
       * num INSERT/UPDATE/DELETE EXECUTA o comando de verdade. Isso deixava
       * 107 de 215 consultas sem validação nenhuma — justamente as que
       * REGISTRAM as coisas: gravar a sessão de velejo, iniciar o downwind,
       * anotar a posição. Um nome de coluna errado ali é dado que o
       * velejador acha que salvou e não salvou.
       *
       * PREPARE resolve: valida tabelas, colunas e tipos e NÃO executa nada
       * (verificado — a tabela continua vazia depois de preparar um INSERT).
       */
      /*
       * `WITH` entra na lista. A gravação da sessão de velejo é uma CTE
       * (`WITH nova_sessao AS (INSERT INTO sessions_log ...)`), e um filtro
       * que só olhasse a primeira palavra a deixaria de fora — justamente o
       * INSERT mais importante do app, o que registra o velejo.
       */
      if (!/^(INSERT|UPDATE|DELETE|WITH)\b/i.test(limpo)) continue;
      escritas++;
      preparadas++;
      try {
        await db.exec(`PREPARE varredura_${preparadas} AS ${limpo}`);
      } catch (err) {
        const motivo = err instanceof Error ? err.message.split('\n')[0] : String(err);
        falhasEscrita.push(`${nomeCurto}: ${motivo}`);
      }
    }
  }

  check(
    `todo SELECT de app/api casa com o schema (${lidas} consultas)`,
    falhasLeitura.length === 0,
    falhasLeitura.join(' | ')
  );

  check(
    `toda ESCRITA de app/api casa com o schema (${escritas} INSERT/UPDATE/DELETE)`,
    falhasEscrita.length === 0,
    falhasEscrita.join(' | ')
  );
}

/** Mesmo teto fixo de app/api/riders/[id]/route.ts (LIMITE_VELEJOS). */
const LIMITE_VELEJOS_TESTE = 20;

async function main() {
  console.log('Postgres em processo (PGlite)\n');
  // gen_random_uuid() vem do pgcrypto; no Neon a extensão já está disponível,
  // aqui ela precisa ser carregada explicitamente.
  const db = new PGlite({ extensions: { pgcrypto } });

  // ------------------------------------------------------------- schema
  console.log('Schema:');
  const schema = readFileSync(join(process.cwd(), 'lib', 'schema.sql'), 'utf8');
  try {
    const statements = splitSqlStatements(schema);
    for (const statement of statements) await db.exec(statement);
    check('lib/schema.sql aplica sem erro pelo mesmo separador da migração', true);
    const totalDoInSchema = (schema.match(/DO \$\$/g) || []).length;
    check(
      `separador preserva todos os ${totalDoInSchema} blocos DO $$ do schema como instruções inteiras`,
      statements.filter((statement) => statement.trimStart().startsWith('DO $$')).length === totalDoInSchema
    );
  } catch (err) {
    check('lib/schema.sql aplica sem erro pelo mesmo separador da migração', false, err instanceof Error ? err.message : '');
    console.log('\nSchema inválido, abortando.');
    process.exit(1);
  }

  const tables = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  );
  const found = new Set(tables.rows.map((r) => r.table_name));
  for (const t of [
    'users',
    'invites',
    'auth_sessions',
    'spots',
    'favorites',
    'sessions_log',
    'posts',
    'post_likes',
    'post_comments',
    'safety_alerts',
    'events',
    'event_registrations',
    'password_reset_tokens',
    'audit_logs',
    'content_reports',
    'notification_preferences',
    'sos_alerts',
    'sos_responders',
    'push_subscriptions',
    'fcm_tokens',
    'downwinds',
    'downwind_participantes',
    'downwind_posicoes',
    'downwind_convites',
    'downwind_tracking_tokens',
    'downwind_silencio_alertas',
    'notifications',
    'chamados',
    'sos_events',
    'downwind_user_invites',
  ]) {
    check(`tabela ${t}`, found.has(t));
  }

  // ----------------------------------------------------- dados de apoio
  const admin = await db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, role, rider_id)
     VALUES ('admin@t.local', '$2b$12$x', 'Admin', 'admin', '0001') RETURNING id`
  );
  const adminId = admin.rows[0].id;

  const riderA = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('a@t.local', '$2b$12$x', 'Rider A', '1001') RETURNING id`
    )
  ).rows[0].id;

  const riderB = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('b@t.local', '$2b$12$x', 'Rider B', '1002') RETURNING id`
    )
  ).rows[0].id;

  await db.query(
    `INSERT INTO spots (id, name, location, state, lat, lng, wind_safety,
       water_condition, bottom_type, difficulty, cover_image)
     VALUES ('ponta-do-mel', 'Ponta do Mel', 'Areia Branca / RN', 'RN',
       -4.9572, -36.8833, 'Side-Onshore', 'Chop Médio', 'Areia',
       'Intermediário', 'x.jpg')`
  );

  // ------------------------------------------------------- constraints
  console.log('\nConstraints:');
  await expectFail(
    db,
    'email duplicado é rejeitado',
    `INSERT INTO users (email, password_hash, name, rider_id)
     VALUES ('a@t.local', 'x', 'Dup', '9')`
  );
  await expectFail(
    db,
    'role fora do CHECK é rejeitada',
    `INSERT INTO users (email, password_hash, name, rider_id, role)
     VALUES ('c@t.local', 'x', 'X', '9', 'superuser')`
  );
  await expectFail(
    db,
    'rating fora de 1..5 é rejeitado',
    `INSERT INTO sessions_log (user_id, spot_name, spot_location, date, start_time,
       duration_minutes, discipline, kite_size_m2, avg_wind_knots, rating)
     VALUES ($1, 'S', 'L', CURRENT_DATE, '10:00', 90, 'Kitesurf Twintip', 9, 18, 9)`,
    [riderA]
  );
  await expectFail(
    db,
    'duration_minutes <= 0 é rejeitado',
    `INSERT INTO sessions_log (user_id, spot_name, spot_location, date, start_time,
       duration_minutes, discipline, kite_size_m2, avg_wind_knots, rating)
     VALUES ($1, 'S', 'L', CURRENT_DATE, '10:00', 0, 'Kitesurf Twintip', 9, 18, 5)`,
    [riderA]
  );
  await expectFail(
    db,
    'severity fora do CHECK é rejeitada',
    `INSERT INTO safety_alerts (user_id, title, spot_name, severity, description)
     VALUES ($1, 'T', 'S', 'catastrofe', 'D')`,
    [riderA]
  );
  await expectFail(
    db,
    'sos status fora do CHECK é rejeitado',
    `INSERT INTO sos_alerts (user_id, status) VALUES ($1, 'socorro_invalido')`,
    [riderA]
  );
  await expectFail(
    db,
    'sos_responder state fora do CHECK é rejeitado',
    `INSERT INTO sos_responders (sos_id, user_id, state) VALUES (gen_random_uuid(), $1, 'voando')`,
    [riderA]
  );

  // Réplica da instrução única de POST /api/sessions: se o post automático
  // falhar, o INSERT da sessão inteira volta junto — não sobra Ride órfão para
  // duplicar quando o cliente retentar.
  const sessaoAtomica = await expectOk(
    db,
    'criação atômica de Ride público + post automático (CTE da rota)',
    `WITH nova_sessao AS (
       INSERT INTO sessions_log (
         user_id, spot_id, spot_name, spot_location, date, start_time,
         duration_minutes, discipline, kite_size_m2, board_model,
         avg_wind_knots, max_gust_knots, wind_direction, tide_condition,
         water_condition, rating, distance_km, max_speed_knots, highest_jump_m,
         notes, photo_url, is_public, trilha_reduzida, lat_inicial, lng_inicial
       ) VALUES (
         $1, NULL, 'Spot Atômico', 'RN', '2026-08-23', '15:30',
         90, 'Kitesurf Twintip', 9, NULL,
         20, NULL, NULL, NULL,
         NULL, 5, NULL, NULL, NULL,
         'teste atômico', NULL, TRUE, NULL::jsonb, NULL, NULL
       ) RETURNING *
     ), post_automatico AS (
       INSERT INTO posts (user_id, session_id, title, content, spot_name, spot_location)
       SELECT $1, ns.id, 'Ride atômico', 'teste', 'Spot Atômico', 'RN'
       FROM nova_sessao ns WHERE TRUE = TRUE RETURNING id
     )
     SELECT ns.* FROM nova_sessao ns LEFT JOIN post_automatico pa ON TRUE`,
    [riderA]
  );
  const sessaoAtomicaId = String(sessaoAtomica[0]?.id ?? '');
  const postAtomico = await db.query(
    `SELECT id FROM posts WHERE session_id = $1`,
    [sessaoAtomicaId]
  );
  check('Ride público e post automático nascem vinculados na mesma instrução', postAtomico.rows.length === 1);
  await db.query(`DELETE FROM sessions_log WHERE id = $1`, [sessaoAtomicaId]);

  // ------------------------------------------- queries reais das rotas
  console.log('\nQueries das rotas de auth:');
  await expectOk(
    db,
    'login: busca por email em minúsculas',
    `SELECT id, password_hash, name, role, must_change_password
     FROM users WHERE LOWER(email) = $1 LIMIT 1`,
    ['a@t.local']
  );

  await db.query(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
     VALUES ($1, 'hash-de-teste', NOW() + INTERVAL '30 days')`,
    [riderA]
  );
  const sessionLookup = await expectOk(
    db,
    'getSessionUser: join sessão + usuário',
    `SELECT u.id, u.email, u.name, u.role, u.must_change_password
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() LIMIT 1`,
    ['hash-de-teste']
  );
  check('sessão válida resolve 1 usuário', sessionLookup.length === 1);

  await expectOk(
    db,
    '/api/auth/me: perfil + estatísticas agregadas',
    `SELECT COUNT(*)::int AS total_sessions,
            COALESCE(SUM(duration_minutes), 0)::int AS total_minutes,
            COALESCE(SUM(distance_km), 0)::float AS total_km,
            COALESCE(MAX(max_speed_knots), 0)::float AS max_knots
     FROM sessions_log WHERE user_id = $1`,
    [riderA]
  );

  console.log('\nQueries de convite:');
  const inv = await db.query<{ id: string }>(
    `INSERT INTO invites (token_hash, created_by, expires_at)
     VALUES ('inv-hash', $1, NOW() + INTERVAL '7 days') RETURNING id`,
    [adminId]
  );
  const inviteId = inv.rows[0].id;

  await expectOk(
    db,
    'findUsableInvite',
    `SELECT id, email FROM invites
     WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL
       AND expires_at > NOW() LIMIT 1`,
    ['inv-hash']
  );

  const firstUse = await db.query(
    `UPDATE invites SET used_at = NOW(), used_by = $2
     WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL RETURNING id`,
    [inviteId, riderA]
  );
  check('consumeInvite: primeiro uso vence', firstUse.rows.length === 1);

  const secondUse = await db.query(
    `UPDATE invites SET used_at = NOW(), used_by = $2
     WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL RETURNING id`,
    [inviteId, riderB]
  );
  check('consumeInvite: segundo uso é bloqueado', secondUse.rows.length === 0);

  await expectOk(
    db,
    'listagem de convites do admin',
    `SELECT i.id, i.email, i.note, i.expires_at, i.used_at, i.revoked_at,
            u.name AS used_by_name
     FROM invites i LEFT JOIN users u ON u.id = i.used_by
     ORDER BY i.created_at DESC LIMIT 100`
  );

  /**
   * O cadastro por convite agora grava o contato de emergência (quem avisar se
   * o SOS for acionado). O INSERT é exatamente onde um erro passaria calado:
   * conta criada, app funcionando, e o contato perdido — descoberto só numa
   * emergência real, quando o painel do acidentado não tem para quem mandar a
   * posição. Estas checagens rodam o INSERT real de POST /api/invites/accept.
   */
  const contatoNovo = await db.query<{
    emergency_contact_name: string | null; emergency_contact_phone: string | null;
  }>(
    `INSERT INTO users (
       email, password_hash, name, role, avatar_url, rider_id,
       weight_kg, rider_level, home_spot, disciplines, bio,
       emergency_contact_name, emergency_contact_phone
     ) VALUES (
       'cadastro.sos@kn.test', '$2b$12$x', 'Cadastro com SOS', 'rider', 'a.svg', '7101',
       78, 'Intermediário', 'Ponta do Mel', ARRAY['Kitesurf Twintip'], 'bio',
       $1, $2
     )
     RETURNING emergency_contact_name, emergency_contact_phone`,
    ['Maria (esposa)', '(84) 99999-0000']
  );
  check(
    'cadastro por convite persiste o nome do contato de emergência',
    contatoNovo.rows[0].emergency_contact_name === 'Maria (esposa)'
  );
  check(
    'cadastro por convite persiste o telefone do contato (com máscara, como digitado)',
    contatoNovo.rows[0].emergency_contact_phone === '(84) 99999-0000'
  );

  // Campo vazio é aceito: travar a criação da conta empurraria o velejador a
  // inventar um número para passar da tela, e número falso parece cobertura.
  const contatoVazio = await db.query<{ emergency_contact_phone: string | null }>(
    `INSERT INTO users (
       email, password_hash, name, role, avatar_url, rider_id,
       weight_kg, rider_level, disciplines, bio,
       emergency_contact_name, emergency_contact_phone
     ) VALUES (
       'cadastro.sem.sos@kn.test', '$2b$12$x', 'Sem contato', 'rider', 'a.svg', '7102',
       78, 'Intermediário', ARRAY['Kitesurf Twintip'], 'bio', NULL, NULL
     )
     RETURNING emergency_contact_phone`
  );
  check(
    'cadastro sem contato de emergência ainda cria a conta (campo opcional)',
    contatoVazio.rows[0].emergency_contact_phone === null
  );

  // O SosPanel monta o link de WhatsApp com `replace(/\D/g,'')`; o banco tem de
  // devolver o telefone intacto para essa limpeza acontecer no cliente.
  const leituraMe = await db.query<{ emergency_contact_phone: string | null }>(
    `SELECT emergency_contact_phone FROM users WHERE email = 'cadastro.sos@kn.test'`
  );
  check(
    '/api/auth/me lê o contato gravado no cadastro (o SOS depende dele)',
    leituraMe.rows[0].emergency_contact_phone === '(84) 99999-0000'
  );

  console.log('\nRecuperação de Senha & Ciclo de Vida:');
  const resetToken = await db.query<{ id: string }>(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, 'reset-hash-teste', NOW() + INTERVAL '2 hours') RETURNING id`,
    [riderA]
  );
  check('criação de token de recuperação de senha', resetToken.rows.length === 1);

  await expectOk(
    db,
    'validação de token de recuperação aberto',
    `SELECT r.id, r.user_id, u.email
     FROM password_reset_tokens r JOIN users u ON u.id = r.user_id
     WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > NOW() LIMIT 1`,
    ['reset-hash-teste']
  );

  const resetConsume = await db.query(
    `UPDATE password_reset_tokens SET used_at = NOW()
     WHERE token_hash = $1 AND used_at IS NULL RETURNING id`,
    ['reset-hash-teste']
  );
  check('consumo de token de recuperação de senha', resetConsume.rows.length === 1);

  const resetReconsume = await db.query(
    `UPDATE password_reset_tokens SET used_at = NOW()
     WHERE token_hash = $1 AND used_at IS NULL RETURNING id`,
    ['reset-hash-teste']
  );
  check('segundo consumo do token é barrado', resetReconsume.rows.length === 0);

  console.log('\nAuditoria e Notificações:');
  await expectOk(
    db,
    'inserção de log de auditoria',
    `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
     VALUES ($1, 'ROLE_CHANGED', 'user', $2) RETURNING id`,
    [adminId, riderA]
  );

  await expectOk(
    db,
    'inserção de preferências de notificação',
    `INSERT INTO notification_preferences (user_id, wind_alerts_enabled, wind_min_knots)
     VALUES ($1, TRUE, 18.0) ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
    [riderA]
  );

  console.log('\nConfiguração global (app_settings):');
  await expectOk(
    db,
    'grava a abertura com upsert por chave',
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ('intro_video', $1::jsonb, $2, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [
      JSON.stringify({ url: 'https://blob/x.mp4', inicioSeg: 1, fimSeg: 6, ativo: true }),
      adminId,
    ]
  );

  // O upsert é o caminho normal: o admin troca a abertura várias vezes.
  await expectOk(
    db,
    'segunda gravação sobrescreve em vez de duplicar',
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ('intro_video', $1::jsonb, $2, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [
      JSON.stringify({ url: 'https://blob/y.mp4', inicioSeg: 0, fimSeg: 4, ativo: true }),
      adminId,
    ]
  );

  const settings = await db.query<{ cnt: number; url: string }>(
    `SELECT COUNT(*)::int AS cnt, MAX(value->>'url') AS url
     FROM app_settings WHERE key = 'intro_video'`
  );
  check('app_settings tem 1 linha por chave', Number(settings.rows[0].cnt) === 1);
  check('valor gravado é o último enviado', settings.rows[0].url === 'https://blob/y.mp4');

  const leitura = await db.query(
    `SELECT value FROM app_settings WHERE key = 'intro_video' LIMIT 1`
  );
  const lido = leitura.rows[0] as { value: Record<string, unknown> };
  check('JSONB volta como objeto, não string', typeof lido.value === 'object');
  check('campo do trecho preserva número', Number(lido.value.fimSeg) === 4);

  console.log('\nIsolamento entre velejadores:');
  const sess = await db.query<{ id: string }>(
    `INSERT INTO sessions_log (user_id, spot_id, spot_name, spot_location, date,
       start_time, duration_minutes, discipline, kite_size_m2, avg_wind_knots, rating)
     VALUES ($1, 'ponta-do-mel', 'Ponta do Mel', 'RN', CURRENT_DATE, '10:00',
       90, 'Kitesurf Twintip', 9, 18, 5) RETURNING id`,
    [riderA]
  );
  const sessAId = sess.rows[0].id;

  const crossDelete = await db.query(
    `DELETE FROM sessions_log WHERE id = $1 AND user_id = $2 RETURNING id`,
    [sessAId, riderB]
  );
  check('B NÃO apaga sessão de A', crossDelete.rows.length === 0);

  const intact = await db.query(`SELECT id FROM sessions_log WHERE id = $1`, [sessAId]);
  check('sessão de A continua intacta', intact.rows.length === 1);

  // O PATCH real usa COALESCE para só alterar campos enviados.
  const patched = await db.query<{ spot_name: string; rating: number; notes: string }>(
    `UPDATE sessions_log SET
       spot_name = COALESCE($3, spot_name),
       rating    = COALESCE($4, rating),
       notes     = COALESCE($5, notes)
     WHERE id = $1 AND user_id = $2 RETURNING spot_name, rating, notes`,
    [sessAId, riderA, null, 4, 'vento bom']
  );
  check('PATCH com COALESCE preserva campo não enviado', patched.rows[0]?.spot_name === 'Ponta do Mel');
  check('PATCH aplica campo enviado', Number(patched.rows[0]?.rating) === 4);

  const crossPatch = await db.query(
    `UPDATE sessions_log SET rating = 1 WHERE id = $1 AND user_id = $2 RETURNING id`,
    [sessAId, riderB]
  );
  check('B NÃO edita sessão de A', crossPatch.rows.length === 0);

  console.log('\nTrilha na sessão solo (Fase 1 do plano de rede social):');
  // Mesmo formato de downwind_participantes.trilha_reduzida (ver comentário
  // no schema): JSONB [[lat, lng, tsMs], ...], gravado já reduzido pela rota
  // (POST /api/sessions valida com lib/trilhaSessao.ts, validarTrilhaReduzida,
  // antes de chegar aqui). Este check prova só que a COLUNA aceita e devolve
  // o formato certo, não a validação em si (essa é testada em
  // lib/trilhaSessao.test.ts, função pura, sem precisar de banco).
  const trilhaSessaoTeste = [
    [-4.9572, -36.8833, 1_700_000_000_000],
    [-4.9601, -36.8890, 1_700_000_060_000],
  ];
  const sessComTrilha = await expectOk(
    db,
    'grava trilha_reduzida (JSONB) e lat/lng_inicial numa sessão',
    `INSERT INTO sessions_log (
       user_id, spot_name, spot_location, date, start_time, duration_minutes,
       discipline, kite_size_m2, avg_wind_knots, rating,
       trilha_reduzida, lat_inicial, lng_inicial
     ) VALUES ($1, 'Ponta do Mel', 'RN', CURRENT_DATE, '10:00', 90,
       'Kitesurf Twintip', 9, 18, 5, $2::jsonb, $3, $4)
     RETURNING id, trilha_reduzida, lat_inicial, lng_inicial`,
    [riderA, JSON.stringify(trilhaSessaoTeste), trilhaSessaoTeste[0][0], trilhaSessaoTeste[0][1]]
  );
  check(
    'trilha_reduzida volta do banco como array JSONB com os pontos gravados',
    Array.isArray(sessComTrilha[0]?.trilha_reduzida) &&
      (sessComTrilha[0].trilha_reduzida as unknown[]).length === 2
  );
  check(
    // NUMERIC(9,6): 6 casas decimais — a mesma precisão de downwind_posicoes
    // (lat/lng), suficiente para localizar dentro de ~0.1m. Prova que gravar
    // e ler de volta não perde a casa decimal mais significativa para o
    // enquadramento do mapa (a 6ª casa já é ruído de GPS, não precisa de
    // exatidão binária ali).
    'lat_inicial/lng_inicial aceitam a precisão de 6 casas decimais sem arredondar a mais',
    Number(sessComTrilha[0]?.lat_inicial) === -4.9572 &&
      Number(sessComTrilha[0]?.lng_inicial) === -36.8833
  );

  const sessSemTrilha = await expectOk(
    db,
    'trilha_reduzida/lat_inicial/lng_inicial são opcionais (NULL) — sessão sem GPS continua gravando',
    `INSERT INTO sessions_log (
       user_id, spot_name, spot_location, date, start_time, duration_minutes,
       discipline, kite_size_m2, avg_wind_knots, rating
     ) VALUES ($1, 'Ponta do Mel', 'RN', CURRENT_DATE, '10:00', 90,
       'Kitesurf Twintip', 9, 18, 5)
     RETURNING trilha_reduzida, lat_inicial, lng_inicial`,
    [riderA]
  );
  check(
    'sessão sem trilha grava NULL nas 3 colunas, não uma linha rejeitada',
    sessSemTrilha[0]?.trilha_reduzida === null &&
      sessSemTrilha[0]?.lat_inicial === null &&
      sessSemTrilha[0]?.lng_inicial === null
  );

  console.log('\nGrafo social (Fase 2 do plano de rede social):');

  // CHECK (follower_id <> following_id): auto-follow é barrado no banco, não
  // só na rota (lib/social.ts, podeSeguir) — mesma dupla camada do CHECK que
  // impede auto-DM em lib/chat.ts (salaDireta).
  await expectFail(
    db,
    'CHECK barra auto-follow (follower_id = following_id)',
    `INSERT INTO user_follows (follower_id, following_id) VALUES ($1, $1)`,
    [riderA]
  );

  const followAB = await expectOk(
    db,
    'A segue B',
    `INSERT INTO user_follows (follower_id, following_id) VALUES ($1, $2) RETURNING follower_id`,
    [riderA, riderB]
  );
  check('INSERT de A seguindo B retorna 1 linha', followAB.length === 1);

  // PK composta (follower_id, following_id): seguir duas vezes é violação de
  // chave primária no banco, não uma checagem que a UI precisa lembrar — a
  // rota real usa ON CONFLICT DO NOTHING (ver app/api/riders/[id]/follow),
  // mas aqui o INSERT cru sem ON CONFLICT prova que a constraint existe.
  await expectFail(
    db,
    'PK composta barra seguir a mesma pessoa duas vezes',
    `INSERT INTO user_follows (follower_id, following_id) VALUES ($1, $2)`,
    [riderA, riderB]
  );

  // B também segue A: seguimento mútuo é o que lib/social.ts
  // (relacaoComRider) chama de "amigos" na UI — derivado destas duas linhas,
  // nunca uma tabela própria.
  await db.query(`INSERT INTO user_follows (follower_id, following_id) VALUES ($1, $2)`, [
    riderB,
    riderA,
  ]);

  const quemEuSigo = await expectOk(
    db,
    '"quem eu sigo" (consulta que a Fase 3 do feed vai reaproveitar): SELECT por follower_id',
    `SELECT following_id FROM user_follows WHERE follower_id = $1`,
    [riderA]
  );
  check(
    'A segue exatamente B',
    quemEuSigo.length === 1 && quemEuSigo[0]?.following_id === riderB
  );

  const quemMeSegue = await expectOk(
    db,
    '"quem me segue" via idx_follows_following: SELECT por following_id',
    `SELECT follower_id FROM user_follows WHERE following_id = $1`,
    [riderA]
  );
  check(
    'B segue A de volta (seguimento mútuo)',
    quemMeSegue.length === 1 && quemMeSegue[0]?.follower_id === riderB
  );

  // --------------------------------------------------- busca de velejadores
  const riderC = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id, is_active)
       VALUES ('carla@t.local', '$2b$12$x', 'Carla Kitesurf', '2003', TRUE) RETURNING id`
    )
  ).rows[0].id;

  const riderInativo = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id, is_active)
       VALUES ('inativo@t.local', '$2b$12$x', 'Carlos Inativo', '2099', FALSE) RETURNING id`
    )
  ).rows[0].id;

  // Mesma forma de app/api/riders/search/route.ts: is_active, exclui a
  // própria conta, ILIKE em name OU rider_id.
  const buscaPorNome = await expectOk(
    db,
    'busca por nome parcial (ILIKE) acha o velejador certo',
    `SELECT id FROM users
     WHERE is_active = TRUE AND id <> $1
       AND (name ILIKE $2 OR rider_id ILIKE $2)
     ORDER BY name ASC LIMIT 20`,
    [riderA, '%carla%']
  );
  check('busca por nome acha Carla', buscaPorNome.some((r) => r.id === riderC));
  check(
    'busca NÃO traz conta inativa (is_active = FALSE)',
    !buscaPorNome.some((r) => r.id === riderInativo)
  );

  const buscaPorRiderId = await expectOk(
    db,
    'busca por rider_id parcial (ILIKE) acha o velejador certo',
    `SELECT id FROM users
     WHERE is_active = TRUE AND id <> $1
       AND (name ILIKE $2 OR rider_id ILIKE $2)
     ORDER BY name ASC LIMIT 20`,
    [riderA, '%200%']
  );
  check(
    'busca por rider_id (2003) acha Carla mesmo sem casar o nome',
    buscaPorRiderId.some((r) => r.id === riderC)
  );

  const buscaAutoexclusao = await expectOk(
    db,
    'busca exclui a própria conta mesmo quando o termo casa com o próprio nome',
    `SELECT id FROM users
     WHERE is_active = TRUE AND id <> $1
       AND (name ILIKE $2 OR rider_id ILIKE $2)
     ORDER BY name ASC LIMIT 20`,
    [riderA, '%rider a%']
  );
  check('busca nunca retorna o próprio buscador', !buscaAutoexclusao.some((r) => r.id === riderA));

  console.log('\nCurtir sessão diretamente (Fase 3 do plano de rede social):');

  // sessAId (criada na seção "Isolamento entre velejadores" acima) é pública
  // e pertence a riderA. B curte diretamente — sem post intermediário, ao
  // contrário do likesCount antigo (post_likes JOIN posts) que o plano
  // descarta por nunca funcionar na prática.
  await expectOk(
    db,
    'B curte a sessão pública de A diretamente (session_likes, sem post no meio)',
    `INSERT INTO session_likes (session_id, user_id) VALUES ($1, $2)`,
    [sessAId, riderB]
  );

  // PK composta (session_id, user_id): curtir de novo é violação de chave
  // primária no banco, não uma checagem que a UI precisa lembrar — a rota
  // real usa ON CONFLICT DO NOTHING (ver app/api/sessions/[id]/like), mas
  // aqui o INSERT cru sem ON CONFLICT prova que a constraint existe.
  await expectFail(
    db,
    'PK composta de session_likes barra curtir a mesma sessão duas vezes',
    `INSERT INTO session_likes (session_id, user_id) VALUES ($1, $2)`,
    [sessAId, riderB]
  );

  const curtidasDeA = await db.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM session_likes WHERE session_id = $1`,
    [sessAId]
  );
  check(
    'sessão de A tem exatamente 1 curtida (a duplicata foi rejeitada, não somada)',
    Number(curtidasDeA.rows[0].cnt) === 1
  );

  console.log('\nFeed de velejos com paginação keyset (Fase 3 do plano de rede social):');

  // Datas fixas (não NOW() com offset): o teste de keyset precisa de uma
  // ordem determinística entre estas 4 sessões, sem depender de quão rápido
  // o resto do script rodou antes de chegar aqui.
  const T0 = '2024-01-01T00:00:00Z'; // sessAId é atualizada para esta data
  const T1 = '2024-01-01T00:01:00Z'; // sessão pública de B (mais nova que A)
  const T2 = '2024-01-01T00:02:00Z'; // sessão PRIVADA de B — nunca deve aparecer no feed de A
  const T3 = '2024-01-01T00:03:00Z'; // 2ª sessão pública de B (a mais nova visível)
  const T4 = '2024-01-01T00:04:00Z'; // sessão pública de C — C não é seguido por A

  // riderA já tem OUTRAS sessões além de sessAId (as da seção "Trilha na
  // sessão solo" acima, já totalmente verificadas ali) — se sobrassem aqui,
  // apareceriam nas duas páginas deste teste só por serem "minhas", com
  // datas que não dão pra prever de antemão (created_at = NOW() real).
  // Removidas para este teste ter exatamente as sessões que ele controla.
  await db.query(`DELETE FROM sessions_log WHERE user_id = $1 AND id <> $2`, [riderA, sessAId]);
  await db.query(`UPDATE sessions_log SET created_at = $2 WHERE id = $1`, [sessAId, T0]);

  const sessBPublica1 = (
    await db.query<{ id: string }>(
      `INSERT INTO sessions_log (user_id, spot_name, spot_location, date, start_time, duration_minutes,
         discipline, kite_size_m2, avg_wind_knots, rating, is_public, created_at)
       VALUES ($1, 'Cumbuco', 'CE', CURRENT_DATE, '11:00', 60, 'Kitesurf Twintip', 12, 20, 5, TRUE, $2)
       RETURNING id`,
      [riderB, T1]
    )
  ).rows[0].id;

  const sessBPrivada = (
    await db.query<{ id: string }>(
      `INSERT INTO sessions_log (user_id, spot_name, spot_location, date, start_time, duration_minutes,
         discipline, kite_size_m2, avg_wind_knots, rating, is_public, created_at)
       VALUES ($1, 'Cumbuco', 'CE', CURRENT_DATE, '12:00', 60, 'Kitesurf Twintip', 12, 20, 5, FALSE, $2)
       RETURNING id`,
      [riderB, T2]
    )
  ).rows[0].id;

  // TESTE DE NEGAÇÃO exigido pela seção 4.2/critérios de aceite do plano:
  // app/api/sessions/[id]/like/route.ts (exigirSessaoVisivel) busca
  // `user_id, is_public` da sessão e aplica a MESMA decisão de
  // `lib/social.ts` (`podeVerSessao`) antes de deixar o INSERT em
  // session_likes acontecer. Réplica aqui da busca + decisão, provando que
  // C (que nem segue B) não pode curtir a sessão PRIVADA de B mesmo sabendo
  // o id dela de antemão — sem isto, um UUID adivinhado bastaria para curtir
  // (e, pela mesma rota, confirmar a existência de) uma sessão privada.
  const alvoParaCurtida = (
    await db.query<{ user_id: string; is_public: boolean }>(
      `SELECT user_id, is_public FROM sessions_log WHERE id = $1 LIMIT 1`,
      [sessBPrivada]
    )
  ).rows[0];
  const podeCVerSessaoPrivadaDeB =
    alvoParaCurtida.user_id === riderC || alvoParaCurtida.is_public;
  check(
    'C NÃO pode curtir a sessão privada de B mesmo conhecendo o id (nega antes do INSERT em session_likes)',
    !podeCVerSessaoPrivadaDeB
  );
  const podeBVerAPropriaSessaoPrivada =
    alvoParaCurtida.user_id === riderB || alvoParaCurtida.is_public;
  check(
    'B (o dono) continua podendo curtir a própria sessão privada — a negação é só para TERCEIROS',
    podeBVerAPropriaSessaoPrivada
  );

  const sessBPublica2 = (
    await db.query<{ id: string }>(
      `INSERT INTO sessions_log (user_id, spot_name, spot_location, date, start_time, duration_minutes,
         discipline, kite_size_m2, avg_wind_knots, rating, is_public, created_at)
       VALUES ($1, 'Cumbuco', 'CE', CURRENT_DATE, '13:00', 60, 'Kitesurf Twintip', 12, 20, 5, TRUE, $2)
       RETURNING id`,
      [riderB, T3]
    )
  ).rows[0].id;

  const sessCPublica = (
    await db.query<{ id: string }>(
      `INSERT INTO sessions_log (user_id, spot_name, spot_location, date, start_time, duration_minutes,
         discipline, kite_size_m2, avg_wind_knots, rating, is_public, created_at)
       VALUES ($1, 'Taíba', 'CE', CURRENT_DATE, '14:00', 60, 'Kitesurf Twintip', 12, 20, 5, TRUE, $2)
       RETURNING id`,
      [riderC, T4]
    )
  ).rows[0].id;

  // Réplica exata da condição de app/api/feed/route.ts: minha sessão sempre
  // entra; a de quem eu sigo só entra pública — a MESMA forma de
  // lib/social.ts (podeVerSessao), não uma condição solta reinventada aqui.
  const consultaFeed = `
    SELECT s.id, s.created_at
    FROM sessions_log s
    WHERE (
      s.user_id = $1
      OR (
        s.is_public = TRUE
        AND EXISTS (SELECT 1 FROM user_follows f WHERE f.follower_id = $1 AND f.following_id = s.user_id)
      )
    )
    AND ($2::timestamptz IS NULL OR s.created_at < $2::timestamptz)
    ORDER BY s.created_at DESC
    LIMIT $3
  `;

  const paginaUm = await expectOk(
    db,
    'feed de A (página 1, sem cursor): busca PAGE_SIZE+1 para saber se há próxima página',
    consultaFeed,
    [riderA, null, 3]
  );
  check(
    'página 1 traz as 3 mais novas visíveis, na ordem certa (mais nova primeiro)',
    paginaUm.map((r) => String(r.id)).join(',') ===
      [sessBPublica2, sessBPublica1, sessAId].join(',')
  );
  check(
    'sessão PRIVADA de B (terceiro) NÃO aparece no feed de A, mesmo A seguindo B',
    !paginaUm.some((r) => String(r.id) === sessBPrivada)
  );
  check(
    'sessão pública de C NÃO aparece no feed de A — A não segue C (feed não é "toda sessão pública do app")',
    !paginaUm.some((r) => String(r.id) === sessCPublica)
  );

  // A rota real pede PAGE_SIZE+1 e devolve só os PAGE_SIZE primeiros como
  // página; aqui simulamos isso com PAGE_SIZE=2 para testar o cursor.
  const pagina1Recortada = paginaUm.slice(0, 2);
  // `new Date(...).toISOString()`, não `String(...)`: o driver devolve
  // `created_at` como objeto `Date` (não string), e `String(Date)` produz o
  // formato de calendário do JS ("Sat Aug 22 2026...") — inválido para
  // `::timestamptz`. `new Date(...)` aceita tanto `Date` quanto string ISO
  // sem diferença, então funciona igual à rota real (que recebe a string ISO
  // já formatada pelo `?cursor=` da URL).
  const cursorPagina2 = new Date(
    pagina1Recortada[pagina1Recortada.length - 1].created_at as string | Date
  ).toISOString();

  const paginaDois = await expectOk(
    db,
    'feed de A (página 2, com o cursor da página 1): respeita created_at < cursor',
    consultaFeed,
    [riderA, cursorPagina2, 3]
  );
  check(
    'página 2 traz só o que sobrou (sessAId), sem repetir o que a página 1 já devolveu',
    paginaDois.length === 1 && String(paginaDois[0].id) === sessAId
  );

  console.log('\nPerfil público do velejador (Fase 4 do plano de rede social):');

  // Réplica exata das duas subconsultas de contagem de app/api/riders/[id]/
  // route.ts. Neste ponto do script: A segue B e B segue A (seção "Grafo
  // social" acima) — seguimento mútuo, então B tem exatamente 1 seguidor (A)
  // e segue exatamente 1 pessoa (A) de volta.
  const contagensB = await expectOk(
    db,
    'perfil de B: contagem de seguidores e seguindo (subconsultas de user_follows)',
    `SELECT
       (SELECT COUNT(*)::int FROM user_follows f WHERE f.following_id = $1) AS seguidores,
       (SELECT COUNT(*)::int FROM user_follows f WHERE f.follower_id = $1) AS seguindo`,
    [riderB]
  );
  check(
    'B tem exatamente 1 seguidor (A) e segue exatamente 1 (A) — seguimento mútuo',
    Number(contagensB[0]?.seguidores) === 1 && Number(contagensB[0]?.seguindo) === 1
  );

  const contagensC = await expectOk(
    db,
    'perfil de C: contagem zerada — ninguém segue C, C não segue ninguém',
    `SELECT
       (SELECT COUNT(*)::int FROM user_follows f WHERE f.following_id = $1) AS seguidores,
       (SELECT COUNT(*)::int FROM user_follows f WHERE f.follower_id = $1) AS seguindo`,
    [riderC]
  );
  check(
    'C não tem seguidor nem segue ninguém',
    Number(contagensC[0]?.seguidores) === 0 && Number(contagensC[0]?.seguindo) === 0
  );

  // Réplica exata da consulta de velejos de app/api/riders/[id]/route.ts:
  // WHERE s.user_id = <dono do perfil> AND (s.user_id = <viewer> OR is_public).
  const consultaVelejosDoPerfil = `
    SELECT s.id, s.is_public
    FROM sessions_log s
    WHERE s.user_id = $1
      AND (s.user_id = $2 OR s.is_public = TRUE)
    ORDER BY s.created_at DESC
    LIMIT $3
  `;

  // A visitando o perfil de B: as duas sessões PÚBLICAS de B aparecem
  // (sessBPublica2 mais nova primeiro), a PRIVADA nunca — este é o teste de
  // negação central da Fase 4: perfil de terceiro não vaza sessão privada,
  // mesmo sendo A quem já segue B.
  const velejosDeBParaA = await expectOk(
    db,
    'velejos do perfil de B, vistos por A (terceiro): só as públicas',
    consultaVelejosDoPerfil,
    [riderB, riderA, LIMITE_VELEJOS_TESTE]
  );
  check(
    'perfil de B para A traz as 2 sessões públicas, na ordem certa (mais nova primeiro)',
    velejosDeBParaA.map((r) => String(r.id)).join(',') === [sessBPublica2, sessBPublica1].join(',')
  );
  check(
    'sessão PRIVADA de B NÃO aparece no próprio perfil dele quando quem olha é A',
    !velejosDeBParaA.some((r) => String(r.id) === sessBPrivada)
  );

  // B visitando o PRÓPRIO perfil: a privada aparece também — dono sempre vê a
  // própria sessão (mesma regra de podeVerSessao, "autorId === viewerId").
  const velejosDeBParaSiMesmo = await expectOk(
    db,
    'velejos do perfil de B, vistos pelo próprio B: a privada também aparece',
    consultaVelejosDoPerfil,
    [riderB, riderB, LIMITE_VELEJOS_TESTE]
  );
  check(
    'perfil de B para o próprio B traz as 3 sessões, incluindo a privada',
    velejosDeBParaSiMesmo.length === 3 &&
      velejosDeBParaSiMesmo.some((r) => String(r.id) === sessBPrivada)
  );

  console.log('\nCascata de curtidas/comentários de sessão (Fase 3):');

  await db.query(
    `INSERT INTO session_comments (session_id, user_id, text) VALUES ($1, $2, 'baita sessão, parabéns!')`,
    [sessAId, riderB]
  );

  // Sessão descartável só para testar a cascata de APAGAR A SESSÃO (não
  // queremos apagar sessAId agora — ela ainda serve a outros checks acima).
  const sessDescartavelId = (
    await db.query<{ id: string }>(
      `INSERT INTO sessions_log (user_id, spot_name, spot_location, date, start_time, duration_minutes,
         discipline, kite_size_m2, avg_wind_knots, rating)
       VALUES ($1, 'X', 'Y', CURRENT_DATE, '10:00', 60, 'Kitesurf Twintip', 9, 18, 5) RETURNING id`,
      [riderA]
    )
  ).rows[0].id;
  await db.query(`INSERT INTO session_likes (session_id, user_id) VALUES ($1, $2)`, [
    sessDescartavelId,
    riderB,
  ]);
  await db.query(
    `INSERT INTO session_comments (session_id, user_id, text) VALUES ($1, $2, 'boa!')`,
    [sessDescartavelId, riderB]
  );

  await db.query(`DELETE FROM sessions_log WHERE id = $1`, [sessDescartavelId]);

  const likesOrfaosDeSessao = await db.query(
    `SELECT session_id FROM session_likes WHERE session_id = $1`,
    [sessDescartavelId]
  );
  check('curtidas morrem junto com a sessão apagada (ON DELETE CASCADE por session_id)', likesOrfaosDeSessao.rows.length === 0);

  const commentsOrfaosDeSessao = await db.query(
    `SELECT session_id FROM session_comments WHERE session_id = $1`,
    [sessDescartavelId]
  );
  check(
    'comentários morrem junto com a sessão apagada (ON DELETE CASCADE por session_id)',
    commentsOrfaosDeSessao.rows.length === 0
  );

  // Caminho de cascata DIFERENTE: não é a sessão que morre, é quem curtiu.
  // Usuário descartável só para isolar este teste sem mexer em riderA/B/C.
  const riderDescartavel = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('descartavel@t.local', '$2b$12$x', 'Rider Descartável', '9999') RETURNING id`
    )
  ).rows[0].id;

  await db.query(`INSERT INTO session_likes (session_id, user_id) VALUES ($1, $2)`, [
    sessBPublica1,
    riderDescartavel,
  ]);
  await db.query(
    `INSERT INTO session_comments (session_id, user_id, text) VALUES ($1, $2, 'irado!')`,
    [sessBPublica1, riderDescartavel]
  );

  await db.query(`DELETE FROM users WHERE id = $1`, [riderDescartavel]);

  const likesDoUsuarioApagado = await db.query(
    `SELECT user_id FROM session_likes WHERE user_id = $1`,
    [riderDescartavel]
  );
  check(
    'curtidas de um usuário apagado somem (ON DELETE CASCADE por user_id), sem apagar a sessão curtida',
    likesDoUsuarioApagado.rows.length === 0
  );

  const commentsDoUsuarioApagado = await db.query(
    `SELECT user_id FROM session_comments WHERE user_id = $1`,
    [riderDescartavel]
  );
  check('comentários de um usuário apagado somem junto', commentsDoUsuarioApagado.rows.length === 0);

  const sessBPublica1AindaExiste = await db.query(`SELECT id FROM sessions_log WHERE id = $1`, [
    sessBPublica1,
  ]);
  check(
    'a sessão curtida/comentada continua existindo — só a curtida/comentário do usuário apagado sumiu',
    sessBPublica1AindaExiste.rows.length === 1
  );

  console.log('\nRespostas a comentário e notificações in-app (Fase 6 do plano de rede social):');

  // ---------------------------------------------- respostas a comentário (1 nível)
  const comentarioPaiId = (
    await db.query<{ id: string }>(
      `INSERT INTO session_comments (session_id, user_id, text) VALUES ($1, $2, 'comentário raiz') RETURNING id`,
      [sessAId, riderB]
    )
  ).rows[0].id;

  const respostaAoComentario = await expectOk(
    db,
    'resposta a um comentário de primeiro nível grava parent_comment_id',
    `INSERT INTO session_comments (session_id, user_id, text, parent_comment_id)
     VALUES ($1, $2, 'valeu, foi ótimo!', $3) RETURNING id, parent_comment_id`,
    [sessAId, riderA, comentarioPaiId]
  );
  const respostaId = respostaAoComentario[0]?.id;
  check(
    'a resposta grava o parent_comment_id do comentário-pai',
    respostaAoComentario[0]?.parent_comment_id === comentarioPaiId
  );

  await db.query(`DELETE FROM session_comments WHERE id = $1`, [comentarioPaiId]);
  const respostaAposApagarPai = await db.query(
    `SELECT id FROM session_comments WHERE id = $1`,
    [respostaId]
  );
  check(
    'apagar um comentário de primeiro nível cascateia suas respostas (parent_comment_id ON DELETE CASCADE)',
    respostaAposApagarPai.rows.length === 0
  );

  // ------------------------------------------------------ notificações in-app
  const notifRecipienteId = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('notif-recipiente@t.local', '$2b$12$x', 'Notif Recipiente', '5001') RETURNING id`
    )
  ).rows[0].id;

  const notifAtorId = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('notif-ator@t.local', '$2b$12$x', 'Notif Ator', '5002') RETURNING id`
    )
  ).rows[0].id;

  // CHECK (actor_id <> recipient_id): segunda camada de defesa contra
  // auto-notificação — a primeira é lib/notificacoes.ts (criarNotificacao),
  // que nunca insere quando os dois ids são iguais. Este teste prova que o
  // CHECK barra mesmo um INSERT cru, não só existe no papel — mesmo
  // princípio do CHECK de auto-follow em user_follows acima.
  await expectFail(
    db,
    'CHECK barra auto-notificação (actor_id = recipient_id)',
    `INSERT INTO notifications (recipient_id, actor_id, type) VALUES ($1, $1, 'novo_seguidor')`,
    [notifAtorId]
  );

  // Sessão descartável só para testar a cascata de "sessão apagada" sem
  // mexer em sessAId (ainda referenciada por checks acima).
  const sessParaNotifId = (
    await db.query<{ id: string }>(
      `INSERT INTO sessions_log (user_id, spot_name, spot_location, date, start_time, duration_minutes,
         discipline, kite_size_m2, avg_wind_knots, rating)
       VALUES ($1, 'X', 'Y', CURRENT_DATE, '10:00', 60, 'Kitesurf Twintip', 9, 18, 5) RETURNING id`,
      [riderB]
    )
  ).rows[0].id;

  const notifDeSessaoId = (
    await db.query<{ id: string }>(
      `INSERT INTO notifications (recipient_id, actor_id, type, session_id)
       VALUES ($1, $2, 'curtida_sessao', $3) RETURNING id`,
      [notifRecipienteId, notifAtorId, sessParaNotifId]
    )
  ).rows[0].id;

  await db.query(`DELETE FROM sessions_log WHERE id = $1`, [sessParaNotifId]);
  const notifOrfaDeSessao = await db.query(
    `SELECT id FROM notifications WHERE id = $1`,
    [notifDeSessaoId]
  );
  check(
    'apagar uma sessão cascateia as notificações que a referenciam (session_id ON DELETE CASCADE)',
    notifOrfaDeSessao.rows.length === 0
  );

  // Duas notificações para o MESMO par recipiente/ator, para provar os dois
  // lados da cascata de apagar usuário separadamente: uma some quando o
  // RECIPIENTE é apagado, outra quando é o ATOR.
  const notifComoRecipienteId = (
    await db.query<{ id: string }>(
      `INSERT INTO notifications (recipient_id, actor_id, type) VALUES ($1, $2, 'novo_seguidor') RETURNING id`,
      [notifRecipienteId, riderA]
    )
  ).rows[0].id;

  const outroAtorId = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('notif-ator-2@t.local', '$2b$12$x', 'Notif Ator 2', '5003') RETURNING id`
    )
  ).rows[0].id;
  const notifComoAtorId = (
    await db.query<{ id: string }>(
      `INSERT INTO notifications (recipient_id, actor_id, type) VALUES ($1, $2, 'novo_seguidor') RETURNING id`,
      [outroAtorId, notifAtorId]
    )
  ).rows[0].id;

  await db.query(`DELETE FROM users WHERE id = $1`, [notifRecipienteId]);
  const notifOrfaComoRecipiente = await db.query(
    `SELECT id FROM notifications WHERE id = $1`,
    [notifComoRecipienteId]
  );
  check(
    'apagar o usuário RECIPIENTE cascateia a notificação (recipient_id ON DELETE CASCADE)',
    notifOrfaComoRecipiente.rows.length === 0
  );

  await db.query(`DELETE FROM users WHERE id = $1`, [notifAtorId]);
  const notifOrfaComoAtor = await db.query(
    `SELECT id FROM notifications WHERE id = $1`,
    [notifComoAtorId]
  );
  check(
    'apagar o usuário ATOR cascateia a notificação (actor_id ON DELETE CASCADE)',
    notifOrfaComoAtor.rows.length === 0
  );

  // --- Aviso "amigo entrou na água" -------------------------------------
  //
  // A query de fan-out é a peça nova mais arriscada: ela seleciona E insere
  // numa instrução só, de propósito, para que a lista de destinatários nunca
  // passe pelo JavaScript como parâmetro (a lição do `sql`DEFAULT``, ver
  // docs/INVESTIGACAO-RASTREIO-BACKGROUND.md). Aqui ela roda contra Postgres
  // de verdade, não contra mock.

  const velejador = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('aviso-velejador@t.local', '$2b$12$x', 'Velejador', '5101') RETURNING id`
    )
  ).rows[0].id;
  const seguidorLigado = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('aviso-lig@t.local', '$2b$12$x', 'Seguidor Ligado', '5102') RETURNING id`
    )
  ).rows[0].id;
  const seguidorDesligado = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id, notificar_amigo_velejando)
       VALUES ('aviso-desl@t.local', '$2b$12$x', 'Seguidor Desligado', '5103', FALSE) RETURNING id`
    )
  ).rows[0].id;
  const seguidorInativo = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id, is_active)
       VALUES ('aviso-inativo@t.local', '$2b$12$x', 'Seguidor Inativo', '5104', FALSE) RETURNING id`
    )
  ).rows[0].id;

  const padraoLigado = await db.query<{ notificar_amigo_velejando: boolean }>(
    `SELECT notificar_amigo_velejando FROM users WHERE id = $1`,
    [velejador]
  );
  check(
    'notificar_amigo_velejando nasce TRUE (a funcionalidade seria invisível se nascesse desligada)',
    padraoLigado.rows[0].notificar_amigo_velejando === true
  );

  for (const seguidor of [seguidorLigado, seguidorDesligado, seguidorInativo]) {
    await db.query(
      `INSERT INTO user_follows (follower_id, following_id) VALUES ($1, $2)`,
      [seguidor, velejador]
    );
  }

  await expectOk(
    db,
    'notifications aceita o tipo velejo_iniciado',
    `INSERT INTO notifications (recipient_id, actor_id, type) VALUES ($1, $2, 'velejo_iniciado')`,
    [seguidorLigado, velejador]
  );
  await expectOk(
    db,
    'notifications aceita o tipo downwind_iniciado',
    `INSERT INTO notifications (recipient_id, actor_id, type) VALUES ($1, $2, 'downwind_iniciado')`,
    [seguidorLigado, velejador]
  );
  await expectFail(
    db,
    'notifications continua recusando tipo inventado',
    `INSERT INTO notifications (recipient_id, actor_id, type) VALUES ($1, $2, 'tipo_que_nao_existe')`,
    [seguidorLigado, velejador]
  );

  await db.query(`DELETE FROM notifications WHERE actor_id = $1`, [velejador]);

  // A query REAL de lib/notificacoes.ts, palavra por palavra.
  const fanOut = await db.query<{ recipient_id: string }>(
    `INSERT INTO notifications (recipient_id, actor_id, type)
     SELECT f.follower_id, $1, 'velejo_iniciado'
     FROM user_follows f
     JOIN users u ON u.id = f.follower_id
     WHERE f.following_id = $1
       AND u.is_active = TRUE
       AND u.notificar_amigo_velejando = TRUE
       AND f.follower_id <> $1
     LIMIT 500
     RETURNING recipient_id`,
    [velejador]
  );
  check(
    'fan-out do aviso insere e devolve os destinatários numa instrução só',
    fanOut.rows.length === 1 && fanOut.rows[0].recipient_id === seguidorLigado,
    `recebeu ${fanOut.rows.length} linha(s)`
  );
  check(
    'fan-out respeita quem desligou a preferência e quem está inativo',
    !fanOut.rows.some((r) => r.recipient_id === seguidorDesligado || r.recipient_id === seguidorInativo)
  );

  // Auto-seguir: o próprio BANCO recusa a linha (user_follows_check). Ou seja,
  // o filtro `f.follower_id <> actorId` da query de fan-out é defesa em
  // profundidade contra um caso que não consegue existir — e é isto que o
  // teste afirma, em vez de encenar um cenário impossível.
  await expectFail(
    db,
    'user_follows recusa auto-seguir, então o fan-out nunca vê a própria linha',
    `INSERT INTO user_follows (follower_id, following_id) VALUES ($1, $1)`,
    [velejador]
  );

  // ------------------------------------------------- central de chamados
  const chamadoUserId = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('chamado-user@t.local', '$2b$12$x', 'Chamado User', '5004') RETURNING id`
    )
  ).rows[0].id;

  const chamadoNovoRow = (
    await db.query<{ id: string; status: string; parecer: string | null }>(
      `INSERT INTO chamados (user_id, tipo, titulo, descricao)
       VALUES ($1, 'bug', 'Foto do perfil não salva', 'Ao trocar a foto, o app trava na tela de carregamento.')
       RETURNING id, status, parecer`,
      [chamadoUserId]
    )
  ).rows[0];
  check(
    'chamado novo nasce com status = novo (DEFAULT da coluna)',
    chamadoNovoRow.status === 'novo'
  );
  check('chamado novo nasce com parecer nulo', chamadoNovoRow.parecer === null);

  await expectFail(
    db,
    'CHECK barra tipo fora de (bug, melhoria)',
    `INSERT INTO chamados (user_id, tipo, titulo, descricao) VALUES ($1, 'sugestao', 'X', 'Descrição válida aqui')`,
    [chamadoUserId]
  );

  await expectFail(
    db,
    'CHECK barra status fora dos 5 valores permitidos',
    `INSERT INTO chamados (user_id, tipo, titulo, descricao, status) VALUES ($1, 'bug', 'X', 'Descrição válida aqui', 'fechado')`,
    [chamadoUserId]
  );

  await db.query(`DELETE FROM users WHERE id = $1`, [chamadoUserId]);
  const chamadoOrfao = await db.query(`SELECT id FROM chamados WHERE id = $1`, [chamadoNovoRow.id]);
  check(
    'apagar o usuário cascateia os chamados dele (user_id ON DELETE CASCADE)',
    chamadoOrfao.rows.length === 0
  );

  console.log('\nToggles (chave composta, sem coluna id):');
  const post = await db.query<{ id: string }>(
    `INSERT INTO posts (user_id, title, content) VALUES ($1, 'T', 'C') RETURNING id`,
    [riderA]
  );
  const postId = post.rows[0].id;

  // Reproduz exatamente o toggle da rota: DELETE ... RETURNING, senão INSERT.
  const likeRemove1 = await db.query(
    `DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2 RETURNING post_id`,
    [postId, riderB]
  );
  check('like: primeiro DELETE não remove nada', likeRemove1.rows.length === 0);

  await expectOk(
    db,
    'like: INSERT com ON CONFLICT',
    `INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)
     ON CONFLICT (post_id, user_id) DO NOTHING`,
    [postId, riderB]
  );
  await expectOk(
    db,
    'like: INSERT repetido não duplica',
    `INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)
     ON CONFLICT (post_id, user_id) DO NOTHING`,
    [postId, riderB]
  );

  const likeCount = await db.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM post_likes WHERE post_id = $1`,
    [postId]
  );
  check('like: contagem é 1 após dois inserts', Number(likeCount.rows[0].cnt) === 1);

  const likeRemove2 = await db.query(
    `DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2 RETURNING post_id`,
    [postId, riderB]
  );
  check('like: DELETE remove ao destoggle', likeRemove2.rows.length === 1);

  await expectOk(
    db,
    'favorito: toggle por DELETE RETURNING',
    `DELETE FROM favorites WHERE user_id = $1 AND spot_id = $2 RETURNING spot_id`,
    [riderA, 'ponta-do-mel']
  );
  await expectOk(
    db,
    'favorito: INSERT com ON CONFLICT',
    `INSERT INTO favorites (user_id, spot_id) VALUES ($1, $2)
     ON CONFLICT (user_id, spot_id) DO NOTHING`,
    [riderA, 'ponta-do-mel']
  );

  const favB = await db.query(`SELECT spot_id FROM favorites WHERE user_id = $1`, [riderB]);
  check('favorito de A não aparece para B', favB.rows.length === 0);

  const ev = await db.query<{ id: string }>(
    `INSERT INTO events (title, event_date, location, type, description, organizer)
     VALUES ('Downwind', '20/08', 'RN', 'Downwind', 'D', 'Org') RETURNING id`
  );
  await expectOk(
    db,
    'inscrição em evento: toggle',
    `DELETE FROM event_registrations WHERE event_id = $1 AND user_id = $2 RETURNING event_id`,
    [ev.rows[0].id, riderA]
  );
  await expectOk(
    db,
    'inscrição em evento: INSERT ON CONFLICT',
    `INSERT INTO event_registrations (event_id, user_id) VALUES ($1, $2)
     ON CONFLICT (event_id, user_id) DO NOTHING`,
    [ev.rows[0].id, riderA]
  );

  console.log('\nChat / DM:');
  // Ordem canônica decidida em runtime (os UUIDs de teste são gerados pelo
  // gen_random_uuid() do próprio seed, não dá pra saber a ordem de antemão) —
  // mesma regra de lib/chat.ts: salaDireta ordena, a rota grava só nessa forma.
  const [dmMenor, dmMaior] = [riderA, riderB].sort();
  const dmRoom = `dm:${dmMenor}:${dmMaior}`;

  // created_at explícito e separado: os dois INSERT rodam no mesmo instante e o
  // DEFAULT NOW() os empatava, deixando o ORDER BY created_at DESC sem desempate.
  // O teste do inbox abaixo passava ou falhava conforme a ordem física das linhas
  // — foi visto falhando de verdade. A distância de 1 minuto torna o "mais
  // recente" um fato, não um sorteio.
  await expectOk(
    db,
    'DM: primeira mensagem grava na sala canônica dm:<menor>:<maior>',
    `INSERT INTO chat_messages (user_id, room, text, created_at)
     VALUES ($1, $2, 'oi, bora velejar?', NOW() - INTERVAL '1 minute')`,
    [riderA, dmRoom]
  );
  await expectOk(
    db,
    'DM: resposta do outro lado na MESMA sala (não cria uma segunda)',
    `INSERT INTO chat_messages (user_id, room, text, created_at)
     VALUES ($1, $2, 'bora sim!', NOW())`,
    [riderB, dmRoom]
  );

  const inboxDeA = await expectOk(
    db,
    'inbox de DM: DISTINCT ON (room) + ORDER BY room, created_at DESC traz a última mensagem por sala',
    `SELECT DISTINCT ON (room) room, user_id AS last_sender_id, text, created_at
     FROM chat_messages
     WHERE room LIKE 'dm:%' AND (room LIKE $1 OR room LIKE $2)
     ORDER BY room, created_at DESC`,
    [`dm:${riderA}:%`, `dm:%:${riderA}`]
  );
  check(
    'inbox de A tem 1 conversa, com a mensagem mais recente (não a primeira)',
    inboxDeA.length === 1 && String(inboxDeA[0].text) === 'bora sim!'
  );

  const outroIdDaConversa = String(inboxDeA[0].room)
    .split(':')
    .slice(1)
    .find((id) => id !== riderA);
  const usuariosDaConversa = await expectOk(
    db,
    'inbox de DM: resolve o outro participante via = ANY(array) — mesmo parâmetro que a rota envia',
    `SELECT id, name FROM users WHERE id = ANY($1)`,
    [[outroIdDaConversa]]
  );
  check(
    '= ANY(array) resolveu exatamente o outro participante (riderB)',
    usuariosDaConversa.length === 1 && String(usuariosDaConversa[0].id) === riderB
  );

  console.log('\nFeed:');
  await expectOk(
    db,
    'feed com likes, comentários e isLiked do usuário',
    `SELECT p.id, p.title, p.content, p.created_at,
            u.name AS author_name, u.avatar_url, u.rider_id, u.country_flag,
            (SELECT COUNT(*)::int FROM post_likes pl WHERE pl.post_id = p.id) AS likes,
            (SELECT COUNT(*)::int FROM post_comments pc WHERE pc.post_id = p.id) AS comments_count,
            EXISTS (SELECT 1 FROM post_likes pl2 WHERE pl2.post_id = p.id AND pl2.user_id = $1) AS is_liked
     FROM posts p JOIN users u ON u.id = p.user_id
     ORDER BY p.created_at DESC LIMIT 50`,
    [riderA]
  );

  await expectOk(
    db,
    'eventos com participantes e inscrição do usuário',
    `SELECT e.id, e.title, e.event_date, e.location, e.type,
            (SELECT COUNT(*)::int FROM event_registrations er WHERE er.event_id = e.id) AS participants_count,
            EXISTS (SELECT 1 FROM event_registrations er2 WHERE er2.event_id = e.id AND er2.user_id = $1) AS is_registered
     FROM events e ORDER BY e.created_at DESC`,
    [riderA]
  );

  await expectOk(
    db,
    'alertas ativos com autor',
    `SELECT a.id, a.title, a.spot_name, a.severity, a.description, a.status,
            a.created_at, u.name AS reported_by
     FROM safety_alerts a JOIN users u ON u.id = a.user_id
     WHERE a.status = 'Ativo' ORDER BY a.created_at DESC`
  );

  console.log('\nSistema de Socorro (SOS) e Web Push:');
  const sosNullCoords = await expectOk(
    db,
    'SOS é aceito sem coordenadas (GPS demorou/falhou)',
    `INSERT INTO sos_alerts (user_id, status, radius_km) VALUES ($1, 'ativo', 5) RETURNING id`,
    [riderA]
  );
  check('SOS sem coordenada tem 1 linha', sosNullCoords.length === 1);

  // Unicidade de SOS aberto (P0-6): com o SOS acima ainda ativo, um segundo
  // do mesmo usuário tem de ser recusado pelo banco. Era aqui que a duplicata
  // nascia — check-then-insert sem constraint, duas requisições concorrentes.
  await expectFail(
    db,
    'segundo SOS aberto do mesmo usuário é recusado (uniq_sos_aberto_por_usuario)',
    `INSERT INTO sos_alerts (user_id, status, radius_km) VALUES ($1, 'ativo', 5)`,
    [riderA]
  );

  // Encerra o primeiro para poder seguir com o SOS completo do mesmo rider —
  // é exatamente o fluxo real: socorro concluído, pode pedir de novo.
  await db.query(`UPDATE sos_alerts SET status = 'resolvido', resolved_at = NOW() WHERE id = $1`, [
    (sosNullCoords[0] as { id: string }).id,
  ]);

  const sosComCoords = await db.query<{ id: string }>(
    `INSERT INTO sos_alerts (user_id, lat, lng, accuracy_m, spot_id, message, status, radius_km)
     VALUES ($1, -4.9572, -36.8833, 15.5, 'ponta-do-mel', 'prancha quebrada', 'ativo', 5) RETURNING id`,
    [riderA]
  );
  const sosId = sosComCoords.rows[0].id;
  check('criação de SOS com coordenadas e spot', Boolean(sosId));

  await expectOk(
    db,
    'sos_responders: notifica rider B',
    `INSERT INTO sos_responders (sos_id, user_id, state, distance_km)
     VALUES ($1, $2, 'notificado', 3.2)`,
    [sosId, riderB]
  );

  await expectFail(
    db,
    'sos_responders: PK composta (sos_id, user_id) rejeita duplicata sem ON CONFLICT',
    `INSERT INTO sos_responders (sos_id, user_id, state) VALUES ($1, $2, 'notificado')`,
    [sosId, riderB]
  );

  await expectOk(
    db,
    'sos_responders: UPSERT para state=a_caminho atualiza sem duplicar',
    `INSERT INTO sos_responders (sos_id, user_id, state, lat, lng, responded_at)
     VALUES ($1, $2, 'a_caminho', -4.9500, -36.8800, NOW())
     ON CONFLICT (sos_id, user_id) DO UPDATE
       SET state = EXCLUDED.state, lat = EXCLUDED.lat, lng = EXCLUDED.lng, responded_at = EXCLUDED.responded_at`,
    [sosId, riderB]
  );

  // A notificação inicial (e a da escalada) usam ON CONFLICT DO NOTHING: se o
  // mesmo velejador reaparecer entre os candidatos, a violação de PK derrubaria
  // a requisição e o SOS já gravado não notificaria ninguém.
  await expectOk(
    db,
    'sos_responders: notificação com ON CONFLICT sobrevive a candidato repetido',
    `INSERT INTO sos_responders (sos_id, user_id, state, distance_km)
     VALUES ($1, $2, 'notificado', 3.2)
     ON CONFLICT (sos_id, user_id) DO NOTHING`,
    [sosId, riderB]
  );

  const respondersCount = await db.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM sos_responders WHERE sos_id = $1`,
    [sosId]
  );
  check('sos_responders mantém 1 linha por usuário após upsert', Number(respondersCount.rows[0].cnt) === 1);

  // ----------------------------------------------------------------- sos_events
  const sosEvent = await expectOk(
    db,
    'sos_events: registro de socorrista a caminho para o autor do SOS',
    `INSERT INTO sos_events (sos_id, recipient_id, actor_id, actor_name, kind)
     VALUES ($1, $2, $3, 'Rider B', 'responder_a_caminho')
     RETURNING id, kind`,
    [sosId, riderA, riderB]
  );
  check('evento de SOS criado com sucesso', sosEvent.length === 1);

  await expectFail(
    db,
    'sos_events: kind fora do CHECK é rejeitado',
    `INSERT INTO sos_events (sos_id, recipient_id, actor_id, actor_name, kind)
     VALUES ($1, $2, $3, 'Rider B', 'curtiu')`,
    [sosId, riderA, riderB]
  );

  await expectFail(
    db,
    'sos_events: uniq_sos_events_dedup rejeita evento duplicado para mesmo sos, ator e kind',
    `INSERT INTO sos_events (sos_id, recipient_id, actor_id, actor_name, kind)
     VALUES ($1, $2, $3, 'Rider B', 'responder_a_caminho')`,
    [sosId, riderA, riderB]
  );

  const eventosDoAutor = await expectOk(
    db,
    'sos_events: consulta de eventos do autor via recipient_id',
    `SELECT id, actor_name, kind, created_at
     FROM sos_events
     WHERE recipient_id = $1
     ORDER BY created_at DESC`,
    [riderA]
  );
  check('eventos do autor listam 1 evento recente', eventosDoAutor.length === 1);

  await expectOk(
    db,
    'inscrição de Web Push criada com sucesso',
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, 'https://push.services.mozilla.com/123', 'p256key', 'authkey', 'Firefox Mobile')
     RETURNING id`,
    [riderB]
  );

  await expectFail(
    db,
    'push_subscriptions: endpoint UNIQUE rejeita duplicata direta',
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, 'https://push.services.mozilla.com/123', 'k', 'a')`,
    [riderB]
  );

  await expectOk(
    db,
    'push_subscriptions: UPSERT por endpoint atualiza sem erro',
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_used_at, failure_count)
     VALUES ($1, 'https://push.services.mozilla.com/123', 'p256_new', 'auth_new', 'Chrome', NOW(), 0)
     ON CONFLICT (endpoint) DO UPDATE
       SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, last_used_at = NOW(), failure_count = 0`,
    [riderB]
  );

  // --------------------------------------------------- push nativo (FCM)
  await expectOk(
    db,
    'registro de token FCM criado com sucesso',
    `INSERT INTO fcm_tokens (user_id, token, device_name, platform, last_used_at)
     VALUES ($1, 'fcm-token-abc123', 'Pixel 7', 'android', NOW())
     RETURNING id`,
    [riderB]
  );

  await expectFail(
    db,
    'fcm_tokens: token UNIQUE rejeita duplicata direta',
    `INSERT INTO fcm_tokens (user_id, token) VALUES ($1, 'fcm-token-abc123')`,
    [riderB]
  );

  await expectOk(
    db,
    'fcm_tokens: UPSERT por token atualiza sem erro (re-registro do mesmo dispositivo)',
    `INSERT INTO fcm_tokens (user_id, token, device_name, last_used_at, failure_count)
     VALUES ($1, 'fcm-token-abc123', 'Pixel 7 (atualizado)', NOW(), 0)
     ON CONFLICT (token) DO UPDATE
       SET device_name = EXCLUDED.device_name, last_used_at = NOW(), failure_count = 0`,
    [riderB]
  );

  await expectOk(
    db,
    'mesmo usuário pode ter múltiplos tokens FCM (multi-dispositivo)',
    `INSERT INTO fcm_tokens (user_id, token, device_name)
     VALUES ($1, 'fcm-token-outro-aparelho', 'Galaxy S23')
     RETURNING id`,
    [riderB]
  );

  await expectOk(
    db,
    'atualização de contato de emergência no perfil',
    `UPDATE users
     SET emergency_contact_name = 'Maria Velejadora', emergency_contact_phone = '84999998888'
     WHERE id = $1 RETURNING emergency_contact_name, emergency_contact_phone`,
    [riderA]
  );

  // Réplica do PATCH auto-atendido em app/api/profile/route.ts: o próprio
  // velejador edita peso e altura, com COALESCE preservando o que não foi enviado.
  const perfilAtualizado = await expectOk(
    db,
    'atualização de altura e peso no perfil (auto-atendida)',
    `UPDATE users SET
       height_cm = COALESCE($2, height_cm),
       weight_kg = COALESCE($3, weight_kg)
     WHERE id = $1 RETURNING height_cm, weight_kg`,
    [riderA, 178.5, 82]
  );
  check(
    'height_cm gravado corretamente',
    Number(perfilAtualizado[0]?.height_cm) === 178.5
  );
  const perfilPreservaAltura = await expectOk(
    db,
    'PATCH de perfil sem altura preserva o valor anterior (COALESCE)',
    `UPDATE users SET
       height_cm = COALESCE($2, height_cm),
       weight_kg = COALESCE($3, weight_kg)
     WHERE id = $1 RETURNING height_cm, weight_kg`,
    [riderA, null, 85]
  );
  check(
    'height_cm não enviado permanece intacto',
    Number(perfilPreservaAltura[0]?.height_cm) === 178.5
  );

  console.log('\nSeleção de candidatos do SOS (bug real: query antiga estourava, lat/lng não existiam):');

  const riderPos = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('pos@t.local', '$2b$12$x', 'Rider Pos', '2001') RETURNING id`
    )
  ).rows[0].id;
  const riderSpot = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('spot@t.local', '$2b$12$x', 'Rider Spot', '2002') RETURNING id`
    )
  ).rows[0].id;
  const riderOld = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('old@t.local', '$2b$12$x', 'Rider Old', '2003') RETURNING id`
    )
  ).rows[0].id;
  const riderNoPos = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('nopos@t.local', '$2b$12$x', 'Rider Sem Posição', '2004') RETURNING id`
    )
  ).rows[0].id;

  // (a) posição real dentro da janela, bem perto da origem do SOS
  await db.query(
    `INSERT INTO user_presence (user_id, last_seen_at, lat, lng, pos_updated_at)
     VALUES ($1, NOW(), -4.9580, -36.8830, NOW())`,
    [riderPos]
  );
  // (b) sem posição fresca, mas com at_spot_id conhecido (fallback pelo spot)
  await db.query(
    `INSERT INTO user_presence (user_id, last_seen_at, at_spot_id)
     VALUES ($1, NOW(), 'ponta-do-mel')`,
    [riderSpot]
  );
  // Presença fora da janela (16 min, janela é 15 min) — não pode entrar mesmo tendo posição
  await db.query(
    `INSERT INTO user_presence (user_id, last_seen_at, lat, lng, pos_updated_at)
     VALUES ($1, NOW() - INTERVAL '16 minutes', -4.9580, -36.8830, NOW() - INTERVAL '16 minutes')`,
    [riderOld]
  );
  // Presença fresca, mas sem posição real E sem spot declarado — não há como saber se está no raio
  await db.query(`INSERT INTO user_presence (user_id, last_seen_at) VALUES ($1, NOW())`, [riderNoPos]);

  // Réplica exata da query de lib/sosCandidates.ts (o cutoff é calculado em JS,
  // igual à produção, para não cair no mesmo bug de INTERVAL parametrizado).
  const janelaPresencaMs = 15 * 60 * 1000;
  const cutoff = new Date(Date.now() - janelaPresencaMs).toISOString();
  const origin = { lat: -4.9572, lng: -36.8833 };
  const raioKm = 5;
  const deltaLat = raioKm / 111;
  const deltaLng = Math.abs(raioKm / (111 * Math.cos((origin.lat * Math.PI) / 180)));
  const box = {
    minLat: origin.lat - deltaLat,
    maxLat: origin.lat + deltaLat,
    minLng: origin.lng - deltaLng,
    maxLng: origin.lng + deltaLng,
  };

  const candRows = await expectOk(
    db,
    'seleção de candidatos do SOS: query real roda contra Postgres sem erro',
    `SELECT user_id, cand_lat, cand_lng FROM (
       SELECT
         p.user_id AS user_id,
         COALESCE(
           CASE WHEN p.pos_updated_at >= $2 THEN p.lat END,
           s.lat
         ) AS cand_lat,
         COALESCE(
           CASE WHEN p.pos_updated_at >= $2 THEN p.lng END,
           s.lng
         ) AS cand_lng
       FROM user_presence p
       LEFT JOIN spots s ON s.id = p.at_spot_id
       WHERE p.user_id != $1
         AND p.last_seen_at >= $2
     ) candidato
     WHERE cand_lat IS NOT NULL AND cand_lng IS NOT NULL
       AND cand_lat BETWEEN $3 AND $4
       AND cand_lng BETWEEN $5 AND $6`,
    [riderA, cutoff, box.minLat, box.maxLat, box.minLng, box.maxLng]
  );

  const candIds = new Set(candRows.map((r) => String(r.user_id)));
  check('candidato com posição real dentro da janela aparece', candIds.has(riderPos));
  check('candidato sem posição fresca mas com at_spot_id conhecido aparece (fallback pelo spot)', candIds.has(riderSpot));
  check('candidato com presença fora da janela NÃO aparece, mesmo com lat/lng gravados', !candIds.has(riderOld));
  check('candidato sem posição e sem spot NÃO aparece', !candIds.has(riderNoPos));

  const spotCandRow = candRows.find((r) => String(r.user_id) === riderSpot);
  check(
    'fallback por spot traz as coordenadas do spot (não NULL)',
    Boolean(spotCandRow && spotCandRow.cand_lat !== null && spotCandRow.cand_lng !== null)
  );

  console.log('\ntouchPresence: heartbeat sem coordenada preserva a última posição (lib/presence.ts):');

  // Réplica do UPSERT de touchPresence: primeiro heartbeat com coordenada,
  // segundo sem — a posição não pode ser apagada só porque o navegador não
  // reenviou coordenada nesse tique.
  await db.query(
    `INSERT INTO user_presence (user_id, last_seen_at, room, at_spot_id, lat, lng, pos_updated_at)
     VALUES ($1, NOW(), NULL, NULL, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET last_seen_at = NOW(), room = NULL, at_spot_id = NULL,
           lat = COALESCE($2, user_presence.lat), lng = COALESCE($3, user_presence.lng),
           pos_updated_at = COALESCE(NOW(), user_presence.pos_updated_at)`,
    [riderPos, -4.96, -36.88]
  );
  await db.query(
    `INSERT INTO user_presence (user_id, last_seen_at, room, at_spot_id, lat, lng, pos_updated_at)
     VALUES ($1, NOW(), NULL, NULL, $2, $3, NULL)
     ON CONFLICT (user_id) DO UPDATE
       SET last_seen_at = NOW(), room = NULL, at_spot_id = NULL,
           lat = COALESCE($2, user_presence.lat), lng = COALESCE($3, user_presence.lng),
           pos_updated_at = COALESCE(NULL, user_presence.pos_updated_at)`,
    [riderPos, null, null]
  );
  const preservedPos = await db.query<{ lat: string; lng: string }>(
    `SELECT lat, lng FROM user_presence WHERE user_id = $1`,
    [riderPos]
  );
  check(
    'heartbeat sem lat/lng não apaga a posição gravada no heartbeat anterior',
    Number(preservedPos.rows[0]?.lat) === -4.96 && Number(preservedPos.rows[0]?.lng) === -36.88
  );

  console.log('\nListagem de SOS ativos inclui em_atendimento (bug real: alerta sumia quando alguém ia socorrer):');

  await db.query(`UPDATE sos_alerts SET status = 'em_atendimento' WHERE id = $1`, [sosId]);

  const newListing = await expectOk(
    db,
    'listagem de ativos (query corrigida) inclui status em_atendimento',
    `SELECT DISTINCT sa.id, sa.status
     FROM sos_alerts sa
     LEFT JOIN sos_responders sr ON sr.sos_id = sa.id
     WHERE sa.status IN ('ativo', 'em_atendimento')
       AND (sa.user_id = $1 OR sr.user_id = $1)`,
    [riderA]
  );
  check('SOS em_atendimento aparece para o próprio autor', newListing.some((r) => String(r.id) === sosId));

  const oldListing = await db.query(
    `SELECT DISTINCT sa.id, sa.status
     FROM sos_alerts sa
     LEFT JOIN sos_responders sr ON sr.sos_id = sa.id
     WHERE sa.status = 'ativo'
       AND (sa.user_id = $1 OR sr.user_id = $1)`,
    [riderA]
  );
  check(
    'confirma o bug: a query antiga (só status = ativo) escondia o SOS em_atendimento',
    !oldListing.rows.some((r) => String((r as Record<string, unknown>).id) === sosId)
  );

  console.log('\nDownwind:');

  const dw = await db.query<{ id: string }>(
    `INSERT INTO downwinds (nome, spot_saida, spot_chegada, criado_por, previsto_para)
     VALUES ('Ponta do Mel -> Barra', 'ponta-do-mel', 'ponta-do-mel', $1, NOW() + INTERVAL '1 day')
     RETURNING id`,
    [adminId]
  );
  const dwId = dw.rows[0].id;
  check('criação de downwind', Boolean(dwId));

  await expectFail(
    db,
    'downwind status fora do CHECK é rejeitado',
    `INSERT INTO downwinds (nome, status) VALUES ('X', 'pendente')`
  );

  const evParaDw = await db.query<{ id: string }>(
    `INSERT INTO events (title, event_date, location, type, description, organizer)
     VALUES ('Downwind Touros -> Ponta do Mel', '28/08', 'RN', 'Downwind', 'D', 'Org') RETURNING id`
  );
  const evParaDwId = evParaDw.rows[0].id;
  const dwComEvento = await expectOk(
    db,
    'downwind nasce vinculado ao evento que o originou (event_id)',
    `INSERT INTO downwinds (nome, event_id, criado_por) VALUES ('Vinculado', $1, $2) RETURNING id, event_id`,
    [evParaDwId, adminId]
  );
  check(
    'downwind carrega o event_id do evento que o criou',
    String(dwComEvento[0].event_id) === evParaDwId
  );

  await expectOk(
    db,
    'query "este evento tem downwind?" via event_id',
    `SELECT id FROM downwinds WHERE event_id = $1`,
    [evParaDwId]
  );

  await db.query(`DELETE FROM events WHERE id = $1`, [evParaDwId]);
  const dwOrfaoDeEvento = await db.query<{ event_id: string | null }>(
    `SELECT event_id FROM downwinds WHERE id = $1`,
    [String(dwComEvento[0].id)]
  );
  check(
    'apagar o evento não apaga o downwind, só zera event_id (SET NULL, não CASCADE)',
    dwOrfaoDeEvento.rows.length === 1 && dwOrfaoDeEvento.rows[0].event_id === null
  );

  await expectOk(
    db,
    'downwind_participantes: organizador que também veleja entra como velejador + eh_organizador (papel e eh_organizador são dimensões separadas — ver comentário no schema)',
    `INSERT INTO downwind_participantes (downwind_id, user_id, papel, eh_organizador)
     VALUES ($1, $2, 'velejador', TRUE)`,
    [dwId, adminId]
  );
  await expectOk(
    db,
    'downwind_participantes: velejador comum entra (eh_organizador default FALSE)',
    `INSERT INTO downwind_participantes (downwind_id, user_id, papel)
     VALUES ($1, $2, 'velejador')`,
    [dwId, riderA]
  );
  await expectOk(
    db,
    'downwind_participantes: organizador que fica em terra entra como apoio_terra + eh_organizador (organizador pode estar em qualquer um dos dois lugares)',
    `INSERT INTO downwind_participantes (downwind_id, user_id, papel, eh_organizador)
     VALUES ($1, $2, 'apoio_terra', TRUE)`,
    [dwId, riderB]
  );

  await expectFail(
    db,
    'downwind_participantes: papel fora do CHECK é rejeitado',
    `INSERT INTO downwind_participantes (downwind_id, user_id, papel)
     VALUES ($1, $2, 'piloto')`,
    [dwId, riderPos]
  );
  await expectFail(
    db,
    "downwind_participantes: 'organizador' não é mais um papel válido — virou a coluna eh_organizador",
    `INSERT INTO downwind_participantes (downwind_id, user_id, papel)
     VALUES ($1, $2, 'organizador')`,
    [dwId, riderSpot]
  );
  await expectFail(
    db,
    'downwind_participantes: estado fora do CHECK é rejeitado',
    `INSERT INTO downwind_participantes (downwind_id, user_id, papel, estado)
     VALUES ($1, $2, 'velejador', 'voando')`,
    [dwId, riderSpot]
  );
  await expectFail(
    db,
    'downwind_participantes: PK composta rejeita duplicata (mesmo downwind + usuário)',
    `INSERT INTO downwind_participantes (downwind_id, user_id, papel) VALUES ($1, $2, 'velejador')`,
    [dwId, riderA]
  );

  await db.query(
    `INSERT INTO downwind_posicoes (downwind_id, user_id, lat, lng, accuracy_m, registrado_em)
     VALUES ($1, $2, -4.9572, -36.8833, 8.0, NOW() - INTERVAL '2 minutes')`,
    [dwId, riderA]
  );
  await db.query(
    `INSERT INTO downwind_posicoes (downwind_id, user_id, lat, lng, accuracy_m, registrado_em)
     VALUES ($1, $2, -4.9600, -36.8900, 6.0, NOW())`,
    [dwId, riderA]
  );
  await db.query(
    `INSERT INTO downwind_posicoes (downwind_id, user_id, lat, lng, accuracy_m, registrado_em)
     VALUES ($1, $2, -4.9550, -36.8800, 10.0, NOW())`,
    [dwId, riderB]
  );

  const ultimasPos = await expectOk(
    db,
    'query da UI: última posição de cada participante do downwind',
    `SELECT DISTINCT ON (user_id) user_id, lat, lng, registrado_em
     FROM downwind_posicoes
     WHERE downwind_id = $1
     ORDER BY user_id, registrado_em DESC`,
    [dwId]
  );
  check('última posição traz 1 linha por participante com posição', ultimasPos.length === 2);
  const ultimaDeA = ultimasPos.find((r) => String(r.user_id) === riderA);
  check(
    'última posição de A é a mais recente (não a primeira gravada)',
    Number(ultimaDeA?.lng) === -36.89
  );

  const trilhaDeA = await expectOk(
    db,
    'query da UI: trilha de um participante em ordem cronológica',
    `SELECT lat, lng, registrado_em FROM downwind_posicoes
     WHERE downwind_id = $1 AND user_id = $2
     ORDER BY registrado_em ASC`,
    [dwId, riderA]
  );
  check('trilha de A tem as 2 posições gravadas, em ordem', trilhaDeA.length === 2);

  // ------------------------------------- downwind_tracking_tokens (Foreground Service Android)
  const trackingToken = await expectOk(
    db,
    'downwind_tracking_tokens: emissão de token de rastreio para o Foreground Service',
    `INSERT INTO downwind_tracking_tokens (token_hash, downwind_id, user_id, expires_at)
     VALUES ('tt-hash-abc123', $1, $2, NOW() + INTERVAL '24 hours')
     RETURNING id, token_hash`,
    [dwId, riderA]
  );
  check('token de rastreio criado', trackingToken.length === 1);

  await expectFail(
    db,
    'downwind_tracking_tokens: token_hash UNIQUE rejeita duplicata',
    `INSERT INTO downwind_tracking_tokens (token_hash, downwind_id, user_id, expires_at)
     VALUES ('tt-hash-abc123', $1, $2, NOW() + INTERVAL '24 hours')`,
    [dwId, riderB]
  );

  await expectFail(
    db,
    'downwind_tracking_tokens: downwind_id inexistente é rejeitado (FK)',
    `INSERT INTO downwind_tracking_tokens (token_hash, downwind_id, user_id, expires_at)
     VALUES ('tt-hash-fk-invalida', '00000000-0000-0000-0000-000000000000', $1, NOW() + INTERVAL '24 hours')`,
    [riderA]
  );

  const tokenValido = await expectOk(
    db,
    'downwind_tracking_tokens: consulta de validação (escopo do downwind + não expirado + não revogado)',
    `SELECT user_id, downwind_id FROM downwind_tracking_tokens
     WHERE token_hash = 'tt-hash-abc123' AND expires_at > NOW() AND revoked_at IS NULL`,
    []
  );
  check(
    'token válido resolve para o usuário e downwind corretos',
    tokenValido.length === 1 &&
      String(tokenValido[0].user_id) === riderA &&
      String(tokenValido[0].downwind_id) === dwId
  );

  await db.query(
    `UPDATE downwind_tracking_tokens SET revoked_at = NOW() WHERE token_hash = 'tt-hash-abc123'`
  );
  const tokenRevogado = await db.query(
    `SELECT id FROM downwind_tracking_tokens
     WHERE token_hash = 'tt-hash-abc123' AND revoked_at IS NULL`
  );
  check('token revogado não passa mais no filtro de "ativo"', tokenRevogado.rows.length === 0);

  await db.query(
    `INSERT INTO downwind_tracking_tokens (token_hash, downwind_id, user_id, expires_at)
     VALUES ('tt-hash-outro-downwind', $1, $2, NOW() + INTERVAL '24 hours')`,
    [dwId, riderB]
  );
  const tokenEscopoErrado = await db.query(
    `SELECT id FROM downwind_tracking_tokens
     WHERE token_hash = 'tt-hash-outro-downwind' AND downwind_id = '00000000-0000-0000-0000-000000000000'`
  );
  check(
    'token de um downwind não resolve para downwind_id diferente (escopo restrito)',
    tokenEscopoErrado.rows.length === 0
  );

  const meusDownwindsAtivos = await expectOk(
    db,
    'query da tela inicial: downwinds ativos de um usuário (usa idx_downwind_participantes_user)',
    `SELECT d.id, d.nome, d.status, dp.papel
     FROM downwind_participantes dp
     JOIN downwinds d ON d.id = dp.downwind_id
     WHERE dp.user_id = $1 AND d.status IN ('aberto', 'em_andamento')`,
    [riderA]
  );
  check(
    'downwinds ativos de A inclui o downwind recém-criado',
    meusDownwindsAtivos.some((r) => String(r.id) === dwId)
  );
  const meusDownwindsB = await db.query(
    `SELECT d.id FROM downwind_participantes dp
     JOIN downwinds d ON d.id = dp.downwind_id
     WHERE dp.user_id = $1 AND d.status IN ('aberto', 'em_andamento')`,
    [riderB]
  );
  check(
    'downwinds ativos de B também aparece (apoio_terra conta na busca por pessoa)',
    meusDownwindsB.rows.some((r) => String((r as Record<string, unknown>).id) === dwId)
  );

  const convite = await expectOk(
    db,
    'downwind_convites: criação do link de convite',
    `INSERT INTO downwind_convites (downwind_id, token_hash, criado_por, papel_destino, expira_em)
     VALUES ($1, 'dw-convite-hash', $2, 'velejador', NOW() + INTERVAL '7 days')
     RETURNING id`,
    [dwId, adminId]
  );
  check('convite de downwind criado', convite.length === 1);

  await expectOk(
    db,
    'downwind_convites: reutilizável, mais de um usuário entra com o mesmo token',
    `SELECT id, papel_destino FROM downwind_convites
     WHERE token_hash = $1 AND revogado_em IS NULL AND expira_em > NOW()
       AND (max_usos IS NULL OR usos < max_usos)`,
    ['dw-convite-hash']
  );

  await expectFail(
    db,
    'downwind_convites: papel_destino fora do CHECK é rejeitado',
    `INSERT INTO downwind_convites (downwind_id, token_hash, criado_por, papel_destino, expira_em)
     VALUES ($1, 'dw-convite-hash-invalido', $2, 'organizador', NOW() + INTERVAL '7 days')`,
    [dwId, adminId]
  );

  // ---------------------------------------------------- downwind_user_invites
  const userInvite = await expectOk(
    db,
    'downwind_user_invites: criação de convite para velejador cadastrado',
    `INSERT INTO downwind_user_invites (downwind_id, inviter_id, invitee_id, role, expires_at)
     VALUES ($1, $2, $3, 'velejador', NOW() + INTERVAL '7 days')
     RETURNING id, role, status`,
    [dwId, adminId, riderB]
  );
  check('convite de usuário cadastrado criado com sucesso', userInvite.length === 1 && userInvite[0].status === 'pendente');

  const userInviteLink = await expectOk(
    db,
    'downwind_user_invites: criação de convite por link com token_hash',
    `INSERT INTO downwind_user_invites (downwind_id, inviter_id, token_hash, role, expires_at)
     VALUES ($1, $2, 'hash-link-dw-123', 'velejador', NOW() + INTERVAL '7 days')
     RETURNING id, token_hash`,
    [dwId, adminId]
  );
  check('convite por link criado', userInviteLink.length === 1);

  await expectFail(
    db,
    'downwind_user_invites: status fora do CHECK é rejeitado',
    `INSERT INTO downwind_user_invites (downwind_id, inviter_id, invitee_id, status, expires_at)
     VALUES ($1, $2, $3, 'invalido', NOW() + INTERVAL '7 days')`,
    [dwId, adminId, riderA]
  );

  const convitesPendentesB = await expectOk(
    db,
    'downwind_user_invites: consulta de convites pendentes de um usuário (usa idx_dw_user_invites_invitee)',
    `SELECT dui.id, dui.downwind_id, d.nome, u.name AS inviter_name
     FROM downwind_user_invites dui
     JOIN downwinds d ON d.id = dui.downwind_id
     JOIN users u ON u.id = dui.inviter_id
     WHERE dui.invitee_id = $1 AND dui.status = 'pendente' AND dui.expires_at > NOW()`,
    [riderB]
  );
  check('usuário B tem 1 convite pendente', convitesPendentesB.length === 1);

  console.log('\nDownwind — mapa ao vivo (posições, trilha, apoio, status):');

  // Dois usuários descartáveis: um motorista que vai ser APAGADO (para provar o
  // ON DELETE SET NULL de apoio_user_id sem destruir riderB, que a cascata
  // adiante ainda usa) e um velejador que vai ser marcado 'encerrado' (para
  // provar que quem saiu da água some do mapa).
  const dwApoioDescartavel = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('apoio-descartavel@t.local', '$2b$12$x', 'Motorista Descartável', '3001') RETURNING id`
    )
  ).rows[0].id;
  const dwSaiu = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('dw-saiu@t.local', '$2b$12$x', 'Velejador Que Saiu', '3002') RETURNING id`
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO downwind_participantes (downwind_id, user_id, papel) VALUES ($1, $2, 'apoio_terra')`,
    [dwId, dwApoioDescartavel]
  );
  await db.query(
    `INSERT INTO downwind_participantes (downwind_id, user_id, papel) VALUES ($1, $2, 'velejador')`,
    [dwId, dwSaiu]
  );
  await db.query(
    `INSERT INTO downwind_posicoes (downwind_id, user_id, lat, lng) VALUES ($1, $2, -4.9500, -36.8700)`,
    [dwId, dwSaiu]
  );

  // (1) Caminho feliz do vínculo de apoio: velejador aponta para um apoio_terra
  // do mesmo downwind. A validação do invariante é da aplicação
  // (lib/downwindAcesso.ts) — aqui provamos só que a coluna e a FK existem.
  await expectOk(
    db,
    'apoio_user_id: velejador aponta para um apoio_terra do mesmo downwind',
    `UPDATE downwind_participantes SET apoio_user_id = $3
     WHERE downwind_id = $1 AND user_id = $2`,
    [dwId, riderA, riderB]
  );

  // (2) A query central da rota GET /posicoes. LEFT JOIN LATERAL e não
  // DISTINCT ON porque participante que NUNCA reportou tem que aparecer na
  // lista com lat/lng nulos — DISTINCT ON some com ele.
  const mapaPosicoes = await expectOk(
    db,
    'query da rota do mapa: participantes + última posição (LEFT JOIN LATERAL)',
    `SELECT dp.user_id, u.name, u.avatar_url, dp.papel, dp.eh_organizador, dp.estado,
            dp.apoio_user_id, p.lat, p.lng, p.accuracy_m, p.registrado_em
     FROM downwind_participantes dp
     JOIN users u ON u.id = dp.user_id
     LEFT JOIN LATERAL (
       SELECT lat, lng, accuracy_m, registrado_em
       FROM downwind_posicoes
       WHERE downwind_id = dp.downwind_id AND user_id = dp.user_id
       ORDER BY registrado_em DESC LIMIT 1
     ) p ON TRUE
     WHERE dp.downwind_id = $1 AND dp.estado NOT IN ('encerrado', 'desistiu')`,
    [dwId]
  );
  check(
    'participante sem posição nenhuma aparece na lista (lat nulo), não some',
    mapaPosicoes.some(
      (r) => String(r.user_id) === dwApoioDescartavel && r.lat === null
    )
  );
  check(
    'a última posição trazida é a mais recente do participante',
    Number(mapaPosicoes.find((r) => String(r.user_id) === riderA)?.lng) === -36.89
  );

  // (3) Quem já saiu da água para de ter posição compartilhada — continuar
  // transmitindo seria vigiar a pessoa no caminho de casa.
  await db.query(
    `UPDATE downwind_participantes SET estado = 'encerrado', encerrou_em = NOW()
     WHERE downwind_id = $1 AND user_id = $2`,
    [dwId, dwSaiu]
  );
  const mapaSemQuemSaiu = await db.query(
    `SELECT dp.user_id FROM downwind_participantes dp
     WHERE dp.downwind_id = $1 AND dp.estado NOT IN ('encerrado', 'desistiu')`,
    [dwId]
  );
  check(
    "posição de quem está 'encerrado' não é servida no mapa",
    !mapaSemQuemSaiu.rows.some(
      (r) => String((r as Record<string, unknown>).user_id) === dwSaiu
    )
  );

  // (4) A query de autorização do GET /posicoes. É este zero que a rota
  // traduz em 404 (nunca 403: um 403 confirmaria que o downwind existe, e
  // isso já é informação sobre onde um grupo está navegando).
  const souParticipante = await expectOk(
    db,
    'query de autorização do mapa: sou participante deste downwind?',
    `SELECT 1 AS ok FROM downwind_participantes
     WHERE downwind_id = $1 AND user_id = $2 AND estado <> 'desistiu'`,
    [dwId, riderA]
  );
  check('participante legítimo passa na checagem de acesso', souParticipante.length === 1);
  const naoParticipante = await db.query(
    `SELECT 1 AS ok FROM downwind_participantes
     WHERE downwind_id = $1 AND user_id = $2 AND estado <> 'desistiu'`,
    [dwId, riderPos]
  );
  check(
    'quem não é participante recebe zero linhas (vira 404 na rota, não 403)',
    naoParticipante.rows.length === 0
  );

  // (5) Apagar a conta do motorista não pode tirar o velejador do downwind,
  // só deixá-lo sem apoio designado.
  await db.query(
    `UPDATE downwind_participantes SET apoio_user_id = $3
     WHERE downwind_id = $1 AND user_id = $2`,
    [dwId, dwSaiu, dwApoioDescartavel]
  );
  await db.query(`DELETE FROM users WHERE id = $1`, [dwApoioDescartavel]);
  const apoiadoOrfao = await db.query<{ apoio_user_id: string | null }>(
    `SELECT apoio_user_id FROM downwind_participantes
     WHERE downwind_id = $1 AND user_id = $2`,
    [dwId, dwSaiu]
  );
  check(
    'apagar o motorista zera apoio_user_id mas mantém o velejador no downwind (SET NULL)',
    apoiadoOrfao.rows.length === 1 && apoiadoOrfao.rows[0].apoio_user_id === null
  );

  // (6) Carga inicial da trilha, amostrada no banco: a travessia inteira tem
  // centenas de pontos por pessoa e o payload não pode crescer com ela.
  await expectOk(
    db,
    'query de trilha amostrada (row_number + módulo) para a carga inicial',
    `SELECT user_id, lat, lng, registrado_em FROM (
       SELECT user_id, lat, lng, registrado_em,
              row_number() OVER (PARTITION BY user_id ORDER BY registrado_em DESC) AS rn,
              count(*)     OVER (PARTITION BY user_id) AS total
       FROM downwind_posicoes WHERE downwind_id = $1
     ) t
     WHERE rn = 1 OR rn % GREATEST(1, CEIL(total::numeric / $2)::int) = 0
     ORDER BY user_id, registrado_em`,
    [dwId, 120]
  );

  // (7) Em regime, cada poll traz só o que chegou desde o cursor anterior —
  // é o que mantém o payload em poucos KB numa travessia de 3h.
  const delta = await expectOk(
    db,
    'query de delta da trilha (só o que chegou desde o cursor)',
    `SELECT user_id, lat, lng, registrado_em
     FROM downwind_posicoes
     WHERE downwind_id = $1 AND registrado_em > $2
     ORDER BY user_id, registrado_em
     LIMIT 1200`,
    [dwId, new Date(Date.now() - 60_000).toISOString()]
  );
  check('delta traz só as posições recentes, não a trilha inteira', delta.length < 4);

  // (8) O UPDATE de status é atômico com o timestamp, como o comentário do
  // schema manda: coerência de máquina de estados é da camada que conhece as
  // transições, não de um CHECK cross-column.
  const iniciou = await expectOk(
    db,
    "início do downwind: UPDATE atômico status + iniciado_em, condicionado ao status atual",
    `UPDATE downwinds SET status = 'em_andamento', iniciado_em = COALESCE(iniciado_em, NOW())
     WHERE id = $1 AND status = 'aberto' RETURNING id`,
    [dwId]
  );
  check('primeiro velejador a tocar Iniciar move o downwind para em_andamento', iniciou.length === 1);

  // (9) Dois velejadores tocando Iniciar juntos: o `AND status =` resolve a
  // corrida no banco, igual ao `WHERE used_at IS NULL` dos convites.
  const iniciouDeNovo = await db.query(
    `UPDATE downwinds SET status = 'em_andamento', iniciado_em = COALESCE(iniciado_em, NOW())
     WHERE id = $1 AND status = 'aberto' RETURNING id`,
    [dwId]
  );
  check(
    'segundo Iniciar simultâneo não faz nada (0 linhas) — a corrida morre no banco',
    iniciouDeNovo.rows.length === 0
  );

  // (10) Mesmo padrão no encerramento.
  const encerrou = await expectOk(
    db,
    'encerramento do downwind: UPDATE atômico status + encerrado_em',
    `UPDATE downwinds SET status = 'encerrado', encerrado_em = COALESCE(encerrado_em, NOW())
     WHERE id = $1 AND status = 'em_andamento' RETURNING id`,
    [dwId]
  );
  check('encerramento a partir de em_andamento funciona', encerrou.length === 1);

  // (11) e (12) O invariante "um evento tem no máximo um downwind", que o
  // rollback manual de app/api/events/route.ts já assume.
  const evUnico = await db.query<{ id: string }>(
    `INSERT INTO events (title, event_date, location, type, description, organizer)
     VALUES ('Downwind Único', '30/08', 'RN', 'Downwind', 'D', 'Org') RETURNING id`
  );
  const evUnicoId = evUnico.rows[0].id;
  await db.query(
    `INSERT INTO downwinds (nome, event_id, criado_por) VALUES ('Primeiro', $1, $2)`,
    [evUnicoId, adminId]
  );
  await expectFail(
    db,
    'ux_downwinds_event: segundo downwind no mesmo evento é rejeitado',
    `INSERT INTO downwinds (nome, event_id, criado_por) VALUES ('Segundo', $1, $2)`,
    [evUnicoId, adminId]
  );
  await expectOk(
    db,
    'ux_downwinds_event é parcial: vários downwinds sem evento convivem',
    `INSERT INTO downwinds (nome, event_id, criado_por) VALUES ('Sem Evento A', NULL, $1),
                                                              ('Sem Evento B', NULL, $1)`,
    [adminId]
  );

  // (13) O resumo que permite apagar a trilha bruta depois sem destruir o que
  // o velejador quer rever.
  const resumo = await expectOk(
    db,
    'resumo da travessia: distancia_km, velocidade_max_nos e trilha_reduzida (JSONB)',
    `UPDATE downwind_participantes
     SET distancia_km = 18.40, velocidade_max_nos = 27.30, trilha_reduzida = $3::jsonb
     WHERE downwind_id = $1 AND user_id = $2
     RETURNING distancia_km, velocidade_max_nos, trilha_reduzida`,
    [dwId, riderA, JSON.stringify([[-4.95, -36.88, 1700000000000], [-4.96, -36.89, 1700000060000]])]
  );
  check(
    'resumo volta do banco com os três campos preenchidos',
    Number(resumo[0].distancia_km) === 18.4 &&
      Number(resumo[0].velocidade_max_nos) === 27.3 &&
      Array.isArray(resumo[0].trilha_reduzida) &&
      (resumo[0].trilha_reduzida as unknown[]).length === 2
  );

  // (14) Retenção. Não há cron no plano gratuito da Vercel, então a limpeza é
  // preguiçosa — disparada por quem encerra um downwind, no espírito da
  // escalada de raio do SOS (app/api/sos/active/route.ts).
  await expectOk(
    db,
    'purga preguiçosa: apaga trilha bruta de downwinds encerrados há mais de 7 dias',
    `DELETE FROM downwind_posicoes p USING downwinds d
      WHERE d.id = p.downwind_id
        AND d.status IN ('encerrado', 'cancelado')
        AND d.encerrado_em < NOW() - INTERVAL '7 days'`
  );

  console.log('\nDownwind — link de convidado (apoio em terra sem conta, 12h):');

  const dwConvite = await db.query<{ id: string }>(
    `INSERT INTO downwinds (nome, criado_por) VALUES ('Convite Teste', $1) RETURNING id`,
    [adminId]
  );
  const dwConviteId = dwConvite.rows[0].id;

  await expectOk(
    db,
    'convite de apoio: criação do link com papel_destino apoio_terra',
    `INSERT INTO downwind_convites (downwind_id, token_hash, criado_por, papel_destino, expira_em)
     VALUES ($1, 'dw-motorista-hash', $2, 'apoio_terra', NOW() + INTERVAL '12 hours')
     RETURNING id`,
    [dwConviteId, adminId]
  );

  const guestUser = await expectOk(
    db,
    'conta-convidada: criação com downwind_guest_of apontando para o downwind',
    `INSERT INTO users (email, password_hash, name, rider_id, downwind_guest_of)
     VALUES ('convidado-abc123@dw.kiteninja.guest', '$2b$12$x', 'Motorista Convidado', 'CONV-ABC123', $1)
     RETURNING id, downwind_guest_of`,
    [dwConviteId]
  );
  const guestUserId = String(guestUser[0].id);
  check(
    'downwind_guest_of da conta bate com o downwind do convite',
    String(guestUser[0].downwind_guest_of) === dwConviteId
  );

  await expectOk(
    db,
    'conta-convidada entra como apoio_terra, igual a qualquer participante',
    `INSERT INTO downwind_participantes (downwind_id, user_id, papel) VALUES ($1, $2, 'apoio_terra')`,
    [dwConviteId, guestUserId]
  );

  await expectOk(
    db,
    'query de escopo do convidado: getSessionUser() traz downwind_guest_of junto do resto da sessão',
    `SELECT u.id, u.downwind_guest_of FROM users u WHERE u.id = $1`,
    [guestUserId]
  );

  await expectOk(
    db,
    'purga preguiçosa de contas-convidadas expiradas (roda junto do encerramento do downwind)',
    `DELETE FROM users WHERE downwind_guest_of IS NOT NULL AND created_at < NOW() - INTERVAL '2 days'`
  );
  const guestAindaViva = await db.query(`SELECT id FROM users WHERE id = $1`, [guestUserId]);
  check(
    'purga não apaga conta-convidada recém-criada (fora da janela de 2 dias)',
    guestAindaViva.rows.length === 1
  );

  await db.query(`DELETE FROM downwinds WHERE id = $1`, [dwConviteId]);
  const guestOrfaa = await db.query(`SELECT id FROM users WHERE id = $1`, [guestUserId]);
  check(
    'OBRIGATÓRIO: apagar o downwind apaga a conta-convidada junto (ON DELETE CASCADE)',
    guestOrfaa.rows.length === 0
  );

  const contaNormalIntacta = await db.query(`SELECT id FROM users WHERE id = $1`, [riderA]);
  check(
    'uma conta NORMAL (downwind_guest_of NULL) não é afetada pela cascata de downwind nenhum',
    contaNormalIntacta.rows.length === 1
  );

  console.log('\nDownwind — cascata ao apagar o downwind:');
  const dw2 = await db.query<{ id: string }>(
    `INSERT INTO downwinds (nome, criado_por) VALUES ('Descartável', $1) RETURNING id`,
    [adminId]
  );
  const dw2Id = dw2.rows[0].id;
  await db.query(
    `INSERT INTO downwind_participantes (downwind_id, user_id, papel) VALUES ($1, $2, 'velejador')`,
    [dw2Id, riderA]
  );
  await db.query(
    `INSERT INTO downwind_posicoes (downwind_id, user_id, lat, lng) VALUES ($1, $2, -4.95, -36.88)`,
    [dw2Id, riderA]
  );
  await db.query(
    `INSERT INTO downwind_convites (downwind_id, token_hash, criado_por, papel_destino, expira_em)
     VALUES ($1, 'dw-descartavel-hash', $2, 'velejador', NOW() + INTERVAL '7 days')`,
    [dw2Id, adminId]
  );

  await db.query(`DELETE FROM downwinds WHERE id = $1`, [dw2Id]);

  const orphanParticipantes = await db.query(
    `SELECT downwind_id FROM downwind_participantes WHERE downwind_id = $1`,
    [dw2Id]
  );
  check('participantes morrem com o downwind', orphanParticipantes.rows.length === 0);

  const orphanPosicoes = await db.query(
    `SELECT id FROM downwind_posicoes WHERE downwind_id = $1`,
    [dw2Id]
  );
  check('posições morrem com o downwind', orphanPosicoes.rows.length === 0);

  const orphanConvites = await db.query(
    `SELECT id FROM downwind_convites WHERE downwind_id = $1`,
    [dw2Id]
  );
  check('convites morrem com o downwind', orphanConvites.rows.length === 0);

  console.log('\nCascata:');
  await db.query(`INSERT INTO post_comments (post_id, user_id, text) VALUES ($1, $2, 'oi')`, [
    postId,
    riderB,
  ]);
  await db.query(`DELETE FROM users WHERE id = $1`, [riderA]);

  const orphanPosts = await db.query(`SELECT id FROM posts WHERE id = $1`, [postId]);
  check('post morre com o autor', orphanPosts.rows.length === 0);

  const orphanComments = await db.query(`SELECT id FROM post_comments WHERE post_id = $1`, [postId]);
  check('comentários morrem com o post', orphanComments.rows.length === 0);

  const orphanSessions = await db.query(`SELECT id FROM sessions_log WHERE user_id = $1`, [riderA]);
  check('sessões morrem com o autor', orphanSessions.rows.length === 0);

  const orphanSos = await db.query(`SELECT id FROM sos_alerts WHERE user_id = $1`, [riderA]);
  check('sos_alerts morre com o autor', orphanSos.rows.length === 0);

  // riderA seguia B e era seguido por B (seção "Grafo social" acima) — as
  // duas linhas referenciam riderA, uma por follower_id, outra por
  // following_id, e as duas colunas têm ON DELETE CASCADE.
  const orphanFollows = await db.query(
    `SELECT follower_id, following_id FROM user_follows WHERE follower_id = $1 OR following_id = $1`,
    [riderA]
  );
  check(
    'user_follows não deixa rastro do usuário apagado (nem como seguidor, nem como seguido)',
    orphanFollows.rows.length === 0
  );

  const orphanPush = await db.query(`SELECT id FROM push_subscriptions WHERE user_id = $1`, [riderA]);
  check('push_subscriptions morrem com o usuário', orphanPush.rows.length === 0);

  const orphanFcm = await db.query(`SELECT id FROM fcm_tokens WHERE user_id = $1`, [riderA]);
  check('fcm_tokens morrem com o usuário', orphanFcm.rows.length === 0);

  // riderA emitiu 'tt-hash-abc123' (já revogado acima) — confirma que o
  // apagar o usuário também limpa qualquer token de rastreio que sobrou.
  const orphanTrackingTokens = await db.query(
    `SELECT id FROM downwind_tracking_tokens WHERE user_id = $1`,
    [riderA]
  );
  check('downwind_tracking_tokens morrem com o usuário', orphanTrackingTokens.rows.length === 0);

  console.log('\nEventos — ordem da agenda:');

  /*
   * A listagem ordenava por `event_date`, que é TEXT com a data por extenso
   * em português. Ordenar texto é ordenar alfabeticamente, então a agenda
   * saía embaralhada. Este check prova as duas coisas contra Postgres de
   * verdade: que a ordem antiga estava errada, e que a nova está certa.
   */
  const inserirEvento = async (titulo: string, texto: string, at: string | null) =>
    db.query(
      `INSERT INTO events (title, event_date, event_at, location, type, description, organizer)
       VALUES ($1, $2, $3, 'Praia', 'Downwind', 'ordem-agenda', 'y')`,
      [titulo, texto, at]
    );

  await inserirEvento('agosto', '31 de agosto de 2026', '2026-08-31T12:00:00Z');
  await inserirEvento('setembro', '01 de setembro de 2026', '2026-09-01T12:00:00Z');
  await inserirEvento('dezembro', '15 de dezembro de 2026', '2026-12-15T12:00:00Z');
  await inserirEvento('janeiro', '02 de janeiro de 2027', '2027-01-02T12:00:00Z');

  const ordemAntiga = await db.query<{ title: string }>(
    `SELECT title FROM events WHERE description = 'ordem-agenda' ORDER BY event_date ASC`
  );
  check(
    'a ordem ANTIGA (por event_date, texto) estava mesmo errada',
    ordemAntiga.rows[0]?.title !== 'agosto',
    `primeiro=${ordemAntiga.rows[0]?.title}`
  );

  const ordemNova = await db.query<{ title: string }>(
    `SELECT title FROM events WHERE description = 'ordem-agenda'
     ORDER BY event_at ASC NULLS LAST, created_at DESC`
  );
  check(
    'a ordem NOVA (por event_at) segue o calendário',
    ordemNova.rows.map((r) => r.title).join(',') === 'agosto,setembro,dezembro,janeiro',
    ordemNova.rows.map((r) => r.title).join(',')
  );

  // Evento antigo sem event_at vai para o FIM, não para o meio: NULLS LAST.
  await inserirEvento('legado', 'sábado que vem', null);
  const comLegado = await db.query<{ title: string }>(
    `SELECT title FROM events WHERE description = 'ordem-agenda'
     ORDER BY event_at ASC NULLS LAST, created_at DESC`
  );
  check(
    'evento antigo sem data real cai no fim da lista, não no meio',
    comLegado.rows[comLegado.rows.length - 1]?.title === 'legado'
  );

  console.log('\nDownwind abandonado — a travessia que ninguém encerrou:');

  /*
   * O CASO REAL: o downwind "Pernambuquinho x fortaleza" foi iniciado em
   * 31/08 12:10 UTC e continuava `em_andamento` 36 horas depois. Ninguém
   * velejou 36 horas — o velejador chegou na praia e fechou o app.
   *
   * Enquanto ele fica preso em `em_andamento`, `resumirEPurgar` nunca roda, e
   * distancia_km / velocidade_max_nos / trilha_reduzida seguem NULL: A
   * TRAVESSIA NÃO FICA REGISTRADA EM LUGAR NENHUM.
   *
   * Esta seção reproduz o cenário contra Postgres de verdade e prova as duas
   * pontas: que o resumo estava mesmo faltando, e que ele passa a existir.
   */
  const velejadorAbandono = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('abandono@t.local', '$2b$12$x', 'Velejador que nao encerrou', '9101') RETURNING id`
    )
  ).rows[0].id;
  const dwAbandonado = await db.query<{ id: string }>(
    `INSERT INTO downwinds (criado_por, nome, spot_saida, status, previsto_para, iniciado_em)
     VALUES ($1, 'Travessia abandonada', 'ponta-do-mel', 'em_andamento', NOW(), NOW() - INTERVAL '36 hours')
     RETURNING id`,
    [velejadorAbandono]
  );
  const dwAb = dwAbandonado.rows[0].id;
  await db.query(
    `INSERT INTO downwind_participantes (downwind_id, user_id, estado, papel)
     VALUES ($1, $2, 'navegando', 'velejador')`,
    [dwAb, velejadorAbandono]
  );

  // Trilha real: 3 pontos ao longo de 10 min, ~2,2 km, parando 35h atrás.
  for (const [i, lat] of [-4.9, -4.91, -4.92].entries()) {
    await db.query(
      `INSERT INTO downwind_posicoes (downwind_id, user_id, lat, lng, registrado_em)
       VALUES ($1, $2, $3, -37.0, NOW() - INTERVAL '35 hours' + ($4 || ' minutes')::interval)`,
      [dwAb, velejadorAbandono, lat, String(i * 5)]
    );
  }

  const antesDoResumo = await db.query<{ distancia_km: string | null }>(
    `SELECT distancia_km FROM downwind_participantes WHERE downwind_id = $1`,
    [dwAb]
  );
  check(
    'o defeito existe mesmo: sem encerrar, a travessia fica SEM resumo',
    antesDoResumo.rows[0]?.distancia_km === null,
    `distancia_km=${antesDoResumo.rows[0]?.distancia_km}`
  );

  // A consulta de `encerrarAbandonados`: downwinds em andamento com a última
  // posição de qualquer participante.
  const candidatos = await db.query<{ id: string; iniciado_em: string; ultima_posicao_em: string | null }>(
    `SELECT d.id, d.iniciado_em, p.ultima_posicao_em
     FROM downwinds d
     LEFT JOIN LATERAL (
       SELECT MAX(registrado_em) AS ultima_posicao_em
       FROM downwind_posicoes WHERE downwind_id = d.id
     ) p ON TRUE
     WHERE d.status = 'em_andamento' AND d.iniciado_em IS NOT NULL`
  );
  check(
    'a varredura encontra o downwind abandonado',
    candidatos.rows.some((r) => r.id === dwAb),
    `candidatos=${candidatos.rows.length}`
  );

  const alvo = candidatos.rows.find((r) => r.id === dwAb)!;
  const silencioH =
    (Date.now() - new Date(alvo.ultima_posicao_em ?? alvo.iniciado_em).getTime()) / 3_600_000;
  check(
    'o silêncio medido passa das 6h do limiar',
    silencioH >= 6,
    `silencio=${silencioH.toFixed(1)}h`
  );

  // Encerra carimbando a ÚLTIMA POSIÇÃO, não NOW().
  await db.query(
    `UPDATE downwinds SET status = 'encerrado', encerrado_em = $2
     WHERE id = $1 AND status = 'em_andamento'`,
    [dwAb, alvo.ultima_posicao_em]
  );

  const encerrado = await db.query<{ status: string; iniciado_em: string; encerrado_em: string }>(
    `SELECT status, iniciado_em, encerrado_em FROM downwinds WHERE id = $1`,
    [dwAb]
  );
  const duracaoH =
    (new Date(encerrado.rows[0].encerrado_em).getTime() -
      new Date(encerrado.rows[0].iniciado_em).getTime()) /
    3_600_000;
  check('o downwind abandonado é encerrado', encerrado.rows[0].status === 'encerrado');
  check(
    'a duração fica realista, não as 36h da varredura',
    duracaoH < 2,
    `duracao=${duracaoH.toFixed(2)}h`
  );

  // O UPDATE de resumo, igual ao de resumirEPurgar.
  await db.query(
    `UPDATE downwind_participantes
     SET distancia_km = 2.22, velocidade_max_nos = 7.2, trilha_reduzida = $2::jsonb
     WHERE downwind_id = $1 AND user_id = $3`,
    [dwAb, JSON.stringify([[-4.9, -37.0, 1]]), velejadorAbandono]
  );
  const depois = await db.query<{ distancia_km: string; velocidade_max_nos: string; trilha_reduzida: unknown }>(
    `SELECT distancia_km, velocidade_max_nos, trilha_reduzida
     FROM downwind_participantes WHERE downwind_id = $1`,
    [dwAb]
  );
  check(
    'a travessia passa a ficar REGISTRADA (distância, velocidade e trilha)',
    depois.rows[0].distancia_km !== null &&
      depois.rows[0].velocidade_max_nos !== null &&
      depois.rows[0].trilha_reduzida !== null,
    `km=${depois.rows[0].distancia_km} nos=${depois.rows[0].velocidade_max_nos}`
  );

  // Idempotência: o UPDATE condicionado a em_andamento não fecha duas vezes.
  const segundaTentativa = await db.query(
    `UPDATE downwinds SET status = 'encerrado' WHERE id = $1 AND status = 'em_andamento' RETURNING id`,
    [dwAb]
  );
  check(
    'rodar a varredura de novo não reencerra nem recalcula',
    segundaTentativa.rows.length === 0
  );

  console.log('\nVisibilidade do downwind — quem vê o que na agenda:');

  /*
   * O RELATO: "criei um DW e não apareceu para outros usuários".
   *
   * Não era bug de listagem — o WHERE do GET /api/events sempre esteve certo.
   * Era que POST /api/events inseria em `downwinds` SEM a coluna
   * `visibilidade`, caindo no DEFAULT 'privado', e o formulário nem
   * perguntava. Estes checks fixam as DUAS metades: privado esconde de
   * terceiro (a proteção precisa continuar existindo) e comunidade aparece
   * (a proteção não pode voltar a engolir tudo).
   */
  async function novoUsuario(apelido: string, riderId: string): Promise<string> {
    const r = await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ($1, '$2b$12$x', $2, $3) RETURNING id`,
      [`${apelido}@t.local`, apelido, riderId]
    );
    return r.rows[0].id;
  }
  const dono = await novoUsuario('dono-visib', '9101');
  const outro = await novoUsuario('outro-visib', '9102');

  async function criarDwComEvento(nome: string, visib: string): Promise<string> {
    const ev = await db.query<{ id: string }>(
      `INSERT INTO events (title, event_date, event_at, location, spot_name, type, description, organizer, uf)
       VALUES ($1, '05 de setembro de 2026', '2026-09-05T11:00:00Z', 'Galinhos', 'Galinhos',
               'Downwind', 'check-visibilidade', 'dono', 'RN')
       RETURNING id`,
      [nome]
    );
    const eventId = ev.rows[0].id;
    const dw = await db.query<{ id: string }>(
      `INSERT INTO downwinds (nome, criado_por, previsto_para, visibilidade, event_id)
       VALUES ($1, $2, '2026-09-05T11:00:00Z', $3, $4) RETURNING id`,
      [nome, dono, visib, eventId]
    );
    await db.query(
      `INSERT INTO downwind_participantes (downwind_id, user_id, papel, eh_organizador)
       VALUES ($1, $2, 'velejador', TRUE)`,
      [dw.rows[0].id, dono]
    );
    return dw.rows[0].id;
  }

  const dwFechado = await criarDwComEvento('fechado-check', 'privado');
  const dwAberto = await criarDwComEvento('aberto-check', 'comunidade');

  /** O MESMO WHERE de GET /api/events, com o mesmo filtro de UF. */
  async function agendaDe(userId: string, uf: string | null): Promise<string[]> {
    const r = await db.query<{ title: string }>(
      `SELECT e.title
         FROM events e
         LEFT JOIN downwinds d ON d.event_id = e.id
        WHERE (
          d.id IS NULL OR d.visibilidade = 'comunidade' OR d.criado_por = $1 OR EXISTS (
            SELECT 1 FROM downwind_participantes dp
             WHERE dp.downwind_id = d.id AND dp.user_id = $1
          )
        )
        AND ($2::text IS NULL OR e.uf = $2)
        AND e.description = 'check-visibilidade'`,
      [userId, uf]
    );
    return r.rows.map((x) => x.title).sort();
  }

  const agendaDoOutro = await agendaDe(outro, null);
  check(
    'downwind FECHADO não aparece para quem não participa',
    !agendaDoOutro.includes('fechado-check'),
    agendaDoOutro.join(',')
  );
  check(
    'downwind de COMUNIDADE aparece para todo mundo — o bug do relato',
    agendaDoOutro.includes('aberto-check'),
    agendaDoOutro.join(',')
  );

  const agendaDoDono = await agendaDe(dono, null);
  check(
    'quem criou o downwind fechado continua vendo o próprio',
    agendaDoDono.includes('fechado-check') && agendaDoDono.includes('aberto-check'),
    agendaDoDono.join(',')
  );

  // Só um card por downwind: o UNIQUE parcial em downwinds(event_id) garante
  // que um evento não pode ter dois downwinds pendurados, e o LEFT JOIN não
  // multiplica linhas. Era daí que vinham os dois cards na tela.
  const linhasPorEvento = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM events e
       LEFT JOIN downwinds d ON d.event_id = e.id
      WHERE e.description = 'check-visibilidade' AND e.title = 'aberto-check'`
  );
  check(
    'cada downwind rende UMA linha na agenda, nunca duas',
    linhasPorEvento.rows[0].n === 1,
    `linhas=${linhasPorEvento.rows[0].n}`
  );

  const agendaCe = await agendaDe(outro, 'CE');
  check(
    'filtro por estado exclui evento de outra UF',
    agendaCe.length === 0,
    agendaCe.join(',')
  );
  const agendaRn = await agendaDe(outro, 'RN');
  check(
    'filtro por estado inclui o evento da UF pedida',
    agendaRn.includes('aberto-check'),
    agendaRn.join(',')
  );

  console.log('\nAviso à comunidade — disparo único:');

  const primeiroAviso = await db.query(
    `UPDATE downwinds SET notificado_em = NOW() WHERE id = $1 AND notificado_em IS NULL RETURNING id`,
    [dwAberto]
  );
  check('o primeiro aviso passa', primeiroAviso.rows.length === 1);

  const segundoAviso = await db.query(
    `UPDATE downwinds SET notificado_em = NOW() WHERE id = $1 AND notificado_em IS NULL RETURNING id`,
    [dwAberto]
  );
  check(
    'o segundo aviso não passa — a trava é do banco, não da tela',
    segundoAviso.rows.length === 0,
    `linhas=${segundoAviso.rows.length}`
  );

  // Downwind fechado nunca deveria chegar ao UPDATE (podeNotificarSeguidores
  // barra antes), mas se chegasse por bug de rota, o dado prova que não foi
  // anunciado — é o que uma auditoria futura vai olhar.
  const fechadoAnunciado = await db.query<{ notificado_em: string | null }>(
    `SELECT notificado_em FROM downwinds WHERE id = $1`,
    [dwFechado]
  );
  check(
    'downwind fechado permanece sem marca de anúncio',
    fechadoAnunciado.rows[0].notificado_em === null
  );

  console.log('\nVarredura de esquema — todo SELECT das rotas contra o Postgres real:');
  await varrerSelectsDasRotas(db);

  await db.close();
}

main()
  .then(() => {
    console.log('\n' + '='.repeat(52));
    console.log(`Resultado: ${passed} passaram, ${failed} falharam`);
    console.log('='.repeat(52));
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error('\nERRO:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
