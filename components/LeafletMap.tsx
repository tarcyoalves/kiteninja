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
import { Navigation, Wind, Waves, Zap, MapPin, XCircle, Loader2, Layers } from 'lucide-react';
import { useKiteData } from '@/context/KiteDataContext';

export type MapLayer = 'vento' | 'rajadas' | 'ondas';
export type MapStyle = 'oceanico' | 'satelite' | 'escuro';

/** Dados de SOS ativo para renderização no mapa */
export interface ActiveSosMapData {
  id: string;
  lat: number | null;
  lng: number | null;
  accuracyM?: number | null;
  authorName?: string;
  status: string;
  responders?: Array<{
    userId: string;
    name?: string;
    state: string;
    lat: number | null;
    lng: number | null;
  }>;
}

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
  locateStatus: 'idle' | 'loading' | 'success' | 'error' | 'denied' | 'timeout';
  nearestSpotInfo: { spot: Spot; distanceKm: number } | null;
  userPosition: UserPosition | null;
  activeSosList?: ActiveSosMapData[];
  /** Incrementado a cada clique manual no botão "Minha localização" — ver
   * views/MapView.tsx. Recentraliza com zoom próximo mesmo depois da primeira
   * localização automática, quando o watch de GPS já está rodando. */
  recenterTrigger?: number;
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
      // Sem dado de onda o pino mostra "–" em vez de 0.0, que seria mar liso.
      value = spot.waveHeightM === null ? '–' : `${spot.waveHeightM.toFixed(1)}`;
      icon = <Waves size={10} className="text-white/90" />;
      break;
    default:
      value = `${spot.currentKnots}`;
      icon = <Wind size={10} className="text-white/90" />;
  }

  const html = `
    <div class="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black shadow-xl border-2 ${bg} ${border} text-white whitespace-nowrap backdrop-blur-xs">
      <div class="flex items-center justify-center shrink-0" style="transform: rotate(${spot.windDirectionDeg + 180}deg)">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
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

/** Criar ícone para a posição exata do velejador via geolocalização.
 *  Design com farol pulsante cyan + ponto branco de alta visibilidade. */
function createUserLocationIcon(reduceMotion: boolean): L.DivIcon {
  const pulseClass = reduceMotion ? '' : 'animate-pulse';
  const pingClass = reduceMotion ? '' : 'animate-ping';

  const html = `
    <div class="relative flex items-center justify-center w-7 h-7">
      <div class="absolute w-7 h-7 rounded-full bg-cyan-400/40 ${pingClass}"></div>
      <div class="relative w-5 h-5 rounded-full bg-cyan-500 border-2 border-white shadow-xl shadow-cyan-500/60 flex items-center justify-center ${pulseClass}">
        <div class="w-1.5 h-1.5 rounded-full bg-white"></div>
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'user-location-marker',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** Criar ícone pulsante vermelho para alerta de SOS ativo.
 *  Só deve ser instanciado quando existirem coordenadas lat/lng válidas. */
function createSosMarkerIcon(reduceMotion: boolean, authorName?: string): L.DivIcon {
  const pulseClass = reduceMotion ? '' : 'animate-ping';
  const html = `
    <div class="relative flex items-center justify-center">
      <div class="absolute w-8 h-8 rounded-full bg-rose-500/50 ${pulseClass}"></div>
      <div class="relative px-2.5 py-1 rounded-full bg-rose-600 border-2 border-white shadow-2xl shadow-rose-600/80 flex items-center gap-1 text-white font-black text-[11px] whitespace-nowrap">
        <span>🆘</span>
        <span>SOS${authorName ? ` • ${authorName}` : ''}</span>
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'custom-spot-marker',
    iconSize: [80, 32],
    iconAnchor: [40, 16],
  });
}

/** Criar ícone para responder a caminho de um SOS */
function createResponderMarkerIcon(name?: string): L.DivIcon {
  const html = `
    <div class="relative flex items-center justify-center">
      <div class="relative px-2 py-0.5 rounded-full bg-emerald-600 border border-white shadow-lg flex items-center gap-1 text-white font-bold text-[10px] whitespace-nowrap">
        <span>🏄</span>
        <span>${name || 'A caminho'}</span>
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'custom-spot-marker',
    iconSize: [60, 24],
    iconAnchor: [30, 12],
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
  activeSosList = [],
  recenterTrigger = 0,
}) => {
  /* Animação ligada por padrão: é o principal ganho de leitura do mapa. Fica
     desligável porque partícula em canvas custa bateria, e na praia isso pesa. */
  const [windAnim, setWindAnim] = useState(true);

  const mapRef = useRef<L.Map | null>(null);
  const [mapCenter, setMapCenter] = useState<LatLng | null>(null);
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);

  /**
   * Zoom que o botão "Minha localização" usa para chegar perto de verdade.
   * Antes o pinça-para-zoom não vinha ao caso: o efeito abaixo fazia
   * `fitBounds([usuário, spot mais próximo])`, capado em zoom 14 — se o spot
   * mais próximo estivesse a dezenas de km (comum fora do litoral coberto),
   * o enquadramento saía bem mais aberto que 14 para caber os dois pontos, e
   * o botão "para centralizar" deixava o usuário longe da própria posição em
   * vez de perto dela. Trocado por centralizar SÓ no usuário, sempre neste
   * zoom fixo — o spot mais próximo continua mostrado no card inferior
   * (nearestSpotInfo), só não dita mais o enquadramento da câmera.
   */
  const ZOOM_LOCALIZACAO = 16;

  // Estado para controlar se o usuário já foi localizado (para não re-enquadrar em cada atualização)
  const [hasInitiallyLocated, setHasInitiallyLocated] = useState(false);

  // Quando o usuário é localizado, centraliza nele com zoom próximo. Só na
  // PRIMEIRA localização bem-sucedida — depois disso o velejador pode dar
  // zoom/arrastar livremente sem o mapa "puxar" de volta a cada atualização
  // do watchPosition.
  useEffect(() => {
    if (locateStatus === 'success' && userPosition && mapRef.current && !hasInitiallyLocated) {
      mapRef.current.setView([userPosition.lat, userPosition.lng], ZOOM_LOCALIZACAO, {
        animate: true,
      });
    }
  }, [locateStatus, userPosition, hasInitiallyLocated]);

  // Clique manual no botão depois da primeira localização: recentraliza com
  // zoom próximo usando a posição mais recente já conhecida, mesmo sem uma
  // nova transição de locateStatus (o watch já está rodando havia tempo).
  // `recenterTrigger > 0` evita disparar no mount, quando o valor nasce 0.
  useEffect(() => {
    if (recenterTrigger > 0 && userPosition && mapRef.current) {
      mapRef.current.setView([userPosition.lat, userPosition.lng], ZOOM_LOCALIZACAO, {
        animate: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterTrigger]);

  // Após a primeira localização, apenas atualizar a posição do marcador (sem re-enquadrar)
  useEffect(() => {
    if (locateStatus === 'success' && userPosition && !hasInitiallyLocated) {
      setHasInitiallyLocated(true);
    }
  }, [locateStatus, userPosition, hasInitiallyLocated]);

  const handleMarkerClick = useCallback((spot: Spot) => {
    onSelectSpot(spot);
  }, [onSelectSpot]);

  // Estilo do mapa: oceânico claro por padrão (Voyager), com opção de satélite e noturno
  const [mapStyle, setMapStyle] = useState<MapStyle>('oceanico');

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
      <div className="absolute top-3 left-3 right-3 z-map-ui flex items-center justify-between pointer-events-none gap-2 flex-wrap sm:flex-nowrap">
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

        <div className="flex items-center gap-2">
          {/* Alterna estilo do mapa (Oceânico Claro / Satélite / Noturno) */}
          <button
            onClick={() => {
              setMapStyle((prev) => (prev === 'oceanico' ? 'satelite' : prev === 'satelite' ? 'escuro' : 'oceanico'));
            }}
            className="p-2.5 rounded-2xl bg-[#0F172A]/90 backdrop-blur-md border border-slate-700/80 text-cyan-300 pointer-events-auto hover:bg-slate-800 active:scale-95 shadow-xl transition-all flex items-center gap-1 text-xs font-bold"
            title={`Alternar estilo do mapa (Atual: ${
              mapStyle === 'oceanico' ? 'Oceânico Claro' : mapStyle === 'satelite' ? 'Satélite' : 'Noturno'
            })`}
            aria-label="Alternar estilo do mapa"
          >
            <Layers size={17} />
            <span className="hidden sm:inline text-[11px] font-bold text-slate-200">
              {mapStyle === 'oceanico' ? 'Claro' : mapStyle === 'satelite' ? 'Satélite' : 'Escuro'}
            </span>
          </button>

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
      </div>

      {/* Map Container */}
      <div className="flex-1 w-full min-h-0 relative">
        <MapContainer
          center={[DEFAULT_CENTER.lat, DEFAULT_CENTER.lng]}
          zoom={DEFAULT_ZOOM}
          minZoom={4}
          maxZoom={18}
          maxBounds={[[-35, -80], [10, -25]]}
          maxBoundsViscosity={0.6}
          className="w-full h-full"
          ref={mapRef}
          zoomControl={false}
        >
          {/*
            Tile layer dinâmico:
            - oceanico: CartoDB Voyager (mapa claro, com oceano azul, praias e relevo perfeitos)
            - satelite: Esri World Imagery (satélite em alta definição)
            - escuro: CartoDB Dark Matter
          */}
          <TileLayer
            key={mapStyle}
            attribution=""
            url={
              mapStyle === 'oceanico'
                ? 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
                : mapStyle === 'satelite'
                ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            }
            noWrap={false}
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

          {/* Marcadores de Alertas SOS Ativos (APENAS se houver coordenadas lat/lng reais) */}
          {activeSosList.map((sos) => {
            if (sos.lat === null || sos.lng === null) return null;
            return (
              <React.Fragment key={`sos-${sos.id}`}>
                {/* Círculo de precisão do SOS */}
                {sos.accuracyM && sos.accuracyM > 0 && (
                  <CircleMarker
                    center={[sos.lat, sos.lng]}
                    radius={Math.max(20, Math.min(100, sos.accuracyM / 4))}
                    pathOptions={{
                      color: '#f43f5e',
                      fillColor: '#f43f5e',
                      fillOpacity: 0.2,
                      weight: 2,
                      dashArray: '4, 6',
                    }}
                  />
                )}
                {/* Pino do SOS pulsante com z-index de máxima prioridade */}
                <Marker
                  position={[sos.lat, sos.lng]}
                  icon={createSosMarkerIcon(reduceMotion, sos.authorName)}
                  zIndexOffset={3000}
                />

                {/* Pinos dos velejadores que responderam a caminho com coordenadas reais */}
                {sos.responders?.map((resp) => {
                  if (resp.lat === null || resp.lng === null || resp.state === 'nao_posso') return null;
                  return (
                    <Marker
                      key={`resp-${sos.id}-${resp.userId}`}
                      position={[resp.lat, resp.lng]}
                      icon={createResponderMarkerIcon(resp.name)}
                      zIndexOffset={2500}
                    />
                  );
                })}
              </React.Fragment>
            );
          })}

          {/* User Location Marker and Accuracy Circle (when located) */}
          {userPosition && (
            <>
              {/* Círculo translúcido representando a precisão do GPS.
                  Raio igual à precisão em metros (GPS bom: ~10-30m, GPS ruim: >1km).
                  Cor muda conforme a qualidade: verde=excelente, amarelo=razoável, vermelho=ruim. */}
              <CircleMarker
                center={[userPosition.lat, userPosition.lng]}
                radius={Math.max(12, Math.min(60, userPosition.accuracy / 5))}
                pathOptions={{
                  color: userPosition.accuracy <= 50 ? '#22c55e' :
                         userPosition.accuracy <= 1000 ? '#eab308' : '#ef4444',
                  fillColor: userPosition.accuracy <= 50 ? '#22c55e' :
                            userPosition.accuracy <= 1000 ? '#eab308' : '#ef4444',
                  fillOpacity: 0.18,
                  weight: 2,
                }}
              />
              {/* Pino do usuário: farol azul com pulso nítido e z-index prioritário sobre os spots. */}
              <Marker
                position={[userPosition.lat, userPosition.lng]}
                icon={createUserLocationIcon(reduceMotion)}
                zIndexOffset={2000}
              />
            </>
          )}
        </MapContainer>

        {/* Locate Status Message */}
        {locateStatus !== 'idle' && (
          <div className="absolute top-20 left-3 right-3 z-map-ui animate-in fade-in duration-200">
            <div
              role="status"
              aria-live="polite"
              className={`px-3 py-2 rounded-xl text-xs font-bold text-center shadow-lg relative ${
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
              {/* App instalado na tela de início do iOS pede permissão de
                  localização separada da do Safari — quando ela trava, o
                  navegador às vezes nunca responde (nem sucesso, nem erro).
                  Ver o vigia de timeout em views/MapView.tsx. */}
              {locateStatus === 'timeout' && (
                <div className="flex flex-col gap-1">
                  <span>Sua localização está demorando demais para responder.</span>
                  <span className="text-[10px] opacity-75 font-normal">
                    Se você instalou o app na tela de início, confira se a permissão de
                    localização foi concedida a ELE (separada da do navegador) nos Ajustes do celular.
                  </span>
                </div>
              )}
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
