/**
 * Redefinir a senha de um velejador pelo painel admin — pelas rotas reais.
 *
 * Relato do dono (16/11/2026): "No app diz que vai exigir nova senha ao
 * usuário, porém não funciona, só dá senha errada". O botão era "Exigir
 * troca", que só liga `must_change_password`: a troca é cobrada DEPOIS de
 * entrar com a senha atual — que quem esqueceu não sabe. O primeiro bloco
 * reproduz isso; o segundo, a senha provisória que substitui o botão.
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

beforeAll(async () => {
  await prepararBanco();
  admin = await criarUsuario({ role: 'admin', nome: 'Dono' });
}, 60_000);

const rota = async () => await import('@/app/api/admin/users/[id]/senha-provisoria/route');
const gerar = async (id: string) => {
  const { POST } = await rota();
  return ler(await POST(req('POST', `/api/admin/users/${id}/senha-provisoria`), params({ id })));
};

describe('o defeito relatado: "Exigir troca" não redefine nada', () => {
  it('depois do "Exigir troca", quem esqueceu a senha continua sem conseguir entrar', async () => {
    const esqueceu = await criarUsuario({ nome: 'Esqueceu a Senha' });
    await logarComo(admin);
    const { PATCH } = await import('@/app/api/admin/users/[id]/route');
    const r = await ler(
      await PATCH(
        req('PATCH', `/api/admin/users/${esqueceu.id}`, { mustChangePassword: true }),
        params({ id: esqueceu.id })
      )
    );
    expect(r.status).toBe(200); // o painel dizia "Foi exigida a troca de senha"
    // ...e a pessoa, que não sabe a senha, só recebe "senha errada":
    const tentativa = await logarComo({ email: esqueceu.email, senha: 'qualquer-coisa-que-ela-chuta' });
    expect(tentativa.status).toBe(401);
  });
});

describe('senha provisória pelo painel', () => {
  it('o velejador entra com a provisória, é obrigado a trocar, e depois usa o app normalmente', async () => {
    const velejador = await criarUsuario({ nome: 'Velejador Sem Senha' });
    await logarComo(admin);
    const r = await gerar(velejador.id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const provisoria = String(r.body.senhaProvisoria);
    expect(provisoria.length).toBeGreaterThanOrEqual(10);
    expect(r.body.email).toBe(velejador.email);

    // A senha antiga deixou de valer; a provisória entra.
    expect((await logarComo({ email: velejador.email, senha: velejador.senha })).status).toBe(401);
    const entrou = await logarComo({ email: velejador.email, senha: provisoria });
    expect(entrou.status).toBe(200);

    // Entrou, mas só pode trocar a senha (cobrado no servidor, não só na tela).
    const me = await import('@/app/api/auth/me/route');
    const eu = await ler(await me.GET());
    expect((eu.body.user as { mustChangePassword: boolean }).mustChangePassword).toBe(true);
    const feed = await import('@/app/api/feed/route');
    expect((await feed.GET(req('GET', '/api/feed'))).status).toBe(403);

    const troca = await import('@/app/api/auth/change-password/route');
    const t = await ler(
      await troca.POST(
        req('POST', '/api/auth/change-password', {
          currentPassword: provisoria,
          newPassword: 'minha-senha-nova-de-verdade',
        })
      )
    );
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    expect((await feed.GET(req('GET', '/api/feed'))).status).toBe(200);

    // A provisória morreu com a troca.
    expect((await logarComo({ email: velejador.email, senha: provisoria })).status).toBe(401);
    expect((await logarComo({ email: velejador.email, senha: 'minha-senha-nova-de-verdade' })).status).toBe(200);
  });

  it('derruba as sessões abertas, desbloqueia quem errou demais e invalida link de senha pendente', async () => {
    const v = await criarUsuario({ nome: 'Chutou Demais' });
    // Cinco erros: login bloqueado (429).
    for (let i = 0; i < 5; i++) await logarComo({ email: v.email, senha: 'errada-' + i });
    expect((await logarComo({ email: v.email, senha: 'errada-x' })).status).toBe(429);
    // Link de senha antigo, ainda válido.
    await logarComo(admin);
    const link = await import('@/app/api/admin/users/[id]/senha/route');
    const l = await ler(await link.POST(req('POST', `/api/admin/users/${v.id}/senha`), params({ id: v.id })));
    const tokenAntigo = String(l.body.url).split('/').pop();

    // Sessão aberta noutro aparelho, criada DEPOIS do link (que também
    // derruba sessões), para o teste enxergar a da senha provisória.
    await db.query(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ($1, 'sessao-aberta-no-celular', NOW() + INTERVAL '1 day')`,
      [v.id]
    );

    await logarComo(admin);
    const r = await gerar(v.id);
    expect(r.status).toBe(200);

    const sessoes = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM auth_sessions WHERE user_id = $1`,
      [v.id]
    );
    expect(sessoes.rows[0].n).toBe(0);
    expect((await logarComo({ email: v.email, senha: String(r.body.senhaProvisoria) })).status).toBe(200);

    const reset = await import('@/app/api/auth/reset-password/route');
    trocarPessoa();
    const usoDoLinkAntigo = await reset.POST(
      req('POST', '/api/auth/reset-password', { token: tokenAntigo, newPassword: 'por-cima-da-provisoria' })
    );
    expect(usoDoLinkAntigo.status).toBe(400);
  });

  it('só admin; não vale para a própria conta nem para conta suspensa; a senha não vai para a auditoria', async () => {
    const alvo = await criarUsuario({ nome: 'Alvo' });
    const comum = await criarUsuario({ nome: 'Comum' });

    trocarPessoa();
    expect((await gerar(alvo.id)).status).toBe(401);
    await logarComo(comum);
    expect((await gerar(alvo.id)).status).toBe(403);

    await logarComo(admin);
    expect((await gerar(admin.id)).status).toBe(400);

    await db.query(`UPDATE users SET is_active = FALSE WHERE id = $1`, [alvo.id]);
    expect((await gerar(alvo.id)).status).toBe(409);
    await db.query(`UPDATE users SET is_active = TRUE WHERE id = $1`, [alvo.id]);

    const r = await gerar(alvo.id);
    expect(r.status).toBe(200);
    const audit = await db.query<{ texto: string }>(
      `SELECT row_to_json(a)::text AS texto FROM audit_logs a
       WHERE action = 'admin.usuario.senha_provisoria' AND target_id = $1`,
      [alvo.id]
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].texto).not.toContain(String(r.body.senhaProvisoria));
  });
});
