/**
 * Aplica lib/schema.sql no banco apontado por DATABASE_URL.
 *
 *   npx tsx scripts/migrate.ts
 *
 * O schema é idempotente (CREATE TABLE IF NOT EXISTS), então rodar de novo é
 * seguro e não destrói dado.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { loadEnv } from './load-env';

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERRO: DATABASE_URL não definida. Preencha .env.local.');
  process.exit(1);
}

const sql = neon(url);
const schema = readFileSync(join(process.cwd(), 'lib', 'schema.sql'), 'utf8');

/**
 * Divide por ';' no fim de linha. O schema não usa funções PL/pgSQL com ';'
 * interno, então essa separação simples basta — se um dia usar, trocar por
 * um parser de verdade.
 */
const statements = schema
  .split(/;\s*$/m)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !/^--/.test(s));

async function main() {
  console.log(`Aplicando ${statements.length} comandos...`);

  for (const [i, statement] of statements.entries()) {
    const label = statement.split('\n')[0].slice(0, 70);
    try {
      await sql.query(statement);
      console.log(`  [${i + 1}/${statements.length}] ok — ${label}`);
    } catch (err) {
      console.error(`  [${i + 1}/${statements.length}] FALHOU — ${label}`);
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `;
  console.log('\nTabelas no banco:');
  for (const t of tables) console.log('  -', (t as Record<string, unknown>).table_name);
  console.log('\nMigração concluída.');
}

main();
