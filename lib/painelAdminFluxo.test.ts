/**
 * Painel admin, função por função, contra Postgres de verdade.
 *
 * Pedido do dono: "veja a parte do painel admin, se está tudo ok". Guarda de
 * código-fonte não responde isso — este arquivo roda cada rota que o painel
 * chama, como admin e como não-admin, e confere o efeito no banco.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', async () => (await import('@/test/rotasComPglite')).dbMock);
vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);

import {
  criarUsuario,
  db,
  ler,
  logarComo,
  params,
  prepararBanco,
  req,
  trocarPessoa,
  type UsuarioDeTeste,
} from '@/test/rotasComPglite';

let admin: UsuarioDeTeste;
let rider: UsuarioDeTeste;

beforeAll(async () => {
  await prepararBanco();
  admin = await criarUsuario({ role: 'admin', nome: 'Dono' });
  rider = await criarUsuario({ nome: 'Velejador Comum' });
}, 60_000);

const rotas = async () => ({
  users: await import('@/app/api/admin/users/route'),
  userId: await import('@/app/api/admin/users/[id]/route'),
  senha: await import('@/app/api/admin/users/[id]/senha/route'),
  invites: await import('@/app/api/admin/invites/route'),
  inviteId: await import('@/app/api/admin/invites/[id]/route'),
  chamados: await import('@/app/api/admin/chamados/route'),
  erros: await import('@/app/api/admin/erros/route'),
  intro: await import('@/app/api/admin/intro-video/route'),
});

describe('painel admin — acesso', () => {
  it.each(['anônimo', 'velejador comum'] as const)('%s não usa nenhuma rota do painel', async (quem) => {
    if (quem === 'anônimo') trocarPessoa();
    else await logarComo(rider);
    const r = await rotas();
    const esperado = quem === 'anônimo' ? 401 : 403;
    const status = [
      (await r.users.GET(req('GET', '/api/admin/users'))).status,
      (await r.userId.PATCH(req('PATCH', `/api/admin/users/${rider.id}`, { role: 'admin' }), params({ id: rider.id }))).status,
      (await r.senha.POST(req('POST', `/api/admin/users/${rider.id}/senha`), params({ id: rider.id }))).status,
      (await r.invites.GET()).status,
      (await r.invites.POST(req('POST', '/api/admin/invites', {}))).status,
      (await r.chamados.GET(req('GET', '/api/admin/chamados'))).status,
      (await r.erros.GET(req('GET', '/api/admin/erros'))).status,
      (await r.intro.GET()).status,
    ];
    expect(status).toEqual(Array(status.length).fill(esperado));
  });
});

describe('painel admin — cada função, de verdade', () => {
  it('lista, busca e filtra velejadores', async () => {
    await logarComo(admin);
    const r = await rotas();
    const lista = await ler(await r.users.GET(req('GET', '/api/admin/users')));
    expect(lista.status).toBe(200);
    expect(Number(lista.body.total)).toBeGreaterThanOrEqual(2);

    const busca = await ler(await r.users.GET(req('GET', '/api/admin/users?q=velejador')));
    const nomes = (busca.body.users as Array<{ name: string }>).map((x) => x.name);
    expect(nomes).toContain('Velejador Comum');
    expect(nomes).not.toContain('Dono');

    for (const st of ['online', 'today', 'inactive']) {
      expect((await r.users.GET(req('GET', `/api/admin/users?status=${st}`))).status).toBe(200);
    }
  });

  it('muda papel, suspende e reativa — e o suspenso NÃO entra', async () => {
    await logarComo(admin);
    const r = await rotas();
    const muda = (corpo: unknown) =>
      r.userId.PATCH(req('PATCH', `/api/admin/users/${rider.id}`, corpo), params({ id: rider.id }));

    expect((await muda({ role: 'moderator' })).status).toBe(200);
    expect((await db.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [rider.id])).rows[0].role).toBe('moderator');

    expect((await muda({ isActive: false })).status).toBe(200);
    // Antes: 200 e sessão criada para conta suspensa.
    const tentativa = await logarComo(rider);
    expect(tentativa.status).toBe(403);
    expect(String(tentativa.body.error)).toMatch(/suspensa/);

    await logarComo(admin);
    expect((await muda({ isActive: true })).status).toBe(200);
    expect((await logarComo(rider)).status).toBe(200);

    await logarComo(admin);
    expect((await muda({ role: 'rider' })).status).toBe(200);
  });

  it('recusa com 400 — não 500 — o que é entrada inválida', async () => {
    await logarComo(admin);
    const r = await rotas();
    // Antes: id que não é UUID estourava no Postgres e virava 500 + entrada
    // falsa no painel de Erros.
    expect((await r.userId.PATCH(req('PATCH', '/api/admin/users/nao-e-uuid', { role: 'rider' }), params({ id: 'nao-e-uuid' }))).status).toBe(400);
    expect((await r.userId.PATCH(req('PATCH', `/api/admin/users/${rider.id}`, { role: 'superuser' }), params({ id: rider.id }))).status).toBe(400);
    // E o admin não se suspende por engano.
    expect((await r.userId.PATCH(req('PATCH', `/api/admin/users/${admin.id}`, { isActive: false }), params({ id: admin.id }))).status).toBe(400);
  });

  it('cria, lista e revoga convite', async () => {
    await logarComo(admin);
    const r = await rotas();
    const criado = await ler(await r.invites.POST(req('POST', '/api/admin/invites', { note: 'teste' })));
    expect(criado.status).toBe(200);
    expect(String(criado.body.inviteUrl)).toMatch(/^https:\/\/kiteninja\.vercel\.app\/convite\//);

    const lista = await ler(await r.invites.GET());
    const convites = lista.body.invites as Array<{ id: string }>;
    expect(convites.length).toBeGreaterThan(0);

    const id = String(convites[0].id);
    expect((await r.inviteId.DELETE(req('DELETE', `/api/admin/invites/${id}`), params({ id }))).status).toBe(200);
    // Revogar duas vezes não é sucesso silencioso.
    expect((await r.inviteId.DELETE(req('DELETE', `/api/admin/invites/${id}`), params({ id }))).status).toBe(404);
  });

  it('abre chamados, erros e vídeo de abertura', async () => {
    await logarComo(admin);
    const r = await rotas();
    expect((await r.chamados.GET(req('GET', '/api/admin/chamados'))).status).toBe(200);
    expect((await r.erros.GET(req('GET', '/api/admin/erros'))).status).toBe(200);
    expect((await r.intro.GET()).status).toBe(200);
  });
});
