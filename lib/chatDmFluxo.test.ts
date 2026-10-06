/**
 * Chat privado de ponta a ponta pelas ROTAS, contra Postgres de verdade (T13,
 * fluxo 4): a conversa direta (DM) só existe entre os dois, e a sala do
 * downwind só entre quem participa.
 *
 * O nome da sala é montado a partir de ids que circulam no cliente (o `userId`
 * de quem escreve viaja em cada mensagem), então qualquer pessoa consegue
 * escrever "dm:<A>:<B>" à mão. O que segura é a rota. lib/authz.test.ts prova
 * `canAccessDm` isolada; aqui se prova que a rota de fato a consulta, que a
 * leitura e a escrita passam pelo mesmo portão, e que o que sobra de rastro
 * (presença, lista de conversas, push) não vaza a conversa.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', async () => (await import('@/test/rotasComPglite')).dbMock);
vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);

// `after()` só existe dentro de uma requisição do Next: guarda a tarefa e o
// teste a roda depois (é o que a plataforma faz depois de a resposta sair).
const adiadas = vi.hoisted(() => ({ tarefas: [] as Array<() => unknown> }));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (fn: () => unknown) => void adiadas.tarefas.push(fn),
}));

const pushes = vi.hoisted(() => ({ para: [] as string[] }));
vi.mock('@/lib/push', async (original) => ({
  ...(await original<typeof import('@/lib/push')>()),
  sendPushToUser: async (userId: string) => void pushes.para.push(userId),
  sendPushToUsers: async () => undefined,
}));

import { salaDireta } from '@/lib/chat';
import { db, ler, params, prepararBanco, req, trocarPessoa, type UsuarioDeTeste } from '@/test/rotasComPglite';
import { entrarComo, novaPessoa } from '@/test/entrarRapido';

let ana: UsuarioDeTeste;
let beto: UsuarioDeTeste;
let carla: UsuarioDeTeste; // terceira pessoa: não faz parte da conversa
let admin: UsuarioDeTeste;
let sala: string; // a DM entre ana e beto

beforeAll(async () => {
  await prepararBanco();
  ana = await novaPessoa({ nome: 'Ana' });
  beto = await novaPessoa({ nome: 'Beto' });
  carla = await novaPessoa({ nome: 'Carla' });
  admin = await novaPessoa({ nome: 'Dono', role: 'admin' });
  sala = salaDireta(ana.id, beto.id)!;
}, 60_000);

beforeEach(async () => {
  trocarPessoa();
  adiadas.tarefas.length = 0;
  pushes.para.length = 0;
  await db.query(`DELETE FROM chat_messages`);
  await db.query(`DELETE FROM user_presence`);
});

const rotas = {
  mensagens: () => import('@/app/api/chat/messages/route'),
  mensagem: () => import('@/app/api/chat/messages/[id]/route'),
  dms: () => import('@/app/api/chat/dms/route'),
  presenca: () => import('@/app/api/chat/presence/route'),
};

async function esvaziarDepoisDaResposta() {
  const tarefas = adiadas.tarefas.splice(0);
  await Promise.all(tarefas.map((t) => t()));
}

async function enviar(quem: UsuarioDeTeste | null, room: string, text: string) {
  if (quem) await entrarComo(quem);
  else trocarPessoa();
  const { POST } = await rotas.mensagens();
  return ler(await POST(req('POST', '/api/chat/messages', { room, text })));
}

async function ler_(quem: UsuarioDeTeste | null, room: string) {
  if (quem) await entrarComo(quem);
  else trocarPessoa();
  const { GET } = await rotas.mensagens();
  return ler(await GET(req('GET', `/api/chat/messages?room=${encodeURIComponent(room)}`)));
}

const textos = (r: { body: Record<string, unknown> }) =>
  ((r.body.messages as Array<{ text: string }>) ?? []).map((m) => m.text);

const noBanco = async (room: string) =>
  (await db.query<{ text: string }>(`SELECT text FROM chat_messages WHERE room = $1 ORDER BY created_at`, [room])).rows.map((r) => r.text);

// ---------------------------------------------------------------------------

describe('chat DM — só entre os dois', () => {
  it('os dois conversam: o que um escreve o outro lê, e a conversa é a mesma pelos dois lados', async () => {
    expect((await enviar(ana, sala, 'Vai ventar amanhã?')).status).toBe(200);
    expect((await enviar(beto, sala, 'Dezoito nós, bora.')).status).toBe(200);

    const doBeto = await ler_(beto, sala);
    expect(doBeto.status).toBe(200);
    expect(textos(doBeto)).toEqual(['Vai ventar amanhã?', 'Dezoito nós, bora.']);
    expect(textos(await ler_(ana, sala))).toEqual(['Vai ventar amanhã?', 'Dezoito nós, bora.']);
  });

  it('TERCEIRO não LÊ a conversa (403), nem com a sala escrita à mão', async () => {
    await enviar(ana, sala, 'segredo da Ana para o Beto');
    const r = await ler_(carla, sala);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain('segredo');
  });

  it('TERCEIRO não ESCREVE na conversa (403) e nada é gravado', async () => {
    const r = await enviar(carla, sala, 'mensagem forjada no meio da DM');
    expect(r.status).toBe(403);
    expect(await noBanco(sala)).toEqual([]);
  });

  it('nem a moderação lê DM alheia: admin leva 403 na leitura e na escrita', async () => {
    await enviar(ana, sala, 'conversa privada');
    expect((await ler_(admin, sala)).status).toBe(403);
    expect((await enviar(admin, sala, 'intromissão')).status).toBe(403);
    expect(await noBanco(sala)).toEqual(['conversa privada']);
  });

  it('anônimo não lê nem escreve (401)', async () => {
    await enviar(ana, sala, 'oi');
    expect((await ler_(null, sala)).status).toBe(401);
    expect((await enviar(null, sala, 'oi')).status).toBe(401);
  });

  it('sala fora do formato canônico é recusada (400): outra ordem de ids, DM consigo mesmo, lixo', async () => {
    const [a, b] = [ana.id, beto.id].sort();
    const invertida = `dm:${b}:${a}`;
    expect((await ler_(ana, invertida)).status).toBe(400);
    expect((await enviar(ana, invertida, 'oi')).status).toBe(400);
    expect((await enviar(ana, `dm:${ana.id}:${ana.id}`, 'oi')).status).toBe(400);
    expect((await ler_(ana, 'dm:qualquer-coisa')).status).toBe(400);
    expect(await noBanco(invertida)).toEqual([]);
  });

  it('o convidado do link de 12 h não alcança DM (403)', async () => {
    const dw = (
      await db.query<{ id: string }>(`INSERT INTO downwinds (nome, criado_por, status) VALUES ('Do Convidado', $1, 'aberto') RETURNING id`, [ana.id])
    ).rows[0].id;
    const convidado = await novaPessoa({ nome: 'Convidado Do Link' });
    await db.query(`UPDATE users SET downwind_guest_of = $1 WHERE id = $2`, [dw, convidado.id]);
    await db.query(`INSERT INTO downwind_participantes (downwind_id, user_id, papel) VALUES ($1, $2, 'apoio_terra')`, [dw, convidado.id]);

    expect((await ler_(convidado, sala)).status).toBe(403);
    expect((await enviar(convidado, sala, 'oi')).status).toBe(403);
    expect((await ler_(convidado, 'geral')).status).toBe(403);
  });

  it('texto vazio é 400; mais de 10 mensagens em 1 minuto é 429', async () => {
    expect((await enviar(ana, sala, '   ')).status).toBe(400);
    const status: number[] = [];
    for (let i = 0; i < 11; i++) status.push((await enviar(ana, sala, `m${i}`)).status);
    expect(status.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(status[10]).toBe(429);
  });
});

describe('chat DM — o que sobra de rastro não vaza a conversa', () => {
  it('o push de uma DM vai SÓ para o outro participante, não para o autor nem para terceiros', async () => {
    await enviar(ana, sala, 'chegou?');
    await esvaziarDepoisDaResposta();
    expect(pushes.para).toEqual([beto.id]);
  });

  it('a sala da DM nunca é gravada na presença (a lista "Online" é pública)', async () => {
    await enviar(ana, sala, 'oi');
    await ler_(beto, sala);
    await esvaziarDepoisDaResposta();
    const presencas = await db.query<{ user_id: string; room: string | null }>(`SELECT user_id, room FROM user_presence`);
    expect(presencas.rows.length).toBeGreaterThan(0); // a presença foi renovada...
    expect(presencas.rows.every((p) => p.room === null || !p.room.startsWith('dm:'))).toBe(true); // ...sem a sala
  });

  it('nem o heartbeat de presença entrega a sala da DM a quem consulta "Online"', async () => {
    await entrarComo(ana);
    const { POST, GET } = await rotas.presenca();
    expect((await POST(req('POST', '/api/chat/presence', { room: sala }))).status).toBe(200);

    await entrarComo(carla);
    const online = await ler(await GET(req('GET', '/api/chat/presence')));
    const daAna = (online.body.online as Array<{ userId: string; room?: string }>).find((o) => o.userId === ana.id);
    expect(daAna).toBeDefined();
    expect(daAna?.room).toBeUndefined();
    const filtrado = await ler(await GET(req('GET', `/api/chat/presence?room=${encodeURIComponent(sala)}`)));
    expect(filtrado.body.count).toBe(0);
  });

  it('a lista de conversas mostra a cada um só as DMs de que participa', async () => {
    const dAnaCarla = salaDireta(ana.id, carla.id)!;
    await enviar(ana, sala, 'para o Beto');
    await enviar(ana, dAnaCarla, 'para a Carla');
    await enviar(beto, sala, 'resposta do Beto');

    const inbox = async (quem: UsuarioDeTeste) => {
      await entrarComo(quem);
      const { GET } = await rotas.dms();
      const r = await ler(await GET());
      return (r.body.conversas as Array<{ userId: string; userName: string; lastMessage: { text: string; fromMe: boolean } }>) ?? [];
    };

    const daAna = await inbox(ana);
    expect(daAna.map((c) => c.userName).sort()).toEqual(['Beto', 'Carla']);
    const comBeto = daAna.find((c) => c.userId === beto.id)!;
    expect(comBeto.lastMessage).toMatchObject({ text: 'resposta do Beto', fromMe: false });

    // O Beto só vê a conversa dele com a Ana — nunca a da Ana com a Carla.
    const doBeto = await inbox(beto);
    expect(doBeto.map((c) => c.userName)).toEqual(['Ana']);
    expect(JSON.stringify(doBeto)).not.toContain('para a Carla');

    // E o admin, que não está em nenhuma, não vê nenhuma.
    expect(await inbox(admin)).toEqual([]);
  });

  it('apagar mensagem: o autor apaga a sua; o outro participante e o terceiro NÃO apagam a dos outros (404)', async () => {
    const m1 = await enviar(ana, sala, 'da Ana');
    const id = String((m1.body.message as { id: string }).id);
    const { DELETE } = await rotas.mensagem();
    const apagar = async (quem: UsuarioDeTeste) => {
      await entrarComo(quem);
      return DELETE(req('DELETE', `/api/chat/messages/${id}`), params({ id }));
    };

    expect((await apagar(beto)).status).toBe(404);
    expect((await apagar(carla)).status).toBe(404);
    expect(await noBanco(sala)).toEqual(['da Ana']);
    expect((await apagar(ana)).status).toBe(200);
    expect(await noBanco(sala)).toEqual([]);
  });
});

describe('chat da sala do downwind — só quem participa', () => {
  let dwSala: string;

  beforeEach(async () => {
    const dw = (
      await db.query<{ id: string }>(`INSERT INTO downwinds (nome, criado_por, status) VALUES ('Chat T13', $1, 'aberto') RETURNING id`, [ana.id])
    ).rows[0].id;
    await db.query(`INSERT INTO downwind_participantes (downwind_id, user_id, papel, eh_organizador) VALUES ($1, $2, 'velejador', TRUE)`, [dw, ana.id]);
    await db.query(`INSERT INTO downwind_participantes (downwind_id, user_id, papel) VALUES ($1, $2, 'velejador')`, [dw, beto.id]);
    dwSala = `dw:${dw}`;
  });

  it('participantes leem e escrevem; quem não participa recebe 404 (não confirma que o downwind existe)', async () => {
    expect((await enviar(ana, dwSala, 'saída às 8h')).status).toBe(200);
    expect(textos(await ler_(beto, dwSala))).toEqual(['saída às 8h']);

    const lido = await ler_(carla, dwSala);
    expect(lido.status).toBe(404);
    expect(JSON.stringify(lido.body)).not.toContain('saída');
    expect((await enviar(carla, dwSala, 'intrusa')).status).toBe(404);
    expect(await noBanco(dwSala)).toEqual(['saída às 8h']);
  });

  it('quem desistiu perde a sala (404)', async () => {
    await db.query(`UPDATE downwind_participantes SET estado = 'desistiu' WHERE user_id = $1`, [beto.id]);
    expect((await ler_(beto, dwSala)).status).toBe(404);
    expect((await enviar(beto, dwSala, 'ainda estou aqui?')).status).toBe(404);
  });
});
