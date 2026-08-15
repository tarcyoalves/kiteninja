import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Carrega .env.local sem dependência externa. Os scripts rodam via tsx, fora do
 * Next.js, então não herdam o carregamento automático de env dele.
 */
export function loadEnv(file = '.env.local'): void {
  const path = join(process.cwd(), file);
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}
