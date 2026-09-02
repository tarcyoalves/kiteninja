/**
 * Fonte única dos tiles de mapa do app.
 *
 * Antes de existir este arquivo, cada componente Leaflet tinha sua própria
 * cópia das URLs (`components/LeafletMap.tsx`, `components/DownwindMapa.tsx`,
 * `components/DownwindResumoMapa.tsx`), com estilos divergentes entre si e
 * todos passando `attribution=""`. Isso não era só duplicação: Esri (World
 * Imagery) e CartoDB (Voyager/Dark Matter) EXIGEM atribuição visível nos
 * termos de uso de seus tiles gratuitos — publicar sem ela é usar o serviço
 * fora do que os provedores permitem, não só um detalhe estético esquecido.
 * Centralizando aqui, os três componentes só apontam para o mesmo lugar e a
 * atribuição correta viaja junto da URL, sem chance de um deles esquecer.
 */

export type MapStyle = 'oceanico' | 'satelite' | 'escuro';

export interface MapTileConfig {
  url: string;
  /** Texto/HTML de atribuição, para passar direto ao `attribution` do
   * `<TileLayer>` — o controle padrão do Leaflet o renderiza discretamente
   * no canto do mapa (precisa de `attributionControl` ligado no
   * `MapContainer`, que é o padrão do Leaflet quando a prop não é definida). */
  attribution: string;
  /** Rótulo curto para UI (botão de alternar estilo, título). */
  rotulo: string;
  maxNativeZoom?: number;
  maxZoom?: number;
  /**
   * OBRIGATÓRIO, e não opcional — foi por ser opcional que o mapa ao vivo
   * ficou cinza. Ver `opcoesDeTile` logo abaixo.
   */
  subdomains: string;
}

/**
 * Subdomínios quando a URL não usa `{s}`.
 *
 * O Leaflet chama `_getSubdomain()` em TODA montagem de URL de tile, mesmo
 * quando o template não tem `{s}` — e essa função faz
 * `this.options.subdomains.length`. Com `subdomains` valendo `undefined`, isso
 * é um TypeError a cada tile, e o mapa fica cinza sem um único erro visível na
 * interface. Por isso o valor existe mesmo onde não é usado.
 */
const SUBDOMINIOS_PADRAO = 'abc';

const ATRIBUICAO_OSM =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

const ATRIBUICAO_ESRI =
  'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

export const MAP_TILES: Record<MapStyle, MapTileConfig> = {
  oceanico: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: ATRIBUICAO_OSM,
    rotulo: 'Oceânico Claro',
    maxNativeZoom: 19,
    maxZoom: 20,
    subdomains: SUBDOMINIOS_PADRAO,
  },
  satelite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: ATRIBUICAO_ESRI,
    rotulo: 'Satélite',
    maxNativeZoom: 18,
    maxZoom: 20,
    subdomains: SUBDOMINIOS_PADRAO,
  },
  escuro: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: ATRIBUICAO_ESRI,
    rotulo: 'Noturno',
    maxNativeZoom: 16,
    maxZoom: 20,
    subdomains: SUBDOMINIOS_PADRAO,
  },
};

/**
 * As opções prontas para entregar ao Leaflet, com todo campo preenchido.
 *
 * O BUG QUE ISTO CORRIGE: `components/downwind/DownwindLiveReplayViewer.tsx`
 * fazia `subdomains: tileConfig.subdomains` e o campo era opcional, então
 * chegava `undefined` ao `L.tileLayer`. O `setOptions` do Leaflet copia com
 * `for (var i in options)`, e a chave EXISTE mesmo valendo `undefined` — ou
 * seja, o `undefined` sobrescrevia o padrão `'abc'` da própria biblioteca. Aí
 * `_getSubdomain` estourava em cada tile e o mapa de telemetria ficava cinza,
 * com os marcadores por cima e nenhuma mensagem de erro.
 *
 * Dois dos cinco componentes já contornavam com `?? 'abcd'` e dois nem
 * passavam o campo. Ou seja: o arquivo existia para ser a fonte única e mesmo
 * assim cada tela tinha seu jeito. Devolver o objeto pronto tira essa decisão
 * de quem chama — é a diferença entre uma fonte única de DADOS e uma fonte
 * única de COMPORTAMENTO.
 */
export function opcoesDeTile(estilo: MapStyle): {
  url: string;
  attribution: string;
  maxNativeZoom: number;
  maxZoom: number;
  subdomains: string;
} {
  const c = MAP_TILES[estilo];
  return {
    url: c.url,
    attribution: c.attribution,
    maxNativeZoom: c.maxNativeZoom ?? 19,
    maxZoom: c.maxZoom ?? 20,
    subdomains: c.subdomains,
  };
}
