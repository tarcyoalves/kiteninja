/**
 * Banco de verdade para testar ROTAS de verdade — sem servidor, sem Neon.
 *
 * POR QUE EXISTE
 *
 * Os testes desta base eram, em grande parte, guardas de código-fonte: leem o
 * arquivo e procuram uma string. Elas pegam regressão de texto, mas não dizem
 * se o fluxo funciona — e várias vezes passaram com o defeito de volta (ver
 * docs/REDEFINIR-SENHA-NAO-PRESTOU.md). Este helper roda as rotas do App
 * Router contra um PGlite com o lib/schema.sql de produção, com cookies de
 * sessão reais. Foi assim que os cinco defeitos da redefinição de senha
 * apareceram, depois de um mês sem log para ler.
 *
 * COMO USAR, num arquivo `*.test.ts`:
 *
 *   vi.mock('@/lib/db', async () => (await import('@/test/rotasComPglite')).dbMock);
 *   vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);
 *   import { prepararBanco, criarUsuario, logarComo, req } from '@/test/rotasComPglite';
 *
 *   beforeAll(prepararBanco, 60_000);
 *   it('...', async () => {
 *     const admin = await criarUsuario({ role: 'admin' });
 *     await logarComo(admin);                         // cookie de sessão fica no pote
 *     const { GET } = await import('@/app/api/admin/users/route');
 *     const res = await GET(req('GET', '/api/admin/users'));
 *   });
 *
 * Os `vi.mock` precisam estar NO ARQUIVO DE TESTE (o Vitest os iça para o
 * topo); por isso este módulo exporta as fábricas, e não chama `vi.mock`.
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitSqlStatements } from '../lib/splitSqlStatements';

export const db = new PGlite({ extensions: { pgcrypto } });

/** Mesmo contrato do `neon()`: template tag que resolve nas linhas. */
export function sqlTag(strings: TemplateStringsArray, ...values: unknown[]) {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) text += `$${i + 1}` + strings[i + 1];
  return db.query(text, values as unknown[]).then((r) => r.rows);
}

export const dbMock = { sql: sqlTag };

/** O "navegador" atual. `trocarPessoa()` começa um pote vazio. */
const pote = { atual: new Map<string, string>() };
export function trocarPessoa() {
  pote.atual = new Map();
}

export const headersMock = {
  cookies: async () => ({
    get: (k: string) => (pote.atual.has(k) ? { name: k, value: pote.atual.get(k)! } : undefined),
    set: (k: string, v: string) => void pote.atual.set(k, v),
    delete: (k: string) => void pote.atual.delete(k),
  }),
  headers: async () => new Headers(),
};

let pronto: Promise<void> | null = null;
/** Aplica o schema real uma vez por arquivo de teste. */
export function prepararBanco(): Promise<void> {
  pronto ??= (async () => {
    const schema = readFileSync(join(process.cwd(), 'lib', 'schema.sql'), 'utf8');
    for (const st of splitSqlStatements(schema)) {
      try {
        await db.exec(st);
      } catch {
        // Objeto que o PGlite não suporta não interessa a estes fluxos; o
        // schema inteiro é validado contra Postgres real por verify-sql.
      }
    }
  })();
  return pronto;
}

export const BASE = 'https://kiteninja.vercel.app';

export function req(metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', caminho: string, corpo?: unknown) {
  return new Request(BASE + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'user-agent': 'vitest' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

/** `{ params }` no formato do App Router do Next 16 (Promise). */
export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

export interface UsuarioDeTeste {
  id: string;
  email: string;
  senha: string;
  nome: string;
}

let seq = 0;
export async function criarUsuario(o: {
  role?: 'admin' | 'moderator' | 'instructor' | 'rider';
  senha?: string;
  nome?: string;
  ativo?: boolean;
} = {}): Promise<UsuarioDeTeste> {
  const { hashPassword } = await import('../lib/auth');
  seq += 1;
  const email = `pessoa${seq}@teste.kiteninja`;
  const senha = o.senha ?? `senha-de-teste-${seq}`;
  const nome = o.nome ?? `Pessoa ${seq}`;
  const r = await db.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash, role, rider_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [email, nome, await hashPassword(senha), o.role ?? 'rider', `KN-T${seq}`, o.ativo ?? true]
  );
  return { id: r.rows[0].id, email, senha, nome };
}

/** Entra como essa pessoa, num pote de cookies novo. Devolve status e corpo. */
export async function logarComo(u: { email: string; senha: string }) {
  trocarPessoa();
  const { POST } = await import('../app/api/auth/login/route');
  const res = await POST(req('POST', '/api/auth/login', { email: u.email, password: u.senha }));
  return { status: res.status, body: await res.json() };
}

/** Lê status e corpo JSON de uma resposta de rota. */
export async function ler(res: Response) {
  const texto = await res.text();
  let body: unknown = texto;
  try {
    body = JSON.parse(texto);
  } catch {
    // corpo não-JSON (ex.: redirect)
  }
  return { status: res.status, body: body as Record<string, unknown> };
}
