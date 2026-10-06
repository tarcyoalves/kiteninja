import { neon } from '@neondatabase/serverless';

type Sql = ReturnType<typeof neon<false, false>>;

/**
 * MODO DE PRÉ-VISUALIZAÇÃO (`npm run dev:preview`): troca o Neon por um
 * Postgres em memória com dados fictícios (lib/dbPreview.ts), para ver o app
 * inteiro no celular sem banco nenhum.
 *
 * Por que isto não leva o PGlite para produção: o Next troca
 * `process.env.NODE_ENV` por uma constante no build ('production'), então o
 * ramo inteiro vira `if (false)` e é removido junto com o `require` — o
 * arquivo de pré-visualização não entra no bundle. Conferido em 06/10/2026
 * procurando "dbPreview"/"pglite" na saída de `next build` (ver o diário).
 * Não troque por `import` no topo: import estático entra no bundle sempre.
 */
function criarSql(): Sql {
  if (process.env.NODE_ENV === 'development' && process.env.KITENINJA_PREVIEW === '1') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./dbPreview').sql as Sql;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL não definida. Copie .env.example para .env.local e preencha com a connection string pooled do Neon.'
    );
  }

  /**
   * Cliente SQL do Neon over HTTP.
   * Usa a connection string *pooled* (host com `-pooler`) porque cada invocação
   * serverless na Vercel abriria uma conexão nova; sem o pooler o Neon estoura
   * o limite de conexões.
   */
  return neon(process.env.DATABASE_URL);
}

export const sql = criarSql();
