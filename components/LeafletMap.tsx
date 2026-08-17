'use client';

// Importar CSS do Leaflet — necessário para os tiles renderizarem corretamente
import 'leaflet/dist/leaflet.css';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Spot } from '@/types';
import { getWindColorClass } from '@/lib/windUtils';
import { nearestSpot, LatLng } from '@/lib/geo';
import { WindParticleLayer } from './WindParticleLayer';
import { Navigation, Wind, Waves, Zap, MapPin, XCircle, Loader2 } from 'lucide-react';
import { useKiteData } from '@/context/KiteDataContext';

export type MapLayer = 'vento' | 'rajadas' | 'ondas';

// Centro aproximado da região dos spots (litoral RN/CE)
const DEFAULT_CENTER: LatLng = { lat: -4.5, lng: -37.5 };
const DEFAULT_ZOOM = 9;

interface LeafletMapProps {
  spots: Spot[];
  selectedSpot: Spot | null;
  onSelectSpot: (spot: Spot) => void;
  activeLayer: MapLayer;
  onLayerChange: (layer: MapLayer) => void;
  onLocateUser: () => void;
  locateStatus: 'idle' | 'loading' | 'success' | 'error' | 'denied';
  nearestSpotInfo: { spot: Spot; distanceKm: number } | null;
}

/** Componente interno para controllable center (usado pelo botão Localizar) */
function MapController({
  center,
  zoom,
}: {
  center: LatLng | null;
  zoom: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (center) {
      map.setView([center.lat, center.lng], zoom, { animate: true });
    }
  }, [map, center, zoom]);

  /**
   * O Leaflet mede o container uma vez, na montagem. Aqui ele monta dentro de
   * uma aba que acabou de aparecer e cuja altura ainda vai mudar (barra de
   * endereço do mobile recolhendo, `dvh` reavaliando), então a medida inicial
   * sai errada e os tiles ficam cinza — o mapa "vazio" que aparecia na tela.
   * invalidateSize remede; o ResizeObserver cobre rotação e troca de aba.
   */
  useEffect(() => {
    const remedir = () => map.invalidateSize({ animate: false });

    // Depois do paint: no frame da montagem o container ainda tem altura 0.
    const raf = requestAnimationFrame(remedir);
    const t = setTimeout(remedir, 250);

    const el = map.getContainer();
    const ro = new ResizeObserver(remedir);
    ro.observe(el);
    window.addEventListener('orientationchange', remedir);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      ro.disconnect();
      window.removeEventListener('orientationchange', remedir);
    };
  }, [map]);

  return null;
}

/** Criar DivIcon com o pin colorido */
function createSpotIcon(spot: Spot, layer: MapLayer): L.DivIcon {
  const { bg, border } = getWindColorClass(spot.currentKnots);

  let value: string;
  let icon: React.ReactNode;

  switch (layer) {
    case 'rajadas':
      value = `${spot.maxKnots}`;
      icon = <Zap size={10} className="text-white/90" />;
      break;
    case 'ondas':
      value = `${spot.waveHeightM.toFixed(1)}`;
      icon = <Waves size={10} className="text-white/90" />;
      break;
    default:
      value = `${spot.currentKnots}`;
      icon = <Wind size={10} className="text-white/90" />;
  }

  const html = `
    <div class="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-black shadow-lg border-2 ${bg} ${border} text-white whitespace-nowrap">
      <div class="flex items-center justify-center" style="transform: rotate(${spot.windDirectionDeg - 90}deg)">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L12 22M12 2L5 12M12 2L19 12"/>
        </svg>
      </div>
      <span>${value}</span>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'custom-spot-marker',
    iconSize: [60, 28],
    iconAnchor: [30, 14],
  });
}

/** Criar ícone para o spot encontrado via geolocalização */
function createUserLocationIcon(): L.DivIcon {
  const html = `
    <div class="relative">
      <div class="w-5 h-5 rounded-full bg-cyan-500 border-2 border-white shadow-lg animate-pulse"></div>
      <div class="absolute -inset-2 rounded-full bg-cyan-500/30 animate-ping"></div>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'user-location-marker',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

export const LeafletMap: React.FC<LeafletMapProps> = ({
  spots,
  selectedSpot,
  onSelectSpot,
  activeLayer,
  onLayerChange,
  onLocateUser,
  locateStatus,
  nearestSpotInfo,
}) => {
  /* Animação ligada por padrão: é o principal ganho de leitura do mapa. Fica
     desligável porque partícula em canvas custa bateria, e na praia isso pesa. */
  const [windAnim, setWindAnim] = useState(true);

  const mapRef = useRef<L.Map | null>(null);
  const [mapCenter, setMapCenter] = useState<LatLng | null>(null);
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);

  // Atualizar center quando nearestSpotInfo mudar (após geolocalização)
  useEffect(() => {
    if (locateStatus === 'success' && nearestSpotInfo) {
      setMapCenter({ lat: nearestSpotInfo.spot.lat, lng: nearestSpotInfo.spot.lng });
      setMapZoom(12);
    }
  }, [locateStatus, nearestSpotInfo]);

  const handleMarkerClick = useCallback((spot: Spot) => {
    onSelectSpot(spot);
  }, [onSelectSpot]);

  // Ajustar tile para modo escuro (Carto Dark) vs OSM padrão
  const useDarkTiles = true; // Tema escuro como padrão

  return (
    <div className="flex flex-col h-full relative">
      {/* Layer Selector Controls */}
      <div className="absolute top-3 left-3 right-3 z-map-ui flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-1.5 bg-[#0F172A]/90 backdrop-blur-md p-1.5 rounded-2xl border border-slate-700/80 pointer-events-auto shadow-2xl text-xs font-black text-white">
          <button
            onClick={() => onLayerChange('vento')}
            aria-pressed={activeLayer === 'vento'}
            className={`px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 ${
              activeLayer === 'vento'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Wind size={13} />
            <span>Vento</span>
          </button>
          <button
            onClick={() => onLayerChange('rajadas')}
            aria-pressed={activeLayer === 'rajadas'}
            className={`px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 ${
              activeLayer === 'rajadas'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Zap size={13} />
            <span>Rajadas</span>
          </button>
          <button
            onClick={() => onLayerChange('ondas')}
            aria-pressed={activeLayer === 'ondas'}
            className={`px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 ${
              activeLayer === 'ondas'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Waves size={13} />
            <span>Ondas</span>
          </button>
        </div>

        {/* Liga/desliga a animação de vento */}
        <button
          onClick={() => setWindAnim((v) => !v)}
          aria-pressed={windAnim}
          className={`p-2.5 rounded-2xl backdrop-blur-md border pointer-events-auto active:scale-95 shadow-xl transition-all ${
            windAnim
              ? 'bg-emerald-500/90 border-emerald-400 text-slate-950'
              : 'bg-[#0F172A]/90 border-slate-700/80 text-slate-400 hover:text-white'
          }`}
          title={windAnim ? 'Desligar animação de vento' : 'Ligar animação de vento'}
          aria-label={windAnim ? 'Desligar animação de vento' : 'Ligar animação de vento'}
        >
          <Wind size={18} />
        </button>

        {/* Locate Me Button */}
        <button
          onClick={onLocateUser}
          disabled={locateStatus === 'loading'}
          className="p-2.5 rounded-2xl bg-[#0F172A]/90 backdrop-blur-md border border-slate-700/80 text-white pointer-events-auto hover:bg-slate-800 active:scale-95 shadow-xl disabled:opacity-50"
          title="Minha localização"
          aria-label="Localizar minha posição"
        >
          {locateStatus === 'loading' ? (
            <Loader2 size={18} className="text-cyan-400 animate-spin" />
          ) : (
            <MapPin size={18} className="text-cyan-400" />
          )}
        </button>
      </div>

      {/* Map Container */}
      <div className="flex-1 w-full min-h-0 relative">
        <MapContainer
          center={[DEFAULT_CENTER.lat, DEFAULT_CENTER.lng]}
          zoom={DEFAULT_ZOOM}
          className="w-full h-full"
          ref={mapRef}
          zoomControl={false}
        >
          {/*
            attribution vazio: o banner branco do Leaflet no canto inferior
            quebrava a estética do app e roubava espaço numa tela de celular. O
            crédito de OpenStreetMap/CARTO exigido pela licença continua no app,
            movido para "Informação do Spot" — cumpre a atribuição sem poluir o
            mapa. Não remova o crédito do app: a licença ODbL exige.
          */}
          <TileLayer
            attribution=""
            url={
              useDarkTiles
                ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
            }
          />

          <MapController center={mapCenter} zoom={mapZoom} />

          {/* Partículas seguindo a direção real de cada spot (Open-Meteo).
              Só na camada de vento/rajadas: sobre "ondas" competiria com a
              informação que o usuário escolheu ver. */}
          {activeLayer !== 'ondas' && (
            <WindParticleLayer spots={spots} paused={!windAnim} />
          )}

          {/* Spot Markers */}
          {spots.map((spot) => (
            <Marker
              key={spot.id}
              position={[spot.lat, spot.lng]}
              icon={createSpotIcon(spot, activeLayer)}
              eventHandlers={{
                click: () => handleMarkerClick(spot),
              }}
            />
          ))}

          {/* User Location Marker (when located) */}
          {locateStatus === 'success' && nearestSpotInfo && (
            <Marker
              position={[
                nearestSpotInfo.spot.lat,
                nearestSpotInfo.spot.lng,
              ]}
              icon={createUserLocationIcon()}
              zIndexOffset={1000}
            />
          )}
        </MapContainer>

        {/* Locate Status Message */}
        {locateStatus !== 'idle' && (
          <div className="absolute top-20 left-3 right-3 z-map-ui">
            <div
              role="status"
              aria-live="polite"
              className={`px-3 py-2 rounded-xl text-xs font-bold text-center shadow-lg ${
                locateStatus === 'loading'
                  ? 'bg-slate-800 text-cyan-400'
                  : locateStatus === 'success'
                  ? 'bg-emerald-900/90 text-emerald-300 border border-emerald-500/30'
                  : locateStatus === 'denied'
                  ? 'bg-rose-900/90 text-rose-300 border border-rose-500/30'
                  : 'bg-amber-900/90 text-amber-300 border border-amber-500/30'
              }`}
            >
              {locateStatus === 'loading' && 'Localizando...'}
              {locateStatus === 'success' && nearestSpotInfo && (
                <>Spot mais próximo: {nearestSpotInfo.spot.name} ({nearestSpotInfo.distanceKm.toFixed(1)} km)</>
              )}
              {locateStatus === 'denied' && 'Permissão de localização negada. Ative o GPS.'}
              {locateStatus === 'error' && 'Erro ao obter localização. Tente novamente.'}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="absolute bottom-28 left-3 z-map-ui bg-[#0F172A]/90 backdrop-blur-md p-2.5 rounded-2xl border border-slate-700/80 text-[10px] text-white space-y-1 shadow-xl hidden sm:block">
        <span className="font-black block text-slate-400 uppercase text-[9px] tracking-wider">
          {activeLayer === 'vento' ? 'Vento (nós)' : activeLayer === 'rajadas' ? 'Rajada (nós)' : 'Ondas (m)'}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-500 shadow-xs shadow-sky-500" />
          <span>&lt; 12 nós (Foil)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 shadow-xs shadow-cyan-500" />
          <span>12-16 nós</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500" />
          <span>17-22 nós (Ideal)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-xs shadow-amber-500" />
          <span>23-28 nós (Forte)</span>
        </div>
      </div>

      {/* Accessibility: Screen-reader only spot summary */}
      <div className="sr-only" aria-live="polite">
        {spots.length} spots de kitesurf. {spots.map(s => `${s.name}: ${s.currentKnots} nós`).join('. ')}
      </div>
    </div>
  );
};
