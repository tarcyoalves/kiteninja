/**
 * Painel admin, função por função, contra Postgres de verdade.
 *
 * Pedido do dono: "veja a parte do painel admin, se está tudo ok". Guarda de
 * código-fonte não responde isso — este arquivo roda cada rota que o painel
 * chama, como admin e como não-admin, e confere o efeito no banco.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { limparDetalhes } from '@/lib/auditoriaAdmin';

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
  chamadoId: await import('@/app/api/admin/chamados/[id]/route'),
  erros: await import('@/app/api/admin/erros/route'),
  intro: await import('@/app/api/admin/intro-video/route'),
  auditoria: await import('@/app/api/admin/auditoria/route'),
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

/**
 * AUDITORIA (T07). Antes, nenhuma das rotas do painel deixava rastro: se a
 * conta de admin fosse usada por outra pessoa, não havia como saber o que foi
 * feito. Estes testes rodam as rotas de verdade e leem `audit_logs` do
 * Postgres — não o texto do código.
 */
describe('painel admin — auditoria', () => {
  /** Linhas de uma ação, em JSON (a forma mais dura de procurar vazamento). */
  const linhasDe = async (acao: string, alvoId?: string) =>
    (
      await db.query<{ linha: Record<string, unknown> }>(
        `SELECT to_jsonb(a) AS linha FROM audit_logs a
         WHERE a.action = $1 AND ($2::text IS NULL OR a.target_id = $2)
         ORDER BY a.created_at, a.id`,
        [acao, alvoId ?? null]
      )
    ).rows.map((x) => x.linha);

  it('suspender, reativar e trocar papel deixam linha com admin, alvo e ação', async () => {
    const alvo = await criarUsuario({ nome: 'Alvo da Auditoria' });
    await logarComo(admin);
    const r = await rotas();
    const muda = (corpo: unknown) =>
      r.userId.PATCH(req('PATCH', `/api/admin/users/${alvo.id}`, corpo), params({ id: alvo.id }));

    expect((await muda({ isActive: false })).status).toBe(200);
    const suspensoes = await linhasDe('admin.usuario.suspenso', alvo.id);
    expect(suspensoes).toHaveLength(1);
    expect(suspensoes[0]).toMatchObject({
      actor_id: admin.id,
      target_type: 'user',
      target_id: alvo.id,
      action: 'admin.usuario.suspenso',
    });

    await logarComo(admin);
    expect((await muda({ isActive: true })).status).toBe(200);
    expect(await linhasDe('admin.usuario.reativado', alvo.id)).toHaveLength(1);

    expect((await muda({ role: 'moderator' })).status).toBe(200);
    const papel = await linhasDe('admin.usuario.papel_alterado', alvo.id);
    expect(papel).toHaveLength(1);
    // O "de" vem do estado ANTES do UPDATE, não do que o cliente mandou.
    expect(papel[0].metadata).toEqual({ de: 'rider', para: 'moderator' });

    expect((await muda({ mustChangePassword: true })).status).toBe(200);
    expect(await linhasDe('admin.usuario.troca_senha_exigida', alvo.id)).toHaveLength(1);
  });

  it('não grava linha para o que não mudou, nem para ação que falhou', async () => {
    const alvo = await criarUsuario();
    await logarComo(admin);
    const r = await rotas();
    const muda = (corpo: unknown) =>
      r.userId.PATCH(req('PATCH', `/api/admin/users/${alvo.id}`, corpo), params({ id: alvo.id }));

    // Reativar quem já está ativo: nada mudou.
    expect((await muda({ isActive: true })).status).toBe(200);
    // Papel inválido: 400, e nada foi feito.
    expect((await muda({ role: 'superuser' })).status).toBe(400);
    expect(await linhasDe('admin.usuario.reativado', alvo.id)).toHaveLength(0);
    expect(await linhasDe('admin.usuario.papel_alterado', alvo.id)).toHaveLength(0);
  });

  it('gerar link de senha registra a ação SEM o token e SEM a URL', async () => {
    const alvo = await criarUsuario({ nome: 'Quem Esqueceu' });
    await logarComo(admin);
    const r = await rotas();
    const res = await ler(await r.senha.POST(req('POST', `/api/admin/users/${alvo.id}/senha`), params({ id: alvo.id })));
    expect(res.status).toBe(200);
    const url = String(res.body.url);
    const token = url.split('/').pop()!;
    expect(token.length).toBeGreaterThan(20); // não é um teste vazio: há um token de verdade

    const linhas = await linhasDe('admin.usuario.link_senha_gerado', alvo.id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ actor_id: admin.id, target_type: 'user', target_id: alvo.id });

    // Procura o token em TODA a tabela, em JSON, não só na linha esperada — se
    // ele vazar para qualquer coluna de qualquer linha, isto fica vermelho.
    const tudo = JSON.stringify((await db.query('SELECT to_jsonb(a) AS linha FROM audit_logs a')).rows);
    expect(tudo).not.toContain(token);
    expect(tudo).not.toContain('recuperar-senha');
    expect(tudo).not.toContain(url);
  });

  it('convite: criar e revogar deixam rastro, sem o token do convite', async () => {
    await logarComo(admin);
    const r = await rotas();
    const criado = await ler(
      await r.invites.POST(req('POST', '/api/admin/invites', { email: 'convidado@exemplo.com', note: 'João da escola' }))
    );
    expect(criado.status).toBe(200);
    const tokenDoConvite = String(criado.body.inviteUrl).split('/').pop()!;

    const criacoes = await linhasDe('admin.convite.criado');
    expect(criacoes.length).toBeGreaterThanOrEqual(1);
    const ultima = criacoes[criacoes.length - 1];
    expect(ultima).toMatchObject({ actor_id: admin.id, target_type: 'invite' });
    // O e-mail e a anotação são dado pessoal sem necessidade: só o fato de haver restrição.
    expect(ultima.metadata).toMatchObject({ restritoAoEmail: true, comAnotacao: true });

    const lista = await ler(await r.invites.GET());
    const convites = lista.body.invites as Array<{ id: string; email: string | null }>;
    const id = String(convites.find((i) => i.email === 'convidado@exemplo.com')!.id);
    expect((await r.inviteId.DELETE(req('DELETE', `/api/admin/invites/${id}`), params({ id }))).status).toBe(200);
    expect(await linhasDe('admin.convite.revogado', id)).toHaveLength(1);
    // Revogar de novo é 404 e não gera segunda linha.
    expect((await r.inviteId.DELETE(req('DELETE', `/api/admin/invites/${id}`), params({ id }))).status).toBe(404);
    expect(await linhasDe('admin.convite.revogado', id)).toHaveLength(1);

    const tudo = JSON.stringify((await db.query('SELECT to_jsonb(a) AS linha FROM audit_logs a')).rows);
    expect(tudo).not.toContain(tokenDoConvite);
    expect(tudo).not.toContain('convidado@exemplo.com');
  });

  it('chamado (status e parecer) e erro (resolver, reabrir) deixam rastro', async () => {
    const autor = await criarUsuario();
    const ch = await db.query<{ id: string }>(
      `INSERT INTO chamados (user_id, tipo, titulo, descricao)
       VALUES ($1, 'bug', 'Título do chamado', 'Descrição longa o bastante para passar') RETURNING id`,
      [autor.id]
    );
    const chamadoId = ch.rows[0].id;
    const er = await db.query<{ id: string }>(
      `INSERT INTO erros_registrados (impressao, origem, mensagem)
       VALUES ('teste|auditoria', 'servidor', 'erro de teste') RETURNING id`
    );
    const erroId = String(er.rows[0].id);

    await logarComo(admin);
    const r = await rotas();
    const patchChamado = (corpo: unknown) =>
      r.chamadoId.PATCH(req('PATCH', `/api/admin/chamados/${chamadoId}`, corpo), params({ id: chamadoId }));

    expect((await patchChamado({ status: 'aprovado' })).status).toBe(200);
    const st = await linhasDe('admin.chamado.status_alterado', chamadoId);
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({
      actor_id: admin.id,
      target_type: 'chamado',
      metadata: { de: 'novo', para: 'aprovado' },
    });

    expect((await patchChamado({ parecer: 'Vamos fazer na próxima versão.' })).status).toBe(200);
    const pa = await linhasDe('admin.chamado.parecer_alterado', chamadoId);
    expect(pa).toHaveLength(1);
    expect(JSON.stringify(pa[0])).not.toContain('próxima versão'); // o texto do parecer não vai para o log
    // Mesmo status de novo: não é mudança.
    expect((await patchChamado({ status: 'aprovado' })).status).toBe(200);
    expect(await linhasDe('admin.chamado.status_alterado', chamadoId)).toHaveLength(1);

    const patchErro = (resolvido: boolean) =>
      r.erros.PATCH(req('PATCH', '/api/admin/erros', { id: Number(erroId), resolvido }));
    expect((await patchErro(true)).status).toBe(200);
    expect((await patchErro(false)).status).toBe(200);
    expect((await linhasDe('admin.erro.resolvido', erroId))[0]).toMatchObject({
      actor_id: admin.id,
      target_type: 'erro',
    });
    expect(await linhasDe('admin.erro.reaberto', erroId)).toHaveLength(1);
  });

  it('se o registro falhar, a ação do admin acontece do mesmo jeito', async () => {
    const alvo = await criarUsuario();
    await logarComo(admin);
    const r = await rotas();
    const silencio = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Tira a tabela de auditoria do caminho só durante este PATCH.
    await db.exec('ALTER TABLE audit_logs RENAME TO audit_logs_fora');
    try {
      const res = await r.userId.PATCH(
        req('PATCH', `/api/admin/users/${alvo.id}`, { isActive: false }),
        params({ id: alvo.id })
      );
      expect(res.status).toBe(200);
      const { rows } = await db.query<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [alvo.id]);
      expect(rows[0].is_active).toBe(false);
    } finally {
      await db.exec('ALTER TABLE audit_logs_fora RENAME TO audit_logs');
      silencio.mockRestore();
    }
  });

  it('a rota de auditoria é só de admin', async () => {
    const r = await rotas();
    trocarPessoa();
    expect((await r.auditoria.GET()).status).toBe(401);
    await logarComo(rider);
    expect((await r.auditoria.GET()).status).toBe(403);
  });

  it('a rota lista só ações do admin, da mais nova para a mais antiga, com nomes', async () => {
    const alvo = await criarUsuario({ nome: 'Nome Do Alvo' });
    // Uma linha do SOS na mesma tabela: não é ação de admin e não pode aparecer.
    await db.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id) VALUES ($1, 'sos.created', 'sos_alert', 'x')`,
      [alvo.id]
    );
    await logarComo(admin);
    const r = await rotas();
    await r.userId.PATCH(req('PATCH', `/api/admin/users/${alvo.id}`, { isActive: false }), params({ id: alvo.id }));

    const lista = await ler(await r.auditoria.GET());
    expect(lista.status).toBe(200);
    const acoes = lista.body.acoes as Array<{ acao: string; atorNome: string; alvoNome: string | null; em: string }>;
    expect(acoes.length).toBeGreaterThan(0);
    expect(acoes.length).toBeLessThanOrEqual(100);
    expect(acoes.every((a) => a.acao.startsWith('admin.'))).toBe(true);
    expect(acoes.some((a) => a.acao === 'sos.created')).toBe(false);

    expect(acoes[0]).toMatchObject({ acao: 'admin.usuario.suspenso', atorNome: 'Dono', alvoNome: 'Nome Do Alvo' });
    const tempos = acoes.map((a) => new Date(a.em).getTime());
    expect(tempos).toEqual([...tempos].sort((a, b) => b - a));
  });

  it('apagar a conta do alvo não apaga a auditoria: a linha fica, sem o nome', async () => {
    const alvo = await criarUsuario({ nome: 'Vai Embora' });
    await logarComo(admin);
    const r = await rotas();
    await r.userId.PATCH(req('PATCH', `/api/admin/users/${alvo.id}`, { isActive: false }), params({ id: alvo.id }));
    await db.query('DELETE FROM users WHERE id = $1', [alvo.id]);

    const lista = await ler(await r.auditoria.GET());
    const linha = (lista.body.acoes as Array<{ alvoId: string; alvoNome: string | null }>).find(
      (a) => a.alvoId === alvo.id
    );
    expect(linha).toBeDefined();
    expect(linha!.alvoNome).toBeNull();
  });
});

describe('auditoria — limparDetalhes', () => {
  it('derruba chave com cara de segredo e valor com cara de link, em qualquer profundidade', () => {
    const limpo = limparDetalhes({
      de: 'rider',
      token: 'abc',
      resetToken: 'abc',
      url: 'https://x.com/recuperar-senha/abc',
      destino: 'https://x.com/recuperar-senha/abc',
      aninhado: { senha: '123', ok: 1, link: '//x.com/a' },
      lista: ['https://x.com/a', 'texto'],
    });
    expect(limpo).toEqual({ de: 'rider', aninhado: { ok: 1 }, lista: ['texto'] });
  });
});
