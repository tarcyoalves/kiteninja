/**
 * T11, opção A — pelas ROTAS reais sobre PGlite.
 *
 * A cena inteira: grupo na água, uma pessoa encerra o próprio velejo, abre a
 * aba Eventos e quer ver o resto chegar. O que este teste prova:
 *
 *  1. `GET /api/events` passa a dizer ao card que ela está `encerrado` — sem
 *     esse campo a tela não tinha como distinguir "já terminei" de "ainda não
 *     entrei", e oferecia "entrar" para os dois;
 *  2. com esse dado, a regra do card escolhe ASSISTIR;
 *  3. assistir (o mapa ao vivo de leitura) não muda o estado dela;
 *  4. por isso o grupo consegue encerrar o downwind sem esperar por ela.
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

import { db, ler, params, prepararBanco, req, trocarPessoa, type UsuarioDeTeste } from '@/test/rotasComPglite';
import { entrarComo, novaPessoa } from '@/test/entrarRapido';
import { acoesDoCardDownwind } from './cardDownwind';

const SAIDA = 't11-saida';
const CHEGADA = 't11-chegada';

beforeAll(async () => {
  await prepararBanco();
  await db.query(
    `INSERT INTO spots (id, name, location, state, lat, lng, wind_safety, water_condition, bottom_type, difficulty, cover_image)
     VALUES ($1, 'Saída T11', 'Icaraizinho / CE', 'CE', -3.0, -39.0, 'a', 'a', 'a', 'a', 'x'),
            ($2, 'Chegada T11', 'Camocim / CE', 'CE', -2.9, -40.8, 'a', 'a', 'a', 'a', 'x')`,
    [SAIDA, CHEGADA]
  );
}, 60_000);

beforeEach(() => {
  trocarPessoa();
});

async function chamar<T>(quem: UsuarioDeTeste, f: () => Promise<Response>): Promise<{ status: number; body: T }> {
  await entrarComo(quem);
  return (await ler(await f())) as { status: number; body: T };
}

async function estadoDe(id: string, u: UsuarioDeTeste) {
  const r = await db.query<{ estado: string; papel: string }>(
    `SELECT estado, papel FROM downwind_participantes WHERE downwind_id = $1 AND user_id = $2`,
    [id, u.id]
  );
  return r.rows[0];
}

interface EventoDoCard {
  id: string;
  downwindId: string | null;
  downwindStatus: string | null;
  downwindMeuPapel: string | null;
  downwindMeuEstado: string | null;
  downwindVisibilidade: string | null;
  downwindCriadoPorMim: boolean;
}

async function cardDe(quem: UsuarioDeTeste, downwindId: string): Promise<EventoDoCard> {
  const { GET } = await import('@/app/api/events/route');
  const r = await chamar<{ events: EventoDoCard[] }>(quem, () => GET(req('GET', '/api/events')));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const ev = r.body.events.find((e) => e.downwindId === downwindId);
  expect(ev, 'o evento do downwind tem que aparecer na lista').toBeTruthy();
  return ev!;
}

const acoes = (ev: EventoDoCard) =>
  acoesDoCardDownwind({
    status: ev.downwindStatus,
    meuPapel: ev.downwindMeuPapel,
    meuEstado: ev.downwindMeuEstado,
    podeVerSemParticipar: ev.downwindVisibilidade === 'comunidade' || ev.downwindCriadoPorMim,
  });

describe('T11 — quem já encerrou reabre só para assistir', () => {
  it('a cena inteira, do encerramento do meu velejo ao fechamento do grupo', async () => {
    const org = await novaPessoa({ nome: 'Organizadora' });
    const ana = await novaPessoa({ nome: 'Ana' });

    // Downwind criado, com um evento vinculado (é o card que a tela desenha).
    const { POST: criar } = await import('@/app/api/downwind/route');
    const c = await chamar<{ id?: string; downwind?: { id: string } }>(org, () =>
      criar(req('POST', '/api/downwind', { nome: 'Travessia T11', visibilidade: 'comunidade', spotSaida: SAIDA, spotChegada: CHEGADA }))
    );
    expect(c.status, JSON.stringify(c.body)).toBeLessThan(300);
    const id = String(c.body.id ?? c.body.downwind?.id);

    const ev = await db.query<{ id: string }>(
      `INSERT INTO events (title, event_date, location, type, description, organizer)
       VALUES ('Travessia T11', '2026-12-01', 'Icaraizinho', 'Downwind', 'teste', 'Organizadora')
       RETURNING id`
    );
    await db.query(`UPDATE downwinds SET event_id = $1 WHERE id = $2`, [ev.rows[0].id, id]);

    // Ana entra, o grupo sai, Ana navega e encerra o próprio velejo.
    const { POST: entrar } = await import('@/app/api/downwind/[id]/entrar/route');
    expect((await chamar(ana, () => entrar(req('POST', `/api/downwind/${id}/entrar`), params({ id })))).status).toBe(200);

    const { POST: status } = await import('@/app/api/downwind/[id]/status/route');
    const ini = await chamar(org, () =>
      status(req('POST', `/api/downwind/${id}/status`, { para: 'em_andamento' }), params({ id }))
    );
    expect(ini.status, JSON.stringify(ini.body)).toBe(200);

    const { PATCH: participante } = await import('@/app/api/downwind/[id]/participantes/[userId]/route');
    const mudar = (quem: UsuarioDeTeste, estado: string) =>
      chamar(quem, () =>
        participante(
          req('PATCH', `/api/downwind/${id}/participantes/${quem.id}`, { estado }),
          params({ id, userId: quem.id })
        )
      );
    for (const p of [org, ana]) {
      const n = await mudar(p, 'navegando');
      expect(n.status, JSON.stringify(n.body)).toBe(200);
    }
    const fim = await mudar(ana, 'encerrado');
    expect(fim.status, JSON.stringify(fim.body)).toBe(200);

    // 1 e 2. O card sabe que Ana encerrou, e por isso oferece ASSISTIR.
    const cardAna = await cardDe(ana, id);
    expect(cardAna.downwindStatus).toBe('em_andamento');
    expect(cardAna.downwindMeuEstado).toBe('encerrado');
    const a = acoes(cardAna);
    expect(a.principal).toBe('assistir');
    expect(a.virarEspectador).toBe(false);

    // Quem segue na água continua com o card de sempre.
    const cardOrg = await cardDe(org, id);
    expect(cardOrg.downwindMeuEstado).toBe('navegando');
    expect(acoes(cardOrg).principal).toBe('entrar');

    // 3. Assistir é abrir o mapa ao vivo de leitura — e ele não mexe em Ana.
    const { GET: live } = await import('@/app/api/downwind/[id]/live/route');
    const v = await chamar(ana, () => live(req('GET', `/api/downwind/${id}/live`), params({ id })));
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(await estadoDe(id, ana)).toEqual({ estado: 'encerrado', papel: 'velejador' });

    // 4. O grupo fecha sem esperar por ela: a última a sair encerra o downwind.
    const ultimo = await mudar(org, 'encerrado');
    expect(ultimo.status, JSON.stringify(ultimo.body)).toBe(200);
    const st = await db.query<{ status: string }>(`SELECT status FROM downwinds WHERE id = $1`, [id]);
    expect(st.rows[0].status).toBe('encerrado');
  });

  it('o contraste: "entrar" de novo devolve a pessoa ao quórum (por isso deixou de ser o botão)', async () => {
    const org = await novaPessoa({ nome: 'Org 2' });
    const bia = await novaPessoa({ nome: 'Bia' });

    const { POST: criar } = await import('@/app/api/downwind/route');
    const c = await chamar<{ id?: string; downwind?: { id: string } }>(org, () =>
      criar(req('POST', '/api/downwind', { nome: 'Travessia T11 b', visibilidade: 'comunidade', spotSaida: SAIDA, spotChegada: CHEGADA }))
    );
    const id = String(c.body.id ?? c.body.downwind?.id);

    const { POST: entrar } = await import('@/app/api/downwind/[id]/entrar/route');
    const { POST: status } = await import('@/app/api/downwind/[id]/status/route');
    const { PATCH: participante } = await import('@/app/api/downwind/[id]/participantes/[userId]/route');
    const mudar = (quem: UsuarioDeTeste, estado: string) =>
      chamar(quem, () =>
        participante(
          req('PATCH', `/api/downwind/${id}/participantes/${quem.id}`, { estado }),
          params({ id, userId: quem.id })
        )
      );

    await chamar(bia, () => entrar(req('POST', `/api/downwind/${id}/entrar`), params({ id })));
    await chamar(org, () => status(req('POST', `/api/downwind/${id}/status`, { para: 'em_andamento' }), params({ id })));
    await mudar(org, 'navegando');
    await mudar(bia, 'navegando');
    await mudar(bia, 'encerrado');

    // O que o botão antigo fazia para quem só queria olhar:
    await chamar(bia, () => entrar(req('POST', `/api/downwind/${id}/entrar`), params({ id })));
    expect((await estadoDe(id, bia)).estado).toBe('confirmado');

    // Resultado: a organizadora sai da água e o downwind NÃO fecha.
    await mudar(org, 'encerrado');
    const st = await db.query<{ status: string }>(`SELECT status FROM downwinds WHERE id = $1`, [id]);
    expect(st.rows[0].status).toBe('em_andamento');
  });
});
