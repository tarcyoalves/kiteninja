/**
 * `npm run dev:preview` — o app inteiro, localmente, sem banco nenhum.
 *
 * Liga KITENINJA_PREVIEW=1 e sobe `next dev`. O next.config.ts então troca o
 * banco Neon por um Postgres em memória com dados fictícios (lib/dbPreview.ts).
 * É um script em Node, e não `KITENINJA_PREVIEW=1 next dev` no package.json,
 * porque essa sintaxe não funciona no terminal do Windows.
 *
 * Contas (senha `preview-kite-123`): admin@preview.kiteninja (admin),
 * bruno@preview.kiteninja (velejador), carla@preview.kiteninja (instrutora).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const next = require.resolve('next/dist/bin/next');

const filho = spawn(process.execPath, [next, 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, KITENINJA_PREVIEW: '1' },
});
filho.on('exit', (code) => process.exit(code ?? 0));
