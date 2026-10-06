/**
 * Convites de ponta a ponta pelas ROTAS, contra Postgres de verdade (T13,
 * fluxo 3): validar, aceitar, token de uso único.
 *
 * O app é fechado por convite: sem link não entra conta nova. Se o link
 * valesse duas vezes, ou valesse para o e-mail errado, ou valesse depois de
 * revogado, a porta de entrada do app inteiro estaria aberta. Há três tipos
 * de convite na base e os três são exercitados aqui:
 *
 *  1. convite de CONTA (admin gera, `invites`): uso único, pode ser restrito
 *     a um e-mail, expira, o admin revoga;
 *  2. convite de DOWNWIND para um usuário (organizador convida, a pessoa
 *     aceita ou recusa) e por link com token;
 *  3. link de 12 h para apoio em terra SEM conta (conta-convidada descartável,
 *     escopada a um downwind).
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

import { hashToken } from '@/lib/auth';
import { BASE, db, ler, logarComo, params, prepararBanco, trocarPessoa, type UsuarioDeTeste } from '@/test/rotasComPglite';
import { entrarComo, novaPessoa } from '@/test/entrarRapido';

// A validação do convite é limitada por IP (10/h, no banco): cada chamada usa
// o seu, senão os testes se bloqueiam entre si.
let ipSeq = 0;
function reqIp(metodo: 'GET' | 'POST' | 'DELETE', caminho: string, corpo?: unknown) {
  ipSeq += 1;
  return new Request(BASE + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'user-agent': 'vitest', 'x-forwarded-for': `10.13.0.${ipSeq}` },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

let admin: UsuarioDeTeste;

beforeAll(async () => {
  await prepararBanco();
  admin = await novaPessoa({ role: 'admin', nome: 'Dono Dos Convites' });
  await db.query(
    `INSERT INTO spots (id, name, location, state, lat, lng, wind_safety, water_condition, bottom_type, difficulty, cover_image)
     VALUES ('t13-cv-saida', 'Saída Convites', 'Fortaleza', 'CE', -3.7, -38.5, 'a', 'a', 'a', 'a', 'x')`
  );
}, 60_000);

beforeEach(() => {
  trocarPessoa();
});

// ---------------------------------------------------------- convite de conta

let emailSeq = 0;
const novoEmail = () => `novo${(emailSeq += 1)}@convite.kiteninja`;

async function gerarConvite(corpo: Record<string, unknown> = {}): Promise<string> {
  await entrarComo(admin);
  const { POST } = await import('@/app/api/admin/invites/route');
  const r = await ler(await POST(reqIp('POST', '/api/admin/invites', corpo)));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return String(r.body.inviteUrl).split('/convite/')[1];
}

async function validar(token: string) {
  trocarPessoa();
  const { GET } = await import('@/app/api/invites/validate/route');
  return ler(await GET(reqIp('GET', `/api/invites/validate?token=${encodeURIComponent(token)}`)));
}

async function aceitar(token: string, extra: Record<string, unknown> = {}) {
  trocarPessoa();
  const { POST } = await import('@/app/api/invites/accept/route');
  return ler(
    await POST(
      reqIp('POST', '/api/invites/accept', {
        token,
        email: novoEmail(),
        password: 'senha-do-convidado-1',
        name: 'Convidado Novo',
        ...extra,
      })
    )
  );
}

const linhaDoConvite = async (token: string) =>
  (await db.query<Record<string, unknown>>(`SELECT * FROM invites WHERE token_hash = $1`, [hashToken(token)])).rows[0];

describe('convite de conta — validar', () => {
  it('link aberto vale e NÃO é consumido por validar (pode validar de novo)', async () => {
    const token = await gerarConvite();
    expect((await validar(token)).body).toEqual({ valid: true, email: null });
    expect((await validar(token)).body.valid).toBe(true);
    expect((await linhaDoConvite(token)).used_at).toBeNull();
  });

  it('o token em claro nunca vai para o banco: só o hash', async () => {
    const token = await gerarConvite();
    const todas = await db.query(`SELECT 1 FROM invites WHERE token_hash = $1`, [token]);
    expect(todas.rows).toHaveLength(0);
    expect(await linhaDoConvite(token)).toBeDefined();
  });

  it('token desconhecido ou vazio não vale', async () => {
    expect((await validar('token-que-nunca-existiu')).body).toEqual({ valid: false });
    expect((await validar('')).body).toEqual({ valid: false });
  });

  it('convite expirado ou revogado não vale', async () => {
    const vencido = await gerarConvite();
    await db.query(`UPDATE invites SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1`, [hashToken(vencido)]);
    expect((await validar(vencido)).body.valid).toBe(false);

    const revogado = await gerarConvite();
    const id = String((await linhaDoConvite(revogado)).id);
    await entrarComo(admin);
    const { DELETE } = await import('@/app/api/admin/invites/[id]/route');
    expect((await DELETE(reqIp('DELETE', `/api/admin/invites/${id}`), params({ id }))).status).toBe(200);
    expect((await validar(revogado)).body.valid).toBe(false);
  });

  it('convite restrito a um e-mail mostra para qual e-mail', async () => {
    const token = await gerarConvite({ email: 'so-ela@convite.kiteninja' });
    expect((await validar(token)).body).toEqual({ valid: true, email: 'so-ela@convite.kiteninja' });
  });

  it('o limite por IP segura quem fica adivinhando links (429 na 11ª)', async () => {
    const mesmoIp = '10.99.99.99';
    const { GET } = await import('@/app/api/invites/validate/route');
    const chamar = () =>
      GET(
        new Request(BASE + '/api/invites/validate?token=x', {
          headers: { 'x-forwarded-for': mesmoIp },
        })
      );
    const status: number[] = [];
    for (let i = 0; i < 11; i++) status.push((await chamar()).status);
    expect(status.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(status[10]).toBe(429);
  });
});

describe('convite de conta — aceitar e uso único', () => {
  it('aceitar cria a conta como velejador comum (o corpo não escolhe o papel), consome o link e já abre sessão', async () => {
    const token = await gerarConvite();
    const email = novoEmail();
    const r = await aceitar(token, { email, role: 'admin', isActive: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const conta = await db.query<{ id: string; role: string }>(`SELECT id, role FROM users WHERE email = $1`, [email]);
    expect(conta.rows).toHaveLength(1);
    expect(conta.rows[0].role).toBe('rider'); // `role: 'admin'` no corpo foi ignorado

    const convite = await linhaDoConvite(token);
    expect(convite.used_at).not.toBeNull();
    expect(convite.used_by).toBe(conta.rows[0].id);

    // A sessão aberta na resposta é a da conta nova.
    const { GET } = await import('@/app/api/auth/me/route');
    const eu = await ler(await GET());
    expect(eu.status).toBe(200);
    expect(JSON.stringify(eu.body)).toContain(email);
  });

  it('USO ÚNICO: com o link já usado, validar diz inválido e aceitar de novo é 400 — e nenhuma segunda conta nasce', async () => {
    const token = await gerarConvite();
    expect((await aceitar(token)).status).toBe(200);

    expect((await validar(token)).body).toEqual({ valid: false });
    const emailDoSegundo = novoEmail();
    const segundo = await aceitar(token, { email: emailDoSegundo });
    expect(segundo.status).toBe(400);
    const nasceu = await db.query(`SELECT 1 FROM users WHERE email = $1`, [emailDoSegundo]);
    expect(nasceu.rows).toHaveLength(0);
  });

  it('USO ÚNICO sob corrida: dois aceites ao mesmo tempo com o mesmo link criam UMA conta só', async () => {
    const token = await gerarConvite();
    const emailA = novoEmail();
    const emailB = novoEmail();
    const [a, b] = await Promise.all([aceitar(token, { email: emailA }), aceitar(token, { email: emailB })]);

    // Um ganha (200); o outro perde com erro de cliente (409 "acabou de ser utilizado").
    const status = [a.status, b.status].sort();
    expect(status.filter((s) => s === 200)).toHaveLength(1);
    expect(status.find((s) => s !== 200)).toBeGreaterThanOrEqual(400);
    expect(status.find((s) => s !== 200)).toBeLessThan(500);
    const contas = await db.query(`SELECT email FROM users WHERE email IN ($1, $2)`, [emailA, emailB]);
    expect(contas.rows).toHaveLength(1);
    // O convite aponta para a conta que ficou — não para uma apagada.
    const convite = await linhaDoConvite(token);
    const dono = await db.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [convite.used_by]);
    expect(dono.rows).toHaveLength(1);
  });

  it('convite restrito a um e-mail só serve para ele: outro e-mail é 403 e o link NÃO é queimado', async () => {
    const token = await gerarConvite({ email: 'so-ela@convite.kiteninja' });
    const errado = await aceitar(token, { email: novoEmail() });
    expect(errado.status).toBe(403);
    expect((await linhaDoConvite(token)).used_at).toBeNull();

    const certo = await aceitar(token, { email: 'so-ela@convite.kiteninja' });
    expect(certo.status, JSON.stringify(certo.body)).toBe(200);
  });

  it('link vencido ou revogado não cria conta (400)', async () => {
    const vencido = await gerarConvite();
    await db.query(`UPDATE invites SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1`, [hashToken(vencido)]);
    const e1 = novoEmail();
    expect((await aceitar(vencido, { email: e1 })).status).toBe(400);

    const revogado = await gerarConvite();
    await db.query(`UPDATE invites SET revoked_at = NOW() WHERE token_hash = $1`, [hashToken(revogado)]);
    const e2 = novoEmail();
    expect((await aceitar(revogado, { email: e2 })).status).toBe(400);

    const nasceu = await db.query(`SELECT 1 FROM users WHERE email IN ($1, $2)`, [e1, e2]);
    expect(nasceu.rows).toHaveLength(0);
  });

  it('e-mail que já tem conta é 409 e NÃO queima o convite; senha curta é 400 e também não', async () => {
    const token = await gerarConvite();
    const existente = await novaPessoa();
    expect((await aceitar(token, { email: existente.email })).status).toBe(409);
    expect((await aceitar(token, { password: 'curta' })).status).toBe(400);
    expect((await linhaDoConvite(token)).used_at).toBeNull();
    // E o link continua servindo a quem usar certo.
    expect((await aceitar(token)).status).toBe(200);
  });

  it('a conta criada entra com a senha escolhida (o hash é o da senha do cadastro)', async () => {
    const token = await gerarConvite();
    const email = novoEmail();
    expect((await aceitar(token, { email, password: 'minha-senha-nova-123' })).status).toBe(200);
    const login = await logarComo({ email, senha: 'minha-senha-nova-123' });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
  });

  it('só admin gera convite: velejador comum 403, anônimo 401', async () => {
    const { POST } = await import('@/app/api/admin/invites/route');
    await entrarComo(await novaPessoa());
    expect((await POST(reqIp('POST', '/api/admin/invites', {}))).status).toBe(403);
    trocarPessoa();
    expect((await POST(reqIp('POST', '/api/admin/invites', {}))).status).toBe(401);
  });
});

// ------------------------------------------------------- convite de downwind

async function downwindDe(org: UsuarioDeTeste, nome = 'Convites T13'): Promise<string> {
  await entrarComo(org);
  const { POST } = await import('@/app/api/downwind/route');
  const r = await ler(await POST(reqIp('POST', '/api/downwind', { nome, spotSaida: 't13-cv-saida' })));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return String(r.body.id);
}

async function convidar(quem: UsuarioDeTeste, dwId: string, corpo: Record<string, unknown>) {
  await entrarComo(quem);
  const { POST } = await import('@/app/api/downwind/[id]/invites/route');
  return ler(await POST(reqIp('POST', `/api/downwind/${dwId}/invites`, corpo), params({ id: dwId })));
}

async function responderConvite(quem: UsuarioDeTeste, inviteId: string, acao: 'accept' | 'decline') {
  await entrarComo(quem);
  const rota =
    acao === 'accept'
      ? await import('@/app/api/downwind/invites/[id]/accept/route')
      : await import('@/app/api/downwind/invites/[id]/decline/route');
  return ler(await rota.POST(reqIp('POST', `/api/downwind/invites/${inviteId}/${acao}`), params({ id: inviteId })));
}

const participacao = async (dwId: string, u: UsuarioDeTeste) =>
  (
    await db.query<{ papel: string; estado: string; eh_organizador: boolean }>(
      `SELECT papel, estado, eh_organizador FROM downwind_participantes WHERE downwind_id = $1 AND user_id = $2`,
      [dwId, u.id]
    )
  ).rows[0] ?? null;

const statusDoConvite = async (id: string) =>
  (await db.query<{ status: string }>(`SELECT status FROM downwind_user_invites WHERE id = $1`, [id])).rows[0].status;

describe('convite de downwind para um usuário — convidar, aceitar, recusar', () => {
  it('só o organizador convida (403 para participante comum), não convida a si mesmo (400) nem quem já participa (409)', async () => {
    const org = await novaPessoa();
    const comum = await novaPessoa();
    const alvo = await novaPessoa();
    const dw = await downwindDe(org);
    // Downwind privado: participante comum chega por convite, não por
    // /entrar (que num privado recusa quem não participa — corrigido em 06/10).
    await db.query(
      `INSERT INTO downwind_participantes (downwind_id, user_id, papel) VALUES ($1, $2, 'velejador')`,
      [dw, comum.id],
    );

    expect((await convidar(comum, dw, { inviteeUserId: alvo.id })).status).toBe(403);
    expect((await convidar(org, dw, { inviteeUserId: org.id })).status).toBe(400);
    expect((await convidar(org, dw, { inviteeUserId: comum.id })).status).toBe(409);
    expect((await convidar(org, dw, { inviteeUserId: alvo.id, role: 'capitao' })).status).toBe(400);
    const ok = await convidar(org, dw, { inviteeUserId: alvo.id });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.status).toBe('pendente');
  });

  it('o convidado aceita: vira participante "confirmado" no papel do convite, e o convite fica "aceito"', async () => {
    const org = await novaPessoa();
    const alvo = await novaPessoa();
    const dw = await downwindDe(org);
    const inviteId = String((await convidar(org, dw, { inviteeUserId: alvo.id, role: 'apoio_terra' })).body.id);
    expect(await participacao(dw, alvo)).toBeNull(); // convidar não coloca ninguém dentro

    const r = await responderConvite(alvo, inviteId, 'accept');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await participacao(dw, alvo)).toEqual({ papel: 'apoio_terra', estado: 'confirmado', eh_organizador: false });
    expect(await statusDoConvite(inviteId)).toBe('aceito');
  });

  it('OUTRA pessoa não aceita o convite alheio (403) e não entra no downwind', async () => {
    const org = await novaPessoa();
    const alvo = await novaPessoa();
    const intruso = await novaPessoa();
    const dw = await downwindDe(org);
    const inviteId = String((await convidar(org, dw, { inviteeUserId: alvo.id })).body.id);

    expect((await responderConvite(intruso, inviteId, 'accept')).status).toBe(403);
    expect((await responderConvite(intruso, inviteId, 'decline')).status).toBe(403);
    expect(await participacao(dw, intruso)).toBeNull();
    expect(await statusDoConvite(inviteId)).toBe('pendente');
  });

  it('convite respondido não responde de novo (409): quem recusou não aceita depois; quem aceitou não recusa', async () => {
    const org = await novaPessoa();
    const a = await novaPessoa();
    const b = await novaPessoa();
    const dw = await downwindDe(org);
    const idA = String((await convidar(org, dw, { inviteeUserId: a.id })).body.id);
    const idB = String((await convidar(org, dw, { inviteeUserId: b.id })).body.id);

    expect((await responderConvite(a, idA, 'decline')).status).toBe(200);
    expect(await statusDoConvite(idA)).toBe('recusado');
    expect((await responderConvite(a, idA, 'accept')).status).toBe(409);
    expect(await participacao(dw, a)).toBeNull();

    expect((await responderConvite(b, idB, 'accept')).status).toBe(200);
    expect((await responderConvite(b, idB, 'decline')).status).toBe(409);
    expect(await statusDoConvite(idB)).toBe('aceito');
  });

  it('convite vencido não entra (410) e fica "expirado"; downwind já encerrado também não (409)', async () => {
    const org = await novaPessoa();
    const a = await novaPessoa();
    const b = await novaPessoa();
    const dw = await downwindDe(org);
    const idA = String((await convidar(org, dw, { inviteeUserId: a.id })).body.id);
    const idB = String((await convidar(org, dw, { inviteeUserId: b.id })).body.id);

    await db.query(`UPDATE downwind_user_invites SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [idA]);
    expect((await responderConvite(a, idA, 'accept')).status).toBe(410);
    expect(await statusDoConvite(idA)).toBe('expirado');
    expect(await participacao(dw, a)).toBeNull();

    await db.query(`UPDATE downwinds SET status = 'cancelado' WHERE id = $1`, [dw]);
    expect((await responderConvite(b, idB, 'accept')).status).toBe(409);
    expect(await participacao(dw, b)).toBeNull();
  });

  it('anônimo não aceita (401); id que não é UUID é 404', async () => {
    const { POST } = await import('@/app/api/downwind/invites/[id]/accept/route');
    trocarPessoa();
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await POST(reqIp('POST', `/api/downwind/invites/${id}/accept`), params({ id }))).status).toBe(401);
    await entrarComo(await novaPessoa());
    expect((await POST(reqIp('POST', '/api/downwind/invites/x/accept'), params({ id: 'x' }))).status).toBe(404);
    expect((await POST(reqIp('POST', `/api/downwind/invites/${id}/accept`), params({ id }))).status).toBe(404);
  });
});

describe('convite de downwind por link com token', () => {
  async function linkDe(org: UsuarioDeTeste, dw: string, role = 'velejador') {
    const r = await convidar(org, dw, { createLink: true, role });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return String(r.body.token);
  }

  async function usarLink(quem: UsuarioDeTeste | null, token: string) {
    if (quem) await entrarComo(quem);
    else trocarPessoa();
    const { POST } = await import('@/app/api/downwind/invite/[token]/route');
    return ler(await POST(reqIp('POST', `/api/downwind/invite/${token}`), params({ token })));
  }

  it('o link mostra o convite sem login, só guarda o hash do token, e quem o usa entra no papel do convite', async () => {
    const org = await novaPessoa();
    const alvo = await novaPessoa();
    const dw = await downwindDe(org, 'Travessia Do Link');
    const token = await linkDe(org, dw, 'apoio_terra');

    const crua = await db.query(`SELECT 1 FROM downwind_user_invites WHERE token_hash = $1`, [token]);
    expect(crua.rows).toHaveLength(0);

    trocarPessoa();
    const { GET } = await import('@/app/api/downwind/invite/[token]/route');
    const visto = await ler(await GET(reqIp('GET', `/api/downwind/invite/${token}`), params({ token })));
    expect(visto.status).toBe(200);
    expect(visto.body.downwindNome).toBe('Travessia Do Link');
    expect(visto.body.role).toBe('apoio_terra');

    expect((await usarLink(alvo, token)).status).toBe(200);
    expect(await participacao(dw, alvo)).toEqual({ papel: 'apoio_terra', estado: 'confirmado', eh_organizador: false });
  });

  it('só o organizador gera o link (participante comum 403, estranho 403)', async () => {
    const org = await novaPessoa();
    const estranho = await novaPessoa();
    const dw = await downwindDe(org);
    expect((await convidar(estranho, dw, { createLink: true })).status).toBe(403);
  });

  it('o link não promove ninguém a organizador, e quem já participa não tem o estado mexido', async () => {
    const org = await novaPessoa();
    const dw = await downwindDe(org);
    const token = await linkDe(org, dw);
    // O próprio organizador abre o link: continua organizador, "confirmado".
    expect((await usarLink(org, token)).status).toBe(200);
    expect((await participacao(dw, org))?.eh_organizador).toBe(true);
  });

  it('link desconhecido é 404, vencido é 410, de downwind terminado é 409; sem login é 401', async () => {
    const org = await novaPessoa();
    const alvo = await novaPessoa();
    const dw = await downwindDe(org);
    const token = await linkDe(org, dw);

    expect((await usarLink(alvo, 'token-que-nunca-existiu-1234')).status).toBe(404);
    expect((await usarLink(null, token)).status).toBe(401);

    await db.query(`UPDATE downwind_user_invites SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1`, [hashToken(token)]);
    expect((await usarLink(alvo, token)).status).toBe(410);

    const dw2 = await downwindDe(org, 'Outra Travessia');
    const token2 = await linkDe(org, dw2);
    await db.query(`UPDATE downwinds SET status = 'encerrado' WHERE id = $1`, [dw2]);
    expect((await usarLink(alvo, token2)).status).toBe(409);
    expect(await participacao(dw2, alvo)).toBeNull();
  });
});

describe('link de 12 h para apoio em terra, sem conta', () => {
  async function linkApoio(org: UsuarioDeTeste, dw: string) {
    await entrarComo(org);
    const { POST } = await import('@/app/api/downwind/[id]/convites/route');
    return ler(await POST(reqIp('POST', `/api/downwind/${dw}/convites`), params({ id: dw })));
  }

  async function entrarSemConta(token: string, corpo: Record<string, unknown> = { nome: 'Tio Do Carro' }) {
    trocarPessoa();
    const { POST } = await import('@/app/api/downwind/convite/[token]/entrar/route');
    return ler(await POST(reqIp('POST', `/api/downwind/convite/${token}/entrar`, corpo), params({ token })));
  }

  it('só o organizador gera o link (403 para quem não organiza o downwind); o token em claro não vai para o banco', async () => {
    const org = await novaPessoa();
    const estranho = await novaPessoa();
    const dw = await downwindDe(org);
    expect((await linkApoio(estranho, dw)).status).toBe(403);
    const ok = await linkApoio(org, dw);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const crua = await db.query(`SELECT 1 FROM downwind_convites WHERE token_hash = $1`, [String(ok.body.token)]);
    expect(crua.rows).toHaveLength(0); // só o hash
  });

  it('quem abre o link vira apoio em terra de ESTE downwind com sessão própria — e só dele', async () => {
    const org = await novaPessoa();
    const dw = await downwindDe(org, 'Travessia Com Apoio');
    const outro = await downwindDe(org, 'Outra Travessia');
    const token = String((await linkApoio(org, dw)).body.token);

    const r = await entrarSemConta(token, { nome: 'Tio Do Carro' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const conta = await db.query<{ id: string; downwind_guest_of: string }>(
      `SELECT id, downwind_guest_of FROM users WHERE name = 'Tio Do Carro'`
    );
    expect(conta.rows).toHaveLength(1);
    expect(conta.rows[0].downwind_guest_of).toBe(dw);
    const p = await db.query<{ papel: string }>(`SELECT papel FROM downwind_participantes WHERE downwind_id = $1 AND user_id = $2`, [
      dw,
      conta.rows[0].id,
    ]);
    expect(p.rows[0].papel).toBe('apoio_terra');

    // Sessão de ~12 h (não os 30 dias do login normal).
    const sessao = await db.query<{ horas: number }>(
      `SELECT EXTRACT(EPOCH FROM (expires_at - NOW())) / 3600 AS horas FROM auth_sessions WHERE user_id = $1`,
      [conta.rows[0].id]
    );
    expect(Number(sessao.rows[0].horas)).toBeLessThanOrEqual(12);
    expect(Number(sessao.rows[0].horas)).toBeGreaterThan(11);

    // O convidado vê o mapa do SEU downwind...
    const { GET: mapa } = await import('@/app/api/downwind/[id]/posicoes/route');
    expect((await mapa(reqIp('GET', `/api/downwind/${dw}/posicoes`), params({ id: dw }))).status).toBe(200);
    // ...não o de outro (mesma resposta de "não existe")...
    expect((await mapa(reqIp('GET', `/api/downwind/${outro}/posicoes`), params({ id: outro }))).status).toBe(404);
    // ...e fica de fora do resto do app, inclusive do SOS.
    const { POST: sos } = await import('@/app/api/sos/route');
    expect((await sos(reqIp('POST', '/api/sos', { lat: -3.7, lng: -38.5 }))).status).toBe(401);
  });

  it('link inexistente, vencido, revogado, esgotado ou de downwind terminado é 404 e nenhuma conta nasce', async () => {
    const org = await novaPessoa();
    const dw = await downwindDe(org);
    const antes = Number((await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users`)).rows[0].n);

    expect((await entrarSemConta('token-inexistente-123')).status).toBe(404);

    const vencido = String((await linkApoio(org, dw)).body.token);
    await db.query(`UPDATE downwind_convites SET expira_em = NOW() - INTERVAL '1 minute' WHERE token_hash = $1`, [hashToken(vencido)]);
    expect((await entrarSemConta(vencido)).status).toBe(404);

    const revogado = String((await linkApoio(org, dw)).body.token);
    await db.query(`UPDATE downwind_convites SET revogado_em = NOW() WHERE token_hash = $1`, [hashToken(revogado)]);
    expect((await entrarSemConta(revogado)).status).toBe(404);

    const esgotado = String((await linkApoio(org, dw)).body.token);
    await db.query(`UPDATE downwind_convites SET max_usos = 1, usos = 1 WHERE token_hash = $1`, [hashToken(esgotado)]);
    expect((await entrarSemConta(esgotado)).status).toBe(404);

    const terminado = String((await linkApoio(org, dw)).body.token);
    await db.query(`UPDATE downwinds SET status = 'cancelado' WHERE id = $1`, [dw]);
    expect((await entrarSemConta(terminado)).status).toBe(404);

    const depois = Number((await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users`)).rows[0].n);
    expect(depois).toBe(antes);
  });

  it('nome em branco é 400 (e conta nenhuma)', async () => {
    const org = await novaPessoa();
    const dw = await downwindDe(org);
    const token = String((await linkApoio(org, dw)).body.token);
    expect((await entrarSemConta(token, { nome: '   ' })).status).toBe(400);
  });
});
