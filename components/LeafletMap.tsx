'use client';

// Importar CSS do Leaflet — necessário para os tiles renderizarem corretamente
import 'leaflet/dist/leaflet.css';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Spot } from '@/types';
import { getWindColorClass } from '@/lib/windUtils';
import { nearestSpot, LatLng } from '@/lib/geo';
import { formatDistance } from '@/lib/geoFormat';
import { WindParticleLayer } from './WindParticleLayer';
import { Navigation, Wind, Waves, Zap, MapPin, XCircle, Loader2 } from 'lucide-react';
import { useKiteData } from '@/context/KiteDataContext';

export type MapLayer = 'vento' | 'rajadas' | 'ondas';

/** Posição do usuário obtida via Geolocation API */
export interface UserPosition {
  lat: number;
  lng: number;
  accuracy: number; // metros
}

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
  userPosition: UserPosition | null;
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

/** Criar ícone para o spot encontrado via geolocalização.
 *  O marcador é visualmente diferente dos pins de spot (ponto azul com halo de pulso)
 *  para que o usuário não confunda sua posição com um spot de kite.
 *  Respeita prefers-reduced-motion: se o usuário solicitou menos animação,
 *  removes o efeito de pulso para economizar bateria e evitar incômodo. */
function createUserLocationIcon(reduceMotion: boolean): L.DivIcon {
  const pulseClass = reduceMotion ? '' : 'animate-pulse';
  const pingClass = reduceMotion ? '' : 'animate-ping';

  const html = `
    <div class="relative">
      <div class="w-5 h-5 rounded-full bg-cyan-500 border-2 border-white shadow-lg ${pulseClass}"></div>
      <div class="absolute -inset-2 rounded-full bg-cyan-500/30 ${pingClass}"></div>
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
  userPosition,
}) => {
  /* Animação ligada por padrão: é o principal ganho de leitura do mapa. Fica
     desligável porque partícula em canvas custa bateria, e na praia isso pesa. */
  const [windAnim, setWindAnim] = useState(true);

  const mapRef = useRef<L.Map | null>(null);
  const [mapCenter, setMapCenter] = useState<LatLng | null>(null);
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);

  // Quando o usuário é localizado, enquadrar mapa mostrando usuário E spot mais próximo juntos.
  // fitBounds com padding garante que ambos fiquem visíveis na tela.
  useEffect(() => {
    if (locateStatus === 'success' && userPosition && nearestSpotInfo && mapRef.current) {
      const map = mapRef.current;
      const userLatLng: L.LatLngTuple = [userPosition.lat, userPosition.lng];
      const spotLatLng: L.LatLngTuple = [nearestSpotInfo.spot.lat, nearestSpotInfo.spot.lng];

      // Criar bounds com os dois pontos
      const bounds = L.latLngBounds([userLatLng, spotLatLng]);

      // Padding para não colar nas bordas - 15% em cada lado
      const padding: L.PointTuple = [
        window.innerWidth * 0.15,
        window.innerHeight * 0.15,
      ];

      // Ajustar zoom e centro para mostrar os dois pontos
      map.fitBounds(bounds, {
        padding,
        maxZoom: 14, // Zoom máximo para não perder contexto
        animate: true,
      });
    }
  }, [locateStatus, userPosition, nearestSpotInfo]);

  // Estado para controlar se o usuário já foi localizado (para não re-enquadrar em cada atualização)
  const [hasInitiallyLocated, setHasInitiallyLocated] = useState(false);

  // Após a primeira localização, apenas atualizar a posição do marcador (sem re-enquadrar)
  useEffect(() => {
    if (locateStatus === 'success' && userPosition && !hasInitiallyLocated) {
      setHasInitiallyLocated(true);
    }
  }, [locateStatus, userPosition, hasInitiallyLocated]);

  const handleMarkerClick = useCallback((spot: Spot) => {
    onSelectSpot(spot);
  }, [onSelectSpot]);

  // Ajustar tile para modo escuro (Carto Dark) vs OSM padrão
  const useDarkTiles = true; // Tema escuro como padrão

  // Detectar preferência de movimento reduzido para desativar animações
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);

    const listener = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);

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

          {/* User Location Marker and Accuracy Circle (when located) */}
          {locateStatus === 'success' && userPosition && (
            <>
              {/* Círculo translúcido representando a precisão do GPS.
                  Raio igual à precisão em metros (GPS bom: ~10-30m, GPS ruim: >1km).
                  Cor muda conforme a qualidade: verde=excelente, amarelo=razoável, vermelho=ruim. */}
              <CircleMarker
                center={[userPosition.lat, userPosition.lng]}
                radius={Math.max(10, userPosition.accuracy / 5)}
                pathOptions={{
                  color: userPosition.accuracy <= 50 ? '#22c55e' :
                         userPosition.accuracy <= 1000 ? '#eab308' : '#ef4444',
                  fillColor: userPosition.accuracy <= 50 ? '#22c55e' :
                            userPosition.accuracy <= 1000 ? '#eab308' : '#ef4444',
                  fillOpacity: 0.15,
                  weight: 1.5,
                }}
              />
              {/* Pino do usuário: ponto azul com animação de pulso para ser visível e
                  diferente dos pinos de spot. Z-index alto para ficar acima dos spots. */}
              <Marker
                position={[userPosition.lat, userPosition.lng]}
                icon={createUserLocationIcon(reduceMotion)}
                zIndexOffset={1000}
              />
            </>
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
              {locateStatus === 'success' && nearestSpotInfo && userPosition && (
                <div className="flex flex-col gap-1">
                  <span>
                    Você está a {formatDistance(nearestSpotInfo.distanceKm)} de {nearestSpotInfo.spot.name}
                  </span>
                  {/* Mostrar precisão apenas se for ruim (> 100m), para não poluir a tela */}
                  {userPosition.accuracy > 100 && (
                    <span className="text-[10px] opacity-75">
                      Precisão: {userPosition.accuracy > 1000
                        ? `~${(userPosition.accuracy / 1000).toFixed(1)} km`
                        : `~${Math.round(userPosition.accuracy)} m`}
                    </span>
                  )}
                </div>
              )}
              {locateStatus === 'denied' && 'Permissão negada. Ative nas configurações do navegador.'}
              {locateStatus === 'error' && 'Não foi possível obter sua localização. Verifique o GPS.'}
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
