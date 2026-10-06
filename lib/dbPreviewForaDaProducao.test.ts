/**
 * O banco de pré-visualização (PGlite + dados fictícios) não pode entrar no
 * build de produção.
 *
 * Quem garante é UMA condição em lib/db.ts: `process.env.NODE_ENV ===
 * 'development'`, que o Next troca por constante no build e assim elimina o
 * `require('./dbPreview')`. Contraprova de 06/10/2026: sem essa condição, o
 * `next build` levou dbPreview/PGlite para as rotas de admin, de downwind e
 * outras. Este teste trava a condição e impede que outro arquivo importe o
 * preview diretamente (um import estático entra no bundle sempre).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = join(__dirname, '..');

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

describe('pré-visualização fora da produção', () => {
  it('lib/db.ts só carrega o preview dentro do ramo de desenvolvimento', () => {
    const fonte = readFileSync(join(raiz, 'lib', 'db.ts'), 'utf-8');
    expect(fonte).toMatch(
      /if \(process\.env\.NODE_ENV === 'development' && process\.env\.KITENINJA_PREVIEW === '1'\) \{\s*(\/\/[^\n]*\n\s*)*return require\('\.\/dbPreview'\)/,
    );
    expect(fonte).not.toMatch(/^import[^\n]*dbPreview/m);
  });

  it('nenhum outro arquivo do app importa o preview', () => {
    const quem = ['app', 'components', 'context', 'lib', 'views']
      .flatMap((d) => arquivos(join(raiz, d)))
      .filter((f) => !f.endsWith(join('lib', 'db.ts')) && !f.endsWith(join('lib', 'dbPreview.ts')))
      .filter((f) => /from ['"][^'"]*dbPreview['"]|require\(['"][^'"]*dbPreview['"]\)/.test(readFileSync(f, 'utf-8')))
      .map((f) => relative(raiz, f));
    expect(quem).toEqual([]);
  });

  it('lib/dbPreview.ts se recusa a carregar em produção', () => {
    const fonte = readFileSync(join(raiz, 'lib', 'dbPreview.ts'), 'utf-8');
    expect(fonte).toMatch(/if \(process\.env\.NODE_ENV === 'production'\) \{\s*throw new Error/);
  });
});
