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
}

const ATRIBUICAO_CARTO =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>';

const ATRIBUICAO_ESRI =
  'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

export const MAP_TILES: Record<MapStyle, MapTileConfig> = {
  oceanico: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: ATRIBUICAO_CARTO,
    rotulo: 'Oceânico Claro',
  },
  satelite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: ATRIBUICAO_ESRI,
    rotulo: 'Satélite',
  },
  escuro: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: ATRIBUICAO_CARTO,
    rotulo: 'Noturno',
  },
};
