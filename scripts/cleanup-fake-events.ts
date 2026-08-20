/**
 * Remove os eventos de demonstração seedados (nunca foram reais) e eventos
 * "Downwind" órfãos criados por tentativas que falharam antes de
 * downwinds.event_id existir no banco (rodar scripts/migrate.ts primeiro).
 *
 *   npx tsx scripts/cleanup-fake-events.ts
 *
 * Idempotente: rodar de novo sem nada pra apagar não dá erro, só reporta 0.
 */
import { neon } from '@neondatabase/serverless';
import { loadEnv } from './load-env';

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERRO: DATABASE_URL não definida. Preencha .env.local.');
  process.exit(1);
}

const sql = neon(url);

const TITULOS_DEMO = [
  'Downwind dos Faróis RN (Touros -> Ponta do Mel)',
  'Circuito Cearense de Kite Big Air & Freestyle',
  'Clínica de Saltos e Hydrofoil com Pro Riders',
];

async function main() {
  const fakes = await sql`
    DELETE FROM events
    WHERE title = ANY(${TITULOS_DEMO})
    RETURNING id, title
  `;
  console.log(`Eventos de demonstração removidos: ${fakes.length}`);
  for (const f of fakes) console.log(`  - ${(f as Record<string, unknown>).title}`);

  const orfaos = await sql`
    DELETE FROM events
    WHERE type = 'Downwind'
      AND NOT EXISTS (SELECT 1 FROM downwinds d WHERE d.event_id = events.id)
    RETURNING id, title
  `;
  console.log(`\nEventos Downwind órfãos removidos: ${orfaos.length}`);
  for (const o of orfaos) console.log(`  - ${(o as Record<string, unknown>).title}`);

  console.log('\nLimpeza concluída.');
}

main();
