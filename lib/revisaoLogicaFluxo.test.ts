/**
 * Revisão de lógica de 16/11/2026 — os defeitos confirmados, pelas ROTAS reais
 * sobre PGlite. Cada teste é um defeito que existia em produção; o comentário
 * diz o que a pessoa via.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', async () => (await import('@/test/rotasComPglite')).dbMock);
vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);
vi.mock('@/lib/push', async (original) => ({
  ...(await original<typeof import('@/lib/push')>()),
  sendPushToUsers: async () => undefined,
  sendPushToUser: async () => undefined,
  sendFcmToUser: async () => undefined,
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: () => undefined,
}));

import { db, ler, params, prepararBanco, req, trocarPessoa, type UsuarioDeTeste } from '@/test/rotasComPglite';
import { entrarComo, novaPessoa } from '@/test/entrarRapido';
import { hojeLocal } from './dataLocal';
import { chaveDaFila } from './filaPosicoes';

const SAIDA = 'rev-saida';
const CHEGADA = 'rev-chegada';

beforeAll(async () => {
  await prepararBanco();
  await db.query(
    `INSERT INTO spots (id, name, location, state, lat, lng, wind_safety, water_condition, bottom_type, difficulty, cover_image)
     VALUES ($1, 'Saída', 'Icaraizinho / CE', 'CE', -3.0, -39.0, 'a', 'a', 'a', 'a', 'x'),
            ($2, 'Chegada', 'Camocim / CE', 'CE', -2.9, -40.8, 'a', 'a', 'a', 'a', 'x')`,
    [SAIDA, CHEGADA]
  );
}, 60_000);

beforeEach(() => {
  trocarPessoa();
});

async function como<T = Record<string, unknown>>(
  quem: UsuarioDeTeste,
  f: () => Promise<Response>
): Promise<{ status: number; body: T }> {
  await entrarComo(quem);
  return (await ler(await f())) as { status: number; body: T };
}

async function estadoDe(id: string, u: UsuarioDeTeste) {
  const r = await db.query<{ estado: string }>(
    `SELECT estado FROM downwind_participantes WHERE downwind_id = $1 AND user_id = $2`,
    [id, u.id]
  );
  return r.rows[0]?.estado;
}

async function criarDownwind(org: UsuarioDeTeste, nome: string) {
  const { POST } = await import('@/app/api/downwind/route');
  const c = await como<{ id: string }>(org, () =>
    POST(req('POST', '/api/downwind', { nome, visibilidade: 'comunidade', spotSaida: SAIDA, spotChegada: CHEGADA }))
  );
  expect(c.status, JSON.stringify(c.body)).toBeLessThan(300);
  return String(c.body.id);
}

const iniciar = async (quem: UsuarioDeTeste, id: string) => {
  const { POST } = await import('@/app/api/downwind/[id]/status/route');
  return como(quem, () => POST(req('POST', `/api/downwind/${id}/status`, { para: 'em_andamento' }), params({ id })));
};
const entrar = async (quem: UsuarioDeTeste, id: string) => {
  const { POST } = await import('@/app/api/downwind/[id]/entrar/route');
  return como(quem, () => POST(req('POST', `/api/downwind/${id}/entrar`), params({ id })));
};

describe('downwind — todo velejador que toca "Iniciar" vai para a água', () => {
  it('o segundo a tocar Iniciar também vira navegando (antes ficava confirmado a travessia inteira)', async () => {
    const org = await novaPessoa({ nome: 'Primeira' });
    const bia = await novaPessoa({ nome: 'Segunda' });
    const id = await criarDownwind(org, 'Rev iniciar');
    expect((await entrar(bia, id)).status).toBe(200);

    expect((await iniciar(org, id)).status).toBe(200);
    expect(await estadoDe(id, org)).toBe('navegando');
    // Bia ainda não tocou: segue confirmada, como deve.
    expect(await estadoDe(id, bia)).toBe('confirmado');

    // Bia toca o MESMO botão, que trava a tela dela e abre o Modo Navegação.
    const r = await iniciar(bia, id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await estadoDe(id, bia)).toBe('navegando');
  });

  it('quem entra com a travessia já em andamento e toca Iniciar também navega', async () => {
    const org = await novaPessoa();
    const atrasado = await novaPessoa();
    const id = await criarDownwind(org, 'Rev atrasado');
    await iniciar(org, id);
    expect((await entrar(atrasado, id)).status).toBe(200);
    await iniciar(atrasado, id);
    expect(await estadoDe(id, atrasado)).toBe('navegando');
  });

  it('tocar Iniciar depois de encerrar o próprio velejo NÃO devolve ninguém à água', async () => {
    const org = await novaPessoa();
    const bia = await novaPessoa();
    const id = await criarDownwind(org, 'Rev encerrado');
    await entrar(bia, id);
    await iniciar(org, id);
    await iniciar(bia, id);
    const { PATCH } = await import('@/app/api/downwind/[id]/participantes/[userId]/route');
    await como(bia, () =>
      PATCH(req('PATCH', `/api/downwind/${id}/participantes/${bia.id}`, { estado: 'encerrado' }), params({ id, userId: bia.id }))
    );
    await iniciar(bia, id);
    expect(await estadoDe(id, bia)).toBe('encerrado');
  });
});

describe('SOS — conta de convidado não entra na lista de socorro', () => {
  it('motorista que entrou pelo link (convidado) não aparece como "notificado"', async () => {
    const org = await novaPessoa({ nome: 'Velejadora' });
    const apoioReal = await novaPessoa({ nome: 'Apoio com conta' });
    const convidado = await novaPessoa({ nome: 'Motorista do link' });
    const id = await criarDownwind(org, 'Rev sos');
    await db.query(`UPDATE users SET downwind_guest_of = $1 WHERE id = $2`, [id, convidado.id]);
    await db.query(
      `INSERT INTO downwind_participantes (downwind_id, user_id, papel, estado)
       VALUES ($1, $2, 'apoio_terra', 'confirmado'), ($1, $3, 'apoio_terra', 'confirmado')`,
      [id, apoioReal.id, convidado.id]
    );
    await iniciar(org, id);

    const { POST } = await import('@/app/api/sos/route');
    const s = await como<{ sosId?: string; id?: string }>(org, () =>
      POST(req('POST', '/api/sos', { lat: -3.0, lng: -39.0, accuracyM: 10 }))
    );
    expect(s.status, JSON.stringify(s.body)).toBeLessThan(300);

    const quem = await db.query<{ user_id: string }>(
      `SELECT r.user_id FROM sos_responders r JOIN sos_alerts a ON a.id = r.sos_id WHERE a.user_id = $1`,
      [org.id]
    );
    const ids = quem.rows.map((r) => r.user_id);
    // Quem tem conta de verdade (e pode receber push) continua na lista.
    expect(ids).toContain(apoioReal.id);
    // O convidado não tem como ser avisado nem responder: fora da lista.
    expect(ids).not.toContain(convidado.id);

    await db.query(`DELETE FROM sos_alerts`);
  });
});

describe('chat — o cursor não devolve a mesma mensagem de novo', () => {
  it('pedir "depois da última" não traz a última outra vez (selo de não lidas subia sozinho)', async () => {
    const ana = await novaPessoa({ nome: 'Ana chat' });
    const { POST, GET } = await import('@/app/api/chat/messages/route');
    const envio = await como(ana, () => POST(req('POST', '/api/chat/messages', { room: 'geral', text: 'vento entrou' })));
    expect(envio.status, JSON.stringify(envio.body)).toBeLessThan(300);

    const tudo = await como<{ messages: Array<{ id: string; createdAt: string }>; latestAt: string }>(ana, () =>
      GET(req('GET', '/api/chat/messages?room=geral'))
    );
    const ultima = tudo.body.messages[tudo.body.messages.length - 1];
    // O horário chega com milissegundos, não cortado no segundo.
    const gravado = await db.query<{ ms: string }>(
      `SELECT to_char(created_at AT TIME ZONE 'UTC', 'MS') AS ms FROM chat_messages WHERE id = $1`,
      [ultima.id]
    );
    expect(ultima.createdAt.slice(20, 23)).toBe(gravado.rows[0].ms);

    const depois = await como<{ messages: unknown[] }>(ana, () =>
      GET(req('GET', `/api/chat/messages?room=geral&since=${encodeURIComponent(ultima.createdAt)}`))
    );
    expect(depois.body.messages).toHaveLength(0);
  });

  it('senha provisória pendente bloqueia o chat (a rota ficava de fora da cobrança)', async () => {
    const provisorio = await novaPessoa();
    await db.query(`UPDATE users SET must_change_password = TRUE WHERE id = $1`, [provisorio.id]);
    const { GET, POST } = await import('@/app/api/chat/messages/route');
    expect((await como(provisorio, () => GET(req('GET', '/api/chat/messages?room=geral')))).status).toBe(403);
    expect(
      (await como(provisorio, () => POST(req('POST', '/api/chat/messages', { room: 'geral', text: 'oi' })))).status
    ).toBe(403);
  });
});

describe('perfil — dá para APAGAR pipas, pranchas e altura', () => {
  it('lista vazia e altura nula são gravadas (a tela dizia "salvo" e nada mudava)', async () => {
    const u = await novaPessoa();
    const { PATCH } = await import('@/app/api/profile/route');
    const salvar = (corpo: Record<string, unknown>) => como(u, () => PATCH(req('PATCH', '/api/profile', corpo)));
    const ler3 = async () =>
      (
        await db.query<{ quiver_kites: unknown[]; quiver_boards: unknown[]; height_cm: string | null }>(
          `SELECT quiver_kites, quiver_boards, height_cm FROM users WHERE id = $1`,
          [u.id]
        )
      ).rows[0];

    const cheio = await salvar({ quiverKites: [9, 12], quiverBoards: ['Twintip 138'], heightCm: 178 });
    expect(cheio.status, JSON.stringify(cheio.body)).toBe(200);
    let agora = await ler3();
    expect(agora.quiver_kites).toHaveLength(2);
    expect(agora.quiver_boards).toHaveLength(1);
    expect(Number(agora.height_cm)).toBe(178);

    const vazio = await salvar({ quiverKites: [], quiverBoards: [], heightCm: null });
    expect(vazio.status, JSON.stringify(vazio.body)).toBe(200);
    agora = await ler3();
    expect(agora.quiver_kites).toHaveLength(0);
    expect(agora.quiver_boards).toHaveLength(0);
    expect(agora.height_cm).toBeNull();
  });

  it('campo NÃO enviado continua mantido', async () => {
    const u = await novaPessoa();
    const { PATCH } = await import('@/app/api/profile/route');
    await como(u, () => PATCH(req('PATCH', '/api/profile', { quiverKites: [10], heightCm: 170 })));
    await como(u, () => PATCH(req('PATCH', '/api/profile', { bio: 'só a bio' })));
    const r = await db.query<{ quiver_kites: unknown[]; height_cm: string | null }>(
      `SELECT quiver_kites, height_cm FROM users WHERE id = $1`,
      [u.id]
    );
    expect(r.rows[0].quiver_kites).toHaveLength(1);
    expect(Number(r.rows[0].height_cm)).toBe(170);
  });
});

describe('convite — e-mail que o cadastro recusaria é recusado na emissão', () => {
  it('"joao@gmail" não vira convite (a pessoa ficava presa num campo travado)', async () => {
    const admin = await novaPessoa({ role: 'admin' });
    const { POST } = await import('@/app/api/admin/invites/route');
    const ruim = await como(admin, () => POST(req('POST', '/api/admin/invites', { email: 'joao@gmail' })));
    expect(ruim.status).toBe(400);
    const bom = await como(admin, () => POST(req('POST', '/api/admin/invites', { email: 'joao@gmail.com' })));
    expect(bom.status, JSON.stringify(bom.body)).toBeLessThan(300);
    const semEmail = await como(admin, () => POST(req('POST', '/api/admin/invites', {})));
    expect(semEmail.status, JSON.stringify(semEmail.body)).toBeLessThan(300);
  });
});

describe('regras puras', () => {
  it('hojeLocal usa o calendário do aparelho, não o UTC', () => {
    // 22h de 15/11 no relógio local. Em UTC-3 isso já é dia 16 em UTC — e era
    // "16" que o formulário de velejo mostrava.
    const noite = new Date(2026, 10, 15, 22, 30, 0);
    expect(hojeLocal(noite)).toBe('2026-11-15');
    expect(hojeLocal(new Date(2026, 0, 5, 0, 5, 0))).toBe('2026-01-05');
  });

  it('a fila de posições pendentes é separada por downwind', () => {
    expect(chaveDaFila('a')).not.toBe(chaveDaFila('b'));
    expect(chaveDaFila('a')).toContain('a');
  });
});
