import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_TILES, opcoesDeTile, type MapStyle } from './mapTiles';

const ESTILOS: MapStyle[] = ['oceanico', 'satelite', 'escuro'];

/**
 * Reprodução exata do que o Leaflet faz a cada tile.
 *
 * Copiado de node_modules/leaflet/dist/leaflet-src.js (`_getSubdomain`), que é
 * chamado por `getTileUrl` em TODA montagem de URL — inclusive quando o
 * template não tem `{s}`, que é o caso das três URLs deste projeto. Com
 * `subdomains` valendo `undefined`, o `.length` estoura.
 *
 * Está reproduzido aqui em vez de importar o Leaflet porque o Vitest deste
 * projeto roda em `environment: 'node'`, sem DOM — montar um mapa de verdade
 * não é possível, e foi por isso que o defeito passou por todo o pipeline.
 */
function getSubdomainDoLeaflet(opcoes: { subdomains: unknown }, x: number, y: number): string {
  const subs = opcoes.subdomains as string;
  const index = Math.abs(x + y) % subs.length;
  return subs[index];
}

describe('opcoesDeTile', () => {
  it('devolve subdomains preenchido para todo estilo', () => {
    for (const estilo of ESTILOS) {
      const o = opcoesDeTile(estilo);
      expect(typeof o.subdomains, estilo).toBe('string');
      expect(o.subdomains.length, estilo).toBeGreaterThan(0);
    }
  });

  it('sobrevive ao _getSubdomain do Leaflet — o crash que deixava o mapa cinza', () => {
    for (const estilo of ESTILOS) {
      const o = opcoesDeTile(estilo);
      // Coordenadas quaisquer, inclusive as que zeram a soma.
      for (const [x, y] of [[0, 0], [3, 7], [-2, 5], [1024, 2048]]) {
        expect(() => getSubdomainDoLeaflet(o, x, y), `${estilo} ${x},${y}`).not.toThrow();
      }
    }
  });

  it('prova que undefined era mesmo fatal — contraprova do diagnóstico', () => {
    // Sem esta contraprova o teste acima seria só uma afirmação: ele passaria
    // igual se o crash tivesse outra causa.
    expect(() => getSubdomainDoLeaflet({ subdomains: undefined }, 3, 7)).toThrow();
  });

  it('preenche maxZoom e maxNativeZoom sem deixar buraco', () => {
    for (const estilo of ESTILOS) {
      const o = opcoesDeTile(estilo);
      expect(Number.isFinite(o.maxNativeZoom), estilo).toBe(true);
      expect(Number.isFinite(o.maxZoom), estilo).toBe(true);
      expect(o.maxZoom).toBeGreaterThanOrEqual(o.maxNativeZoom);
    }
  });

  it('toda camada carrega atribuição — é exigência dos provedores, não estética', () => {
    for (const estilo of ESTILOS) {
      expect(opcoesDeTile(estilo).attribution.length, estilo).toBeGreaterThan(10);
    }
  });
});

/**
 * Guarda de código-fonte: nenhum componente pode voltar a montar as opções
 * de tile por conta própria.
 *
 * `lib/mapTiles.ts` foi criado para ser fonte única e mesmo assim os cinco
 * componentes divergiram: dois contornavam com `?? 'abcd'`, dois omitiam o
 * campo, e um passava direto — o que quebrou. Fonte única de DADOS não bastou;
 * é preciso fonte única de COMPORTAMENTO, e este teste é o que mantém isso.
 */
describe('todos os mapas usam as opções centralizadas', () => {
  const COMPONENTES = [
    'components/LeafletMap.tsx',
    'components/DownwindMapa.tsx',
    'components/DownwindResumoMapa.tsx',
    'components/CardSessaoFeedMapa.tsx',
    'components/downwind/DownwindLiveReplayViewer.tsx',
  ];

  for (const arquivo of COMPONENTES) {
    it(`${arquivo} não remonta as opções à mão`, () => {
      const src = readFileSync(arquivo, 'utf8');
      // `MAP_TILES[...].subdomains` fora de opcoesDeTile é exatamente a forma
      // que produziu o bug (com ou sem `?? 'abcd'` para disfarçar).
      expect(src).not.toMatch(/MAP_TILES\[[^\]]*\]\.subdomains/);
      expect(src).not.toMatch(/MAP_TILES\.\w+\.subdomains/);
    });
  }
});

describe('MAP_TILES', () => {
  it('não tem estilo sem subdomains declarado', () => {
    for (const [estilo, cfg] of Object.entries(MAP_TILES)) {
      expect(cfg.subdomains, estilo).toBeTruthy();
    }
  });
});
