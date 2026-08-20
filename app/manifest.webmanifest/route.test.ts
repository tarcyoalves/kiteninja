/**
 * Trava do manifest do PWA.
 *
 * Duas classes de erro que só aparecem no celular instalado, nunca no navegador
 * de desenvolvimento, e por isso passam despercebidas:
 *
 *  1. Cor divergente. `background_color` é o fundo da SPLASH do app instalado.
 *     Estava #0B1220 enquanto o app pintava #0F172A, então a abertura piscava de
 *     um tom para o outro antes de mostrar a interface. É a mesma raiz da tarja
 *     no rodapé: cor duplicada em vez de fonte única (--app-bg no globals.css).
 *  2. Ícone declarado que não existe no disco. O iOS não avisa: ele cai no
 *     print da página, e o atalho na tela de início fica sem a logo. Um rename
 *     em public/brand/ é suficiente para causar isso silenciosamente.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GET } from './route';

const raizDoProjeto = join(import.meta.dirname, '..', '..');

/** Valor de --app-bg no :root do globals.css — a fonte única da cor de fundo. */
function corDoApp(): string {
  const css = readFileSync(join(raizDoProjeto, 'app', 'globals.css'), 'utf8');
  const m = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/--app-bg:\s*(#[0-9A-Fa-f]{3,8})/);
  if (!m) throw new Error('--app-bg não existe mais em globals.css');
  return m[1].toUpperCase();
}

async function manifest() {
  return (await GET().json()) as Record<string, unknown>;
}

describe('manifest.webmanifest', () => {
  it('serve como application/manifest+json', async () => {
    // Alguns Android ignoram o manifest servido como text/plain — daí a rota
    // existir em vez de um arquivo estático em public/.
    expect(GET().headers.get('Content-Type')).toContain('application/manifest+json');
  });

  it('as cores acompanham --app-bg', async () => {
    const m = await manifest();
    const esperada = corDoApp();
    expect(
      String(m.background_color).toUpperCase(),
      'background_color é a cor da splash: divergindo, a abertura pisca',
    ).toBe(esperada);
    expect(String(m.theme_color).toUpperCase()).toBe(esperada);
  });

  it('todo ícone declarado existe em public/', async () => {
    const m = await manifest();
    const icones = m.icons as Array<{ src: string }>;
    expect(icones.length).toBeGreaterThan(0);
    for (const { src } of icones) {
      const caminho = join(raizDoProjeto, 'public', src.replace(/^\//, ''));
      expect(
        existsSync(caminho),
        `${src} está no manifest mas não existe no disco: o iOS cai no print da página`,
      ).toBe(true);
    }
  });

  it('mantém um ícone maskable para o recorte do Android', async () => {
    const m = await manifest();
    const icones = m.icons as Array<{ purpose?: string }>;
    expect(
      icones.some((i) => i.purpose === 'maskable'),
      'sem maskable o launcher corta as bordas da logo',
    ).toBe(true);
  });

  it('abre em standalone e no escopo raiz', async () => {
    const m = await manifest();
    // standalone é o que remove a barra de endereço; sem isso o atalho abre
    // como aba comum e o app perde a aparência de aplicativo.
    expect(m.display).toBe('standalone');
    expect(m.scope).toBe('/');
    expect(m.start_url).toBe('/');
  });

  it('os atalhos apontam para abas que existem', async () => {
    const m = await manifest();
    const atalhos = (m.shortcuts ?? []) as Array<{ url: string }>;
    // page.tsx lê ?tab=; um valor com typo abre o app na aba padrão sem erro,
    // então o atalho simplesmente não faz nada e ninguém percebe.
    const page = readFileSync(join(raizDoProjeto, 'app', 'page.tsx'), 'utf8');
    const contexto = readFileSync(
      join(raizDoProjeto, 'context', 'KiteDataContext.tsx'),
      'utf8',
    );
    const fonte = page + contexto;
    for (const { url } of atalhos) {
      const tab = new URL(url, 'https://kiteninja.app').searchParams.get('tab');
      expect(tab, `${url} não traz ?tab=`).not.toBeNull();
      expect(fonte, `aba "${tab}" do atalho não aparece no código das abas`).toContain(
        `'${tab}'`,
      );
    }
  });
});
