/**
 * SOS de ponta a ponta pelas ROTAS, contra Postgres de verdade (T13, fluxo 1).
 *
 * Por que existe: o SOS é o único caminho da base em que uma falha machuca
 * alguém. As regras já têm teste puro (lib/authz.test.ts, lib/sos.test.ts,
 * lib/sosCandidates.test.ts) e a varredura da escalada tem o seu
 * (lib/sosVarreduraFluxo.test.ts). O que faltava era provar o CAMINHO: quem
 * recebe o push de verdade, quem consegue encerrar o SOS dos outros, quem
 * consegue se declarar socorrista, e o que o polling mostra a cada um.
 *
 * O push é espiado (`@/lib/push`) para a asserção ser "quem recebeu", não "a
 * função foi chamada". A varredura global (`after()`) fica adiada de propósito:
 * o que se mede aqui é o caminho da própria rota.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', async () => (await import('@/test/rotasComPglite')).dbMock);
vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);

const pushes = vi.hoisted(() => ({ enviados: [] as Array<{ para: string[]; titulo: string; url?: string }> }));
vi.mock('@/lib/push', async (original) => ({
  ...(await original<typeof import('@/lib/push')>()),
  sendPushToUsers: async (ids: string[], payload: { title: string; url?: string }) => {
    pushes.enviados.push({ para: ids, titulo: payload.title, url: payload.url });
  },
}));

// `after()` só existe dentro de uma requisição do Next; aqui a tarefa é
// descartada (a varredura global tem teste próprio).
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: () => undefined,
}));

import {
  db,
  ler,
  params,
  prepararBanco,
  req,
  trocarPessoa,
  type UsuarioDeTeste,
} from '@/test/rotasComPglite';
import { entrarComo as logarComo, novaPessoa as criarUsuario } from '@/test/entrarRapido';

// SOS em Fortaleza. 0,01° de latitude ≈ 1,1 km.
const ORIGEM = { lat: -3.7, lng: -38.5 };
const PERTO = { lat: -3.71, lng: ORIGEM.lng }; // ~1 km
const MEIO = { lat: -3.79, lng: ORIGEM.lng }; // ~10 km: fora de 5, dentro de 15
const LONGE = { lat: -4.6, lng: ORIGEM.lng }; // ~100 km
// Dentro da caixa de ±5 km, mas a ~6,3 km em linha reta: só o filtro exato por
// distância o deixa de fora (a caixa sozinha o deixaria passar).
const CANTO = { lat: -3.74, lng: -38.54 };

beforeAll(async () => {
  await prepararBanco();
}, 60_000);

beforeEach(async () => {
  pushes.enviados.length = 0;
  trocarPessoa();
  await db.query(`DELETE FROM sos_alerts`);
  await db.query(`DELETE FROM user_presence`);
  await db.query(`DELETE FROM downwinds`);
  await db.query(`DELETE FROM audit_logs`);
});

/** Presença do velejador: `minutosAtras` é a idade do sinal. */
async function estarEm(u: UsuarioDeTeste, pos: { lat: number; lng: number }, minutosAtras = 0) {
  await db.query(
    `INSERT INTO user_presence (user_id, last_seen_at, lat, lng, pos_updated_at)
     VALUES ($1, NOW() - $2::int * INTERVAL '1 minute', $3, $4, NOW() - $2::int * INTERVAL '1 minute')
     ON CONFLICT (user_id) DO UPDATE
       SET last_seen_at = EXCLUDED.last_seen_at, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
           pos_updated_at = EXCLUDED.pos_updated_at`,
    [u.id, minutosAtras, pos.lat, pos.lng]
  );
}

async function pedirSocorro(quem: UsuarioDeTeste, corpo: Record<string, unknown> = { ...ORIGEM }) {
  await logarComo(quem);
  const { POST } = await import('@/app/api/sos/route');
  return ler(await POST(req('POST', '/api/sos', corpo)));
}

async function responder(quem: UsuarioDeTeste, sosId: string, corpo: Record<string, unknown>) {
  await logarComo(quem);
  const { POST } = await import('@/app/api/sos/[id]/respond/route');
  return ler(await POST(req('POST', `/api/sos/${sosId}/respond`, corpo), params({ id: sosId })));
}

async function encerrar(quem: UsuarioDeTeste | null, sosId: string, corpo: Record<string, unknown>) {
  if (quem) await logarComo(quem);
  else trocarPessoa();
  const { PATCH } = await import('@/app/api/sos/[id]/route');
  return ler(await PATCH(req('PATCH', `/api/sos/${sosId}`, corpo), params({ id: sosId })));
}

async function polling(quem: UsuarioDeTeste) {
  await logarComo(quem);
  const { GET } = await import('@/app/api/sos/active/route');
  const r = await ler(await GET());
  return (r.body.alerts ?? []) as Array<Record<string, unknown> & { responders: Array<Record<string, unknown>> }>;
}

async function linha(sosId: string) {
  return (await db.query<Record<string, unknown>>(`SELECT * FROM sos_alerts WHERE id = $1`, [sosId])).rows[0];
}

async function notificadosDe(sosId: string) {
  const r = await db.query<{ user_id: string; state: string; motivo: string }>(
    `SELECT user_id, state, motivo FROM sos_responders WHERE sos_id = $1`,
    [sosId]
  );
  return r.rows;
}

const sosId = (r: { body: Record<string, unknown> }) => String((r.body.sos as { id: string }).id);

// ---------------------------------------------------------------------------

describe('SOS — criar: quem recebe o aviso', () => {
  it('anônimo não cria SOS (401) e nada é gravado', async () => {
    trocarPessoa();
    const { POST } = await import('@/app/api/sos/route');
    const r = await ler(await POST(req('POST', '/api/sos', { ...ORIGEM })));
    expect(r.status).toBe(401);
    expect((await db.query(`SELECT 1 FROM sos_alerts`)).rows).toHaveLength(0);
  });

  it('coordenada impossível é recusada (400): socorro não vai para ponto inexistente', async () => {
    const v = await criarUsuario({ nome: 'Velejador GPS Louco' });
    const r = await pedirSocorro(v, { lat: 999, lng: ORIGEM.lng });
    expect(r.status).toBe(400);
    expect((await db.query(`SELECT 1 FROM sos_alerts`)).rows).toHaveLength(0);
  });

  it('com GPS: avisa só quem está perto AGORA — não o distante, não o de sinal velho, não o próprio autor', async () => {
    const vitima = await criarUsuario({ nome: 'Em Apuros' });
    const vizinho = await criarUsuario({ nome: 'Vizinho De Praia' });
    const distante = await criarUsuario({ nome: 'Longe Daqui' });
    const sinalVelho = await criarUsuario({ nome: 'Saiu Faz Tempo' });
    const noCanto = await criarUsuario({ nome: 'No Canto Da Caixa' });
    await estarEm(vitima, ORIGEM);
    await estarEm(noCanto, CANTO);
    await estarEm(vizinho, PERTO);
    await estarEm(distante, LONGE);
    await estarEm(sinalVelho, PERTO, 30); // 30 min: fora da janela de 15

    const r = await pedirSocorro(vitima);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.notificados).toBe(1);

    const id = sosId(r);
    const alvo = await linha(id);
    expect(alvo.status).toBe('ativo');
    expect(Number(alvo.radius_km)).toBe(5);
    expect(alvo.user_id).toBe(vitima.id);

    // Banco: exatamente o vizinho, como 'notificado' por proximidade.
    const linhas = await notificadosDe(id);
    expect(linhas).toEqual([{ user_id: vizinho.id, state: 'notificado', motivo: 'proximidade' }]);

    // Push: chegou a ele — e SÓ a ele — com o link do SOS.
    expect(pushes.enviados.map((p) => p.para)).toEqual([[vizinho.id]]);
    expect(pushes.enviados[0].url).toBe(`/?tab=mapa&sos=${id}`);

    // Rastro de auditoria do disparo.
    const aud = await db.query(`SELECT 1 FROM audit_logs WHERE action = 'sos.created' AND target_id = $1`, [id]);
    expect(aud.rows).toHaveLength(1);
  });

  it('o spot é decidido pelo SERVIDOR (o corpo não escolhe o spot do SOS)', async () => {
    await db.query(
      `INSERT INTO spots (id, name, location, state, lat, lng, wind_safety, water_condition, bottom_type, difficulty, cover_image)
       VALUES ('t13-sos-spot-perto', 'Praia Perto', 'Fortaleza', 'CE', -3.701, -38.5, 'a', 'a', 'a', 'a', 'x'),
              ('t13-sos-spot-longe', 'Praia Longe', 'Natal', 'RN', -5.8, -35.2, 'a', 'a', 'a', 'a', 'x')
       ON CONFLICT (id) DO NOTHING`
    );
    const v = await criarUsuario();
    const r = await pedirSocorro(v, { ...ORIGEM, spotId: 't13-sos-spot-longe' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await linha(sosId(r))).spot_id).toBe('t13-sos-spot-perto');
  });

  it('SEM GPS e sem ninguém por perto: moderadores ativos são avisados mesmo offline — comum e conta suspensa não', async () => {
    const vitima = await criarUsuario({ nome: 'Celular Molhado' });
    const mod = await criarUsuario({ role: 'moderator' });
    const admin = await criarUsuario({ role: 'admin' });
    const modSuspenso = await criarUsuario({ role: 'moderator', ativo: false });
    const comum = await criarUsuario({ nome: 'Rider Qualquer' });

    const r = await pedirSocorro(vitima, {}); // sem lat/lng
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const avisados = (await notificadosDe(sosId(r))).map((x) => x.user_id).sort();
    expect(avisados).toEqual([mod.id, admin.id].sort());
    expect(avisados).not.toContain(modSuspenso.id);
    expect(avisados).not.toContain(comum.id);
    expect(pushes.enviados.flatMap((p) => p.para).sort()).toEqual([mod.id, admin.id].sort());
  });

  it('SEM GPS com downwind em andamento: avisa velejador e apoio em terra do grupo; espectador e quem desistiu NÃO entram', async () => {
    const vitima = await criarUsuario({ nome: 'Navegando' });
    const parceiro = await criarUsuario({ nome: 'Parceiro De Remada' });
    const apoio = await criarUsuario({ nome: 'Carro De Apoio' });
    const espectador = await criarUsuario({ nome: 'Acompanha Do Sofa' });
    const desistente = await criarUsuario({ nome: 'Voltou Pra Casa' });
    const dw = await db.query<{ id: string }>(
      `INSERT INTO downwinds (nome, criado_por, status, iniciado_em) VALUES ('Travessia T13', $1, 'em_andamento', NOW()) RETURNING id`,
      [vitima.id]
    );
    const dwId = dw.rows[0].id;
    for (const [u, papel, estado] of [
      [vitima, 'velejador', 'navegando'],
      [parceiro, 'velejador', 'navegando'],
      [apoio, 'apoio_terra', 'confirmado'],
      [espectador, 'espectador', 'confirmado'],
      [desistente, 'velejador', 'desistiu'],
    ] as const) {
      await db.query(
        `INSERT INTO downwind_participantes (downwind_id, user_id, papel, estado) VALUES ($1, $2, $3, $4)`,
        [dwId, u.id, papel, estado]
      );
    }

    const r = await pedirSocorro(vitima, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const linhas = await notificadosDe(sosId(r));
    const porMotivo = Object.fromEntries(linhas.map((l) => [l.user_id, l.motivo]));
    expect(porMotivo).toEqual({ [parceiro.id]: 'downwind', [apoio.id]: 'downwind_apoio' });
  });
});

describe('SOS — criar: segundo toque', () => {
  it('apertar de novo reaproveita o SOS aberto (uma linha só), atualiza a posição e não reenvia push', async () => {
    const vitima = await criarUsuario();
    const vizinho = await criarUsuario();
    await estarEm(vizinho, PERTO);

    const primeiro = await pedirSocorro(vitima);
    expect(primeiro.body.notificados).toBe(1);
    const id = sosId(primeiro);
    pushes.enviados.length = 0;

    const derivou = { lat: -3.705, lng: -38.51 };
    const segundo = await pedirSocorro(vitima, { ...derivou });
    expect(segundo.status).toBe(200);
    expect((segundo.body.sos as Record<string, unknown>).reaproveitado).toBe(true);
    expect(sosId(segundo)).toBe(id);
    expect(segundo.body.notificados).toBe(0);
    expect(pushes.enviados).toHaveLength(0);

    const abertos = await db.query<{ lat: string; lng: string }>(`SELECT lat, lng FROM sos_alerts WHERE user_id = $1`, [vitima.id]);
    expect(abertos.rows).toHaveLength(1);
    expect(Number(abertos.rows[0].lat)).toBeCloseTo(derivou.lat, 5);
    expect(Number(abertos.rows[0].lng)).toBeCloseTo(derivou.lng, 5);
  });

  it('também reaproveita quando já há socorrista a caminho (em_atendimento) — nunca 500 a quem pede socorro', async () => {
    const vitima = await criarUsuario();
    const vizinho = await criarUsuario();
    await estarEm(vizinho, PERTO);
    const id = sosId(await pedirSocorro(vitima));
    expect((await responder(vizinho, id, { state: 'a_caminho' })).status).toBe(200);
    expect((await linha(id)).status).toBe('em_atendimento');

    const de_novo = await pedirSocorro(vitima);
    expect(de_novo.status, JSON.stringify(de_novo.body)).toBe(200);
    expect(sosId(de_novo)).toBe(id);
    expect((await linha(id)).status).toBe('em_atendimento');
  });
});

// ---------------------------------------------------------------------------

describe('SOS — responder: quem pode se declarar socorrista', () => {
  let vitima: UsuarioDeTeste;
  let notificado: UsuarioDeTeste;
  let id: string;

  beforeEach(async () => {
    vitima = await criarUsuario({ nome: 'Pede Socorro' });
    notificado = await criarUsuario({ nome: 'Foi Avisado' });
    await estarEm(notificado, PERTO);
    id = sosId(await pedirSocorro(vitima));
    pushes.enviados.length = 0;
  });

  it('quem foi avisado responde "a caminho": o SOS vira em_atendimento e o AUTOR recebe evento e push', async () => {
    const r = await responder(notificado, id, { state: 'a_caminho' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('em_atendimento');
    expect((await linha(id)).status).toBe('em_atendimento');

    const eventos = await db.query<{ recipient_id: string; actor_id: string; kind: string }>(
      `SELECT recipient_id, actor_id, kind FROM sos_events WHERE sos_id = $1`,
      [id]
    );
    expect(eventos.rows).toEqual([{ recipient_id: vitima.id, actor_id: notificado.id, kind: 'responder_a_caminho' }]);
    expect(pushes.enviados.map((p) => p.para)).toEqual([[vitima.id]]);
  });

  it('repetir "a caminho" não duplica o evento nem o push ao autor', async () => {
    await responder(notificado, id, { state: 'a_caminho' });
    pushes.enviados.length = 0;
    expect((await responder(notificado, id, { state: 'a_caminho' })).status).toBe(200);
    expect(pushes.enviados).toHaveLength(0);
    const n = await db.query(`SELECT 1 FROM sos_events WHERE sos_id = $1`, [id]);
    expect(n.rows).toHaveLength(1);
  });

  it('quem NÃO foi avisado e está longe leva 403 — e não vira socorrista nem vê a posição', async () => {
    const intruso = await criarUsuario({ nome: 'Curioso' });
    await estarEm(intruso, LONGE);
    const r = await responder(intruso, id, { state: 'a_caminho' });
    expect(r.status).toBe(403);

    const dele = await db.query(`SELECT 1 FROM sos_responders WHERE sos_id = $1 AND user_id = $2`, [id, intruso.id]);
    expect(dele.rows).toHaveLength(0);
    expect((await linha(id)).status).toBe('ativo'); // nem congelou a escalada
    expect(await polling(intruso)).toEqual([]);
  });

  it('mentir lat/lng no CORPO não vale: a posição que conta é a que o servidor gravou', async () => {
    const mentiroso = await criarUsuario({ nome: 'Diz Que Esta Perto' });
    await estarEm(mentiroso, LONGE);
    const r = await responder(mentiroso, id, { state: 'a_caminho', ...ORIGEM });
    expect(r.status).toBe(403);
    const dele = await db.query(`SELECT 1 FROM sos_responders WHERE sos_id = $1 AND user_id = $2`, [id, mentiroso.id]);
    expect(dele.rows).toHaveLength(0);
  });

  it('quem chegou depois à praia (presença fresca dentro do raio, sem aviso) pode ajudar', async () => {
    const chegou = await criarUsuario({ nome: 'Chegou Agora' });
    await estarEm(chegou, PERTO);
    // Não foi notificado: nasceu depois do disparo.
    expect((await notificadosDe(id)).some((x) => x.user_id === chegou.id)).toBe(false);
    const r = await responder(chegou, id, { state: 'no_local' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it('moderador pode coordenar mesmo sem ter sido avisado nem estar perto', async () => {
    const mod = await criarUsuario({ role: 'moderator' });
    const r = await responder(mod, id, { state: 'a_caminho' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it('o autor não se declara socorrista do próprio SOS (400)', async () => {
    const r = await responder(vitima, id, { state: 'a_caminho' });
    expect(r.status).toBe(400);
    expect((await linha(id)).status).toBe('ativo');
  });

  it('SOS já encerrado não aceita resposta (409), nem de quem foi avisado', async () => {
    expect((await encerrar(vitima, id, { status: 'resolvido' })).status).toBe(200);
    const r = await responder(notificado, id, { state: 'a_caminho' });
    expect(r.status).toBe(409);
    expect((await linha(id)).status).toBe('resolvido');
  });

  it('entrada inválida: estado desconhecido e id malformado são 400, id inexistente é 404 (nunca 500)', async () => {
    expect((await responder(notificado, id, { state: 'voando' })).status).toBe(400);
    expect((await responder(notificado, 'nao-e-uuid', { state: 'a_caminho' })).status).toBe(400);
    expect((await responder(notificado, '00000000-0000-4000-8000-000000000000', { state: 'a_caminho' })).status).toBe(404);
  });

  it('anônimo não responde (401)', async () => {
    trocarPessoa();
    const { POST } = await import('@/app/api/sos/[id]/respond/route');
    const r = await ler(await POST(req('POST', `/api/sos/${id}/respond`, { state: 'a_caminho' }), params({ id })));
    expect(r.status).toBe(401);
  });

  it('o ÚLTIMO socorrista desiste: o SOS volta a "ativo", o relógio da escalada reinicia e o autor é avisado', async () => {
    await responder(notificado, id, { state: 'a_caminho' });
    // Um SOS que já passou do estágio de espera: sem o reinício do relógio ele
    // escalaria na hora que o socorrista desistisse.
    await db.query(`UPDATE sos_alerts SET created_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`, [id]);

    const r = await responder(notificado, id, { state: 'nao_posso' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('ativo');

    const a = await linha(id);
    expect(a.status).toBe('ativo');
    expect(a.escalated_at).not.toBeNull();
    const desistiu = await db.query(`SELECT 1 FROM sos_events WHERE sos_id = $1 AND kind = 'responder_desistiu'`, [id]);
    expect(desistiu.rows).toHaveLength(1);
  });

  it('com DOIS socorristas, um desistir não tira o SOS de em_atendimento', async () => {
    const outro = await criarUsuario({ nome: 'Segundo Socorrista' });
    await estarEm(outro, PERTO);
    await responder(notificado, id, { state: 'a_caminho' });
    expect((await responder(outro, id, { state: 'a_caminho' })).status).toBe(200);

    const r = await responder(notificado, id, { state: 'nao_posso' });
    expect(r.body.status).toBe('em_atendimento');
    expect((await linha(id)).status).toBe('em_atendimento');
  });
});

// ---------------------------------------------------------------------------

describe('SOS — encerrar: quem pode fechar o SOS de alguém', () => {
  let vitima: UsuarioDeTeste;
  let socorrista: UsuarioDeTeste;
  let id: string;

  beforeEach(async () => {
    vitima = await criarUsuario({ nome: 'Dono Do SOS' });
    socorrista = await criarUsuario({ nome: 'Socorrista A Caminho' });
    await estarEm(socorrista, PERTO);
    id = sosId(await pedirSocorro(vitima));
    await responder(socorrista, id, { state: 'a_caminho' });
  });

  it.each(['resolvido', 'cancelado', 'falso_alarme'] as const)('o autor encerra o próprio SOS como "%s" e o banco registra quem e quando', async (status) => {
    const r = await encerrar(vitima, id, { status, resolutionNote: 'Voltei sozinho' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const a = await linha(id);
    expect(a.status).toBe(status);
    expect(a.resolved_by).toBe(vitima.id);
    expect(a.resolved_at).not.toBeNull();
    expect(a.resolution_note).toBe('Voltei sozinho');
    const aud = await db.query(`SELECT 1 FROM audit_logs WHERE action = 'sos.resolved' AND target_id = $1`, [id]);
    expect(aud.rows).toHaveLength(1);
  });

  it('OUTRO usuário não encerra o SOS de alguém (403) — nem o socorrista que está a caminho', async () => {
    const estranho = await criarUsuario({ nome: 'Estranho' });
    for (const quem of [estranho, socorrista]) {
      const r = await encerrar(quem, id, { status: 'resolvido' });
      expect(r.status).toBe(403);
    }
    const a = await linha(id);
    expect(a.status).toBe('em_atendimento');
    expect(a.resolved_at).toBeNull();
    expect(a.resolved_by).toBeNull();
  });

  it('anônimo não encerra (401)', async () => {
    const r = await encerrar(null, id, { status: 'resolvido' });
    expect(r.status).toBe(401);
    expect((await linha(id)).status).toBe('em_atendimento');
  });

  it.each(['moderator', 'admin'] as const)('%s encerra o SOS de outra pessoa (coordenação de resgate)', async (role) => {
    const mod = await criarUsuario({ role });
    const r = await encerrar(mod, id, { status: 'falso_alarme' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const a = await linha(id);
    expect(a.status).toBe('falso_alarme');
    expect(a.resolved_by).toBe(mod.id);
  });

  it('instrutor NÃO é moderador do SOS: não encerra o de terceiros', async () => {
    const instrutor = await criarUsuario({ role: 'instructor' });
    expect((await encerrar(instrutor, id, { status: 'resolvido' })).status).toBe(403);
    expect((await linha(id)).status).toBe('em_atendimento');
  });

  it('status que não é de encerramento ("ativo") é 400; id que não existe é 404', async () => {
    expect((await encerrar(vitima, id, { status: 'ativo' })).status).toBe(400);
    expect((await linha(id)).status).toBe('em_atendimento');
    expect((await encerrar(vitima, '00000000-0000-4000-8000-000000000000', { status: 'resolvido' })).status).toBe(404);
  });

  /*
   * DEFEITO CORRIGIDO em 06/10 (achado da T13): PATCH /api/sos/[id] não olhava
   * o status atual. Um SOS 'resolvido' por moderador, reencerrado pelo autor
   * como 'falso_alarme', respondia 200, trocava o status e sobrescrevia
   * `resolved_by`. Agora responde 200 SEM mudar nada (`jaEncerrado`) — 200 e
   * não 409 porque o app só limpa o painel de SOS quando o pedido dá certo
   * (ver o comentário na rota).
   */
  it('SOS já encerrado não é reencerrado (o registro de quem encerrou não se perde)', async () => {
    const mod = await criarUsuario({ role: 'moderator' });
    expect((await encerrar(mod, id, { status: 'resolvido' })).status).toBe(200);

    const r = await encerrar(vitima, id, { status: 'falso_alarme' });
    expect(r.status).toBe(200);
    expect(r.body.jaEncerrado).toBe(true);
    const a = await linha(id);
    expect(a.status).toBe('resolvido');
    expect(a.resolved_by).toBe(mod.id);
  });

  it('depois de encerrado o SOS some do polling de TODOS e o autor pode pedir socorro de novo', async () => {
    expect((await polling(vitima)).map((a) => a.id)).toEqual([id]);
    expect((await polling(socorrista)).map((a) => a.id)).toEqual([id]);

    await encerrar(vitima, id, { status: 'resolvido' });

    expect(await polling(vitima)).toEqual([]);
    expect(await polling(socorrista)).toEqual([]);

    const novo = await pedirSocorro(vitima);
    expect(novo.status, JSON.stringify(novo.body)).toBe(200);
    expect(sosId(novo)).not.toBe(id);
    expect((novo.body.sos as Record<string, unknown>).reaproveitado).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('SOS — polling: quem vê o quê', () => {
  it('só autor e avisados enxergam o SOS; quem não tem nada com ele recebe lista vazia', async () => {
    const vitima = await criarUsuario();
    const vizinho = await criarUsuario();
    const estranho = await criarUsuario();
    await estarEm(vizinho, PERTO);
    const id = sosId(await pedirSocorro(vitima));

    expect((await polling(vitima)).map((a) => a.id)).toEqual([id]);
    expect((await polling(vizinho)).map((a) => a.id)).toEqual([id]);
    expect(await polling(estranho)).toEqual([]);
  });

  it('a posição do acidentado vai ao autor e aos avisados, e a do socorrista aparece para o autor', async () => {
    const vitima = await criarUsuario({ nome: 'Acidentado' });
    const vizinho = await criarUsuario({ nome: 'Socorrista' });
    await estarEm(vizinho, PERTO);
    const id = sosId(await pedirSocorro(vitima));
    await responder(vizinho, id, { state: 'a_caminho', lat: PERTO.lat, lng: PERTO.lng });

    const [paraAutor] = await polling(vitima);
    expect(Number(paraAutor.lat)).toBeCloseTo(ORIGEM.lat, 5);
    expect(paraAutor.status).toBe('em_atendimento');
    expect(paraAutor.responders.map((r) => [r.userId, r.state])).toEqual([[vizinho.id, 'a_caminho']]);
    expect(Number(paraAutor.responders[0].lat)).toBeCloseTo(PERTO.lat, 5);

    const [paraSocorrista] = await polling(vizinho);
    expect(Number(paraSocorrista.lat)).toBeCloseTo(ORIGEM.lat, 5);
    expect(Number(paraSocorrista.lng)).toBeCloseTo(ORIGEM.lng, 5);
  });
});

// ---------------------------------------------------------------------------

describe('SOS — escalada pela rota do polling do autor', () => {
  /** Recua o relógio do SOS: como se já tivessem passado 3 min sem resposta. */
  const envelhecer = (id: string) =>
    db.query(`UPDATE sos_alerts SET created_at = NOW() - INTERVAL '3 minutes' WHERE id = $1`, [id]);

  it('sem ninguém a caminho, o polling do autor amplia 5 -> 15 km e avisa quem estava entre 5 e 15 km, UMA vez', async () => {
    const vitima = await criarUsuario();
    const perto = await criarUsuario({ nome: 'Dentro Dos 5km' });
    const meio = await criarUsuario({ nome: 'Entre 5 e 15km' });
    const distante = await criarUsuario({ nome: 'A 100km' });
    await estarEm(perto, PERTO);
    await estarEm(meio, MEIO);
    await estarEm(distante, LONGE);
    const id = sosId(await pedirSocorro(vitima));
    expect((await notificadosDe(id)).map((x) => x.user_id)).toEqual([perto.id]);
    pushes.enviados.length = 0;
    await envelhecer(id);

    const [alerta] = await polling(vitima);
    expect(Number(alerta.radiusKm)).toBe(15);
    expect(Number((await linha(id)).radius_km)).toBe(15);

    // Avisou o novo (meio) e NÃO repetiu o push a quem já tinha sido avisado.
    expect(pushes.enviados.map((p) => p.para)).toEqual([[meio.id]]);
    const avisados = (await notificadosDe(id)).map((x) => x.user_id).sort();
    expect(avisados).toEqual([perto.id, meio.id].sort());

    // Segundo polling imediato: o relógio do estágio reiniciou, não escala de novo.
    await polling(vitima);
    expect(Number((await linha(id)).radius_km)).toBe(15);
    expect(pushes.enviados).toHaveLength(1);
  });

  it('com socorrista a caminho a escalada NÃO acontece (o raio fica em 5)', async () => {
    const vitima = await criarUsuario();
    const perto = await criarUsuario();
    await estarEm(perto, PERTO);
    const id = sosId(await pedirSocorro(vitima));
    await responder(perto, id, { state: 'a_caminho' });
    await envelhecer(id);

    await polling(vitima);
    expect(Number((await linha(id)).radius_km)).toBe(5);
  });

  it('socorrista desiste: o SOS volta a procurar, mas SEM escalar de imediato (antiflapping)', async () => {
    const vitima = await criarUsuario();
    const perto = await criarUsuario();
    await estarEm(perto, PERTO);
    const id = sosId(await pedirSocorro(vitima));
    await responder(perto, id, { state: 'a_caminho' });
    await envelhecer(id); // o SOS é velho; só o relógio reiniciado impede a rajada
    await responder(perto, id, { state: 'nao_posso' });
    expect((await linha(id)).status).toBe('ativo');

    await polling(vitima);
    expect(Number((await linha(id)).radius_km)).toBe(5);
  });

  it('SOS encerrado nunca escala, mesmo velho', async () => {
    const vitima = await criarUsuario();
    const id = sosId(await pedirSocorro(vitima));
    await envelhecer(id);
    await encerrar(vitima, id, { status: 'cancelado' });
    await polling(vitima);
    expect(Number((await linha(id)).radius_km)).toBe(5);
  });
});
