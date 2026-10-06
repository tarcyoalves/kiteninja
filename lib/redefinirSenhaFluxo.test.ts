/**
 * FLUXO REAL de redefinição de senha, de ponta a ponta, contra Postgres.
 *
 * Não é guarda de código-fonte: roda as ROTAS de verdade (admin gera o link,
 * velejador redefine, velejador entra) sobre um PGlite com o lib/schema.sql
 * real. Existe porque o relato "a redefinição não prestou" chegou depois de
 * um mês, sem log (a retenção do plano Hobby já tinha apagado), e só
 * reproduzindo dava para separar o que é defeito do que é suposição.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Banco, cookies de sessão, pessoas e requisições vêm de test/rotasComPglite.ts
// (antes este arquivo carregava a própria cópia do PGlite).
vi.mock('@/lib/db', async () => (await import('@/test/rotasComPglite')).dbMock);
vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);

import {
  criarUsuario,
  ler,
  logarComo as logarComoPessoa,
  params,
  prepararBanco,
  req,
  trocarPessoa,
  type UsuarioDeTeste,
} from '@/test/rotasComPglite';

const post = (path: string, body?: unknown) => req('POST', path, body);

const SENHA_ADMIN = 'senha-do-admin-123';
let admin: UsuarioDeTeste;
let alysson: UsuarioDeTeste;

beforeAll(async () => {
  await prepararBanco();
  admin = await criarUsuario({ role: 'admin', nome: 'Admin', senha: SENHA_ADMIN });
  alysson = await criarUsuario({ nome: 'Alysson', senha: 'senha-antiga-esquecida' });
}, 60_000);

async function logarComo(email: string, password: string) {
  return logarComoPessoa({ email, senha: password });
}

describe('redefinição de senha pelo admin — fluxo real', () => {
  it('ponta a ponta: admin gera link → velejador redefine → velejador entra', async () => {
    // 1. Admin entra e gera o link.
    const entrouAdmin = await logarComo(admin.email, SENHA_ADMIN);
    expect(entrouAdmin.status, JSON.stringify(entrouAdmin.body)).toBe(200);

    const { POST: gerar } = await import('@/app/api/admin/users/[id]/senha/route');
    const g = await ler(await gerar(post(`/api/admin/users/${alysson.id}/senha`), params({ id: alysson.id })));
    const gb = g.body;
    expect(g.status, JSON.stringify(gb)).toBe(200);
    expect(gb.url).toMatch(/^https:\/\/kiteninja\.vercel\.app\/recuperar-senha\//);
    const token = String(gb.url).split('/recuperar-senha/')[1];

    // 2. Velejador abre o link e escolhe a senha nova (≥ 10, o que o servidor exige).
    trocarPessoa();
    const { POST: redefinir } = await import('@/app/api/auth/reset-password/route');
    const r = await ler(await redefinir(post('/api/auth/reset-password', { token, newPassword: 'nova-senha-boa' })));
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    // 3. Velejador entra com a senha nova.
    const v = await logarComo(alysson.email, 'nova-senha-boa');
    expect(v.status, JSON.stringify(v.body)).toBe(200);
  });
});

/** Admin gera um link para `userId` e devolve só o token. */
async function gerarLink(userId: string): Promise<string> {
  await logarComo(admin.email, SENHA_ADMIN);
  const { POST: gerar } = await import('@/app/api/admin/users/[id]/senha/route');
  const res = await ler(await gerar(post(`/api/admin/users/${userId}/senha`), params({ id: userId })));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return String(res.body.url).split('/recuperar-senha/')[1];
}

async function redefinir(token: string, newPassword: string) {
  trocarPessoa();
  const { POST } = await import('@/app/api/auth/reset-password/route');
  return ler(await POST(post('/api/auth/reset-password', { token, newPassword })));
}

async function novoVelejador(senha: string) {
  return criarUsuario({ senha });
}

/*
 * Cada cenário abaixo FALHAVA antes da correção — saída real das rotas,
 * registrada quando o relato chegou:
 *
 *   B  login com a senha NOVA >> 429 "Muitas tentativas de login incorretas"
 *   C  6 logins corretos      >> 200,200,200,200,200,429
 *   D  link do admin depois do "Esqueci minha senha" >> 400 "Link ... inválido"
 */
describe('o que fazia a redefinição "não prestar"', () => {
  it('B: quem errou a senha antes de pedir ajuda entra com a senha nova', async () => {
    const v = await novoVelejador('senha-antiga-esquecida-b');
    for (let i = 0; i < 5; i++) await logarComo(v.email, 'errada-' + i);
    // Bloqueio real: a sexta tentativa, mesmo certa, é recusada.
    expect((await logarComo(v.email, 'senha-antiga-esquecida-b')).status).toBe(429);

    const token = await gerarLink(v.id);
    expect((await redefinir(token, 'senha-nova-do-b')).status).toBe(200);

    const login = await logarComo(v.email, 'senha-nova-do-b');
    expect(login.status, JSON.stringify(login.body)).toBe(200);
  });

  it('C: logins CORRETOS não contam para o bloqueio', async () => {
    const v = await novoVelejador('senha-certa-do-c');
    const status: number[] = [];
    for (let i = 0; i < 8; i++) status.push((await logarComo(v.email, 'senha-certa-do-c')).status);
    expect(status.every((s) => s === 200), status.join(',')).toBe(true);
  });

  it('C: senha errada ainda bloqueia na sexta tentativa (força bruta segue barrada)', async () => {
    const v = await novoVelejador('senha-certa-do-c2');
    const status: number[] = [];
    for (let i = 0; i < 6; i++) status.push((await logarComo(v.email, 'chute-' + i)).status);
    expect(status, status.join(',')).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('D: "Esqueci minha senha" não mata o link que o admin mandou', async () => {
    const v = await novoVelejador('esquecida-ha-tempo-d');
    const tokenDoAdmin = await gerarLink(v.id);

    trocarPessoa();
    const { POST: esqueci } = await import('@/app/api/auth/recover-password/route');
    expect((await esqueci(post('/api/auth/recover-password', { email: v.email }))).status).toBe(200);

    const r = await redefinir(tokenDoAdmin, 'senha-nova-do-d');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await logarComo(v.email, 'senha-nova-do-d')).status).toBe(200);
  });

  it('D: usado um link, TODOS os outros da conta morrem', async () => {
    // A garantia que a invalidação na criação dava continua — só mudou de
    // lugar, do "gerou" para o "usou".
    const v = await novoVelejador('qualquer-uma-e');
    const primeiro = await gerarLink(v.id);
    const segundo = await gerarLink(v.id);
    expect((await redefinir(segundo, 'senha-nova-do-e')).status).toBe(200);
    expect((await redefinir(primeiro, 'outra-senha-do-e')).status).toBe(400);
    expect((await logarComo(v.email, 'senha-nova-do-e')).status).toBe(200);
  });

  it('A: a senha mínima da tela é a mesma do servidor', async () => {
    const { SENHA_MINIMA } = await import('@/lib/senhaRegras');
    const v = await novoVelejador('qualquer-uma-a');
    const curta = 'x'.repeat(SENHA_MINIMA - 1);
    const exata = 'y'.repeat(SENHA_MINIMA);
    expect((await redefinir(await gerarLink(v.id), curta)).status).toBe(400);
    expect((await redefinir(await gerarLink(v.id), exata)).status).toBe(200);
  });
});
