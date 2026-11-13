/**
 * T08 — "esqueci minha senha" por e-mail, pelas ROTAS reais sobre PGlite.
 *
 * O Resend é o único pedaço simulado: `fetch` é trocado por um espião que
 * guarda o que seria enviado. Tudo o mais (token, hash, redefinição, login)
 * é o código de produção.
 *
 * Os dois aceites do plano:
 *   1. o link que chega no e-mail funciona;
 *   2. um link gerado ANTES pelo admin continua funcionando depois do pedido
 *      por e-mail (foi o "a redefinição não prestou").
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', async () => (await import('@/test/rotasComPglite')).dbMock);
vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);

import {
  criarUsuario,
  ler,
  logarComo,
  params,
  prepararBanco,
  req,
  sqlTag as sql,
  trocarPessoa,
  type UsuarioDeTeste,
} from '@/test/rotasComPglite';

const post = (path: string, body?: unknown) => req('POST', path, body);
const SENHA_ADMIN = 'senha-do-admin-123';
let admin: UsuarioDeTeste;

interface Enviado {
  url: string;
  authorization: string;
  corpo: { from: string; to: string[]; subject: string; text: string; html: string };
}
let enviados: Enviado[] = [];
let respostaDoResend: () => Response;

beforeAll(async () => {
  await prepararBanco();
  admin = await criarUsuario({ role: 'admin', nome: 'Admin', senha: SENHA_ADMIN });
}, 60_000);

beforeEach(() => {
  enviados = [];
  respostaDoResend = () => new Response(JSON.stringify({ id: 'x' }), { status: 200 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      enviados.push({
        url: String(url),
        authorization: String((init?.headers as Record<string, string>)?.Authorization),
        corpo: JSON.parse(String(init?.body)),
      });
      return respostaDoResend();
    })
  );
  vi.stubEnv('RESEND_API_KEY', 're_teste');
  vi.stubEnv('EMAIL_FROM', 'KiteNinja <nao-responda@exemplo.com>');
  vi.stubEnv('APP_URL', 'https://kiteninja.vercel.app');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function pedir(email: string) {
  trocarPessoa();
  const { POST } = await import('@/app/api/auth/recover-password/route');
  return ler(await POST(post('/api/auth/recover-password', { email })));
}

async function redefinir(token: string, newPassword: string) {
  trocarPessoa();
  const { POST } = await import('@/app/api/auth/reset-password/route');
  return ler(await POST(post('/api/auth/reset-password', { token, newPassword })));
}

const tokenDoEmail = (e: Enviado) => {
  const m = e.corpo.text.match(/\/recuperar-senha\/(\S+)/);
  expect(m, e.corpo.text).not.toBeNull();
  return m![1];
};

describe('recuperação de senha por e-mail (T08)', () => {
  it('o link que chega no e-mail funciona: redefine e entra', async () => {
    const v = await criarUsuario({ senha: 'senha-que-esqueci-1' });

    const r = await pedir(v.email);
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    expect(enviados).toHaveLength(1);
    const e = enviados[0];
    expect(e.url).toBe('https://api.resend.com/emails');
    expect(e.authorization).toBe('Bearer re_teste');
    expect(e.corpo.to).toEqual([v.email]);
    expect(e.corpo.from).toBe('KiteNinja <nao-responda@exemplo.com>');
    // O link sai de APP_URL, não do Host da requisição.
    expect(e.corpo.text).toContain('https://kiteninja.vercel.app/recuperar-senha/');
    expect(e.corpo.html).toContain('https://kiteninja.vercel.app/recuperar-senha/');

    const ok = await redefinir(tokenDoEmail(e), 'senha-nova-por-email');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await logarComo({ email: v.email, senha: 'senha-nova-por-email' })).status).toBe(200);
  });

  it('link do admin gerado ANTES continua valendo depois do pedido por e-mail', async () => {
    const v = await criarUsuario({ senha: 'senha-que-esqueci-2' });

    await logarComo({ email: admin.email, senha: SENHA_ADMIN });
    const { POST: gerar } = await import('@/app/api/admin/users/[id]/senha/route');
    const g = await ler(await gerar(post(`/api/admin/users/${v.id}/senha`), params({ id: v.id })));
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    const tokenDoAdmin = String(g.body.url).split('/recuperar-senha/')[1];

    expect((await pedir(v.email)).status).toBe(200);
    expect(enviados).toHaveLength(1);

    const ok = await redefinir(tokenDoAdmin, 'senha-nova-do-admin');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await logarComo({ email: v.email, senha: 'senha-nova-do-admin' })).status).toBe(200);
  });

  it('e-mail sem conta: mesma resposta, nenhum envio', async () => {
    const comConta = await criarUsuario({ senha: 'senha-que-esqueci-3' });
    const a = await pedir(comConta.email);
    const b = await pedir('ninguem-com-esse-email@exemplo.com');

    expect(b.status).toBe(200);
    expect(b.body.message).toBe(a.body.message);
    expect(b.body.ok).toBe(a.body.ok);
    // Só o pedido da conta existente gerou envio.
    expect(enviados).toHaveLength(1);
    expect(enviados[0].corpo.to).toEqual([comConta.email]);
  });

  it('Resend fora do ar: a rota responde igual, sem 500', async () => {
    const v = await criarUsuario({ senha: 'senha-que-esqueci-4' });
    respostaDoResend = () => new Response('erro', { status: 500 });
    const r = await pedir(v.email);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('sem chave configurada nada é enviado', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const v = await criarUsuario({ senha: 'senha-que-esqueci-5' });
    expect((await pedir(v.email)).status).toBe(200);
    expect(enviados).toHaveLength(0);
  });

  it('sem remetente configurado nada é enviado', async () => {
    vi.stubEnv('EMAIL_FROM', '');
    const v = await criarUsuario({ senha: 'senha-que-esqueci-6' });
    expect((await pedir(v.email)).status).toBe(200);
    expect(enviados).toHaveLength(0);
  });

  it('sem APP_URL nada é enviado: o link nunca sai do Host da requisição', async () => {
    vi.stubEnv('APP_URL', '');
    const v = await criarUsuario({ senha: 'senha-que-esqueci-9' });
    expect((await pedir(v.email)).status).toBe(200);
    expect(enviados).toHaveLength(0);
  });

  it('Host forjado na requisição não muda o link do e-mail', async () => {
    const v = await criarUsuario({ senha: 'senha-que-esqueci-10' });
    trocarPessoa();
    const { POST } = await import('@/app/api/auth/recover-password/route');
    const forjada = new Request('https://site-do-atacante.example/api/auth/recover-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'site-do-atacante.example' },
      body: JSON.stringify({ email: v.email }),
    });
    expect((await POST(forjada)).status).toBe(200);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].corpo.text).toContain('https://kiteninja.vercel.app/recuperar-senha/');
    expect(enviados[0].corpo.text).not.toContain('atacante');
    expect(enviados[0].corpo.html).not.toContain('atacante');
  });

  it('em produção sem envio configurado não se cria token que ninguém vai receber', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('NODE_ENV', 'production');
    const v = await criarUsuario({ senha: 'senha-que-esqueci-7' });

    const r = await pedir(v.email);
    expect(r.status).toBe(200);
    expect(r.body.resetToken).toBeUndefined();

    const linhas = await sql`SELECT 1 FROM password_reset_tokens WHERE user_id = ${v.id}`;
    expect(linhas).toHaveLength(0);
  });

  it('em produção o token nunca volta na resposta, mesmo com envio', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const v = await criarUsuario({ senha: 'senha-que-esqueci-8' });
    const r = await pedir(v.email);
    expect(r.body.resetToken).toBeUndefined();
    expect(enviados).toHaveLength(1);
  });
});
