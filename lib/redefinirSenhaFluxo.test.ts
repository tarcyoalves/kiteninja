/**
 * FLUXO REAL de redefinição de senha, de ponta a ponta, contra Postgres.
 *
 * Não é guarda de código-fonte: roda as ROTAS de verdade (admin gera o link,
 * velejador redefine, velejador entra) sobre um PGlite com o lib/schema.sql
 * real. Existe porque o relato "a redefinição não prestou" chegou depois de
 * um mês, sem log (a retenção do plano Hobby já tinha apagado), e só
 * reproduzindo dava para separar o que é defeito do que é suposição.
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { splitSqlStatements } from './splitSqlStatements';

const db = new PGlite({ extensions: { pgcrypto } });

/** Mesmo contrato do `neon()`: template tag que devolve as linhas. */
function sqlTag(strings: TemplateStringsArray, ...values: unknown[]) {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) text += `$${i + 1}` + strings[i + 1];
  return db.query(text, values as unknown[]).then((r) => r.rows);
}

vi.mock('@/lib/db', () => ({ sql: sqlTag }));
vi.mock('./db', () => ({ sql: sqlTag }));

/** Pote de cookies trocável: cada "pessoa" do teste tem o seu. */
let jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => new Headers(),
}));

const BASE = 'https://kiteninja.vercel.app';
const post = (path: string, body?: unknown) =>
  new Request(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': 'vitest' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

let adminId = '';
let alyssonId = '';
const ALYSSON_EMAIL = 'alysson@exemplo.com';

beforeAll(async () => {
  const schema = readFileSync(join(process.cwd(), 'lib', 'schema.sql'), 'utf8');
  for (const st of splitSqlStatements(schema)) {
    try {
      await db.exec(st);
    } catch {
      // Extensões/objetos que o PGlite não tem (ex.: índices específicos do
      // Neon) não interessam a este fluxo.
    }
  }
  const { hashPassword } = await import('./auth');
  const ha = await hashPassword('senha-do-admin-123');
  const hv = await hashPassword('senha-antiga-esquecida');
  adminId = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, role, rider_id) VALUES ('admin@exemplo.com','Admin',$1,'admin','KN-ADMIN') RETURNING id`,
      [ha]
    )
  ).rows[0].id;
  alyssonId = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, role, rider_id) VALUES ($2,'Alysson',$1,'rider','KN-ALYSSON') RETURNING id`,
      [hv, ALYSSON_EMAIL]
    )
  ).rows[0].id;
}, 60_000);

async function logarComo(email: string, password: string) {
  jar = new Map();
  const { POST } = await import('@/app/api/auth/login/route');
  const res = await POST(post('/api/auth/login', { email, password }));
  return { status: res.status, body: await res.json() };
}

describe('redefinição de senha pelo admin — fluxo real', () => {
  it('ponta a ponta: admin gera link → velejador redefine → velejador entra', async () => {
    // 1. Admin entra e gera o link.
    const admin = await logarComo('admin@exemplo.com', 'senha-do-admin-123');
    expect(admin.status, JSON.stringify(admin.body)).toBe(200);

    const { POST: gerar } = await import('@/app/api/admin/users/[id]/senha/route');
    const g = await gerar(post(`/api/admin/users/${alyssonId}/senha`), {
      params: Promise.resolve({ id: alyssonId }),
    });
    const gb = await g.json();
    expect(g.status, JSON.stringify(gb)).toBe(200);
    expect(gb.url).toMatch(/^https:\/\/kiteninja\.vercel\.app\/recuperar-senha\//);
    const token = String(gb.url).split('/recuperar-senha/')[1];

    // 2. Velejador abre o link e escolhe a senha nova (≥ 10, o que o servidor exige).
    jar = new Map();
    const { POST: redefinir } = await import('@/app/api/auth/reset-password/route');
    const r = await redefinir(post('/api/auth/reset-password', { token, newPassword: 'nova-senha-boa' }));
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);

    // 3. Velejador entra com a senha nova.
    const v = await logarComo(ALYSSON_EMAIL, 'nova-senha-boa');
    expect(v.status, JSON.stringify(v.body)).toBe(200);
  });
});

/** Admin gera um link para `userId` e devolve só o token. */
async function gerarLink(userId: string): Promise<string> {
  await logarComo('admin@exemplo.com', 'senha-do-admin-123');
  const { POST: gerar } = await import('@/app/api/admin/users/[id]/senha/route');
  const res = await gerar(post(`/api/admin/users/${userId}/senha`), {
    params: Promise.resolve({ id: userId }),
  });
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(200);
  return String(body.url).split('/recuperar-senha/')[1];
}

async function redefinir(token: string, newPassword: string) {
  jar = new Map();
  const { POST } = await import('@/app/api/auth/reset-password/route');
  const res = await POST(post('/api/auth/reset-password', { token, newPassword }));
  return { status: res.status, body: await res.json() };
}

let seq = 0;
async function novoVelejador(senha: string) {
  const { hashPassword } = await import('./auth');
  seq += 1;
  const email = `v${seq}@exemplo.com`;
  const id = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, role, rider_id) VALUES ($1,$2,$3,'rider',$4) RETURNING id`,
      [email, `V${seq}`, await hashPassword(senha), `KN-V${seq}`]
    )
  ).rows[0].id;
  return { id, email };
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

    jar = new Map();
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
    const { SENHA_MINIMA } = await import('./senhaRegras');
    const v = await novoVelejador('qualquer-uma-a');
    const curta = 'x'.repeat(SENHA_MINIMA - 1);
    const exata = 'y'.repeat(SENHA_MINIMA);
    expect((await redefinir(await gerarLink(v.id), curta)).status).toBe(400);
    expect((await redefinir(await gerarLink(v.id), exata)).status).toBe(200);
  });
});
