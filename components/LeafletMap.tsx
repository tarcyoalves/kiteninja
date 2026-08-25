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
// ANT-005: `users.name` é campo livre e entra CRU em `L.divIcon({ html })`,
// que o Leaflet injeta via innerHTML. DownwindMapa.tsx já escapava; estes
// dois ícones de SOS/socorrista tinham ficado de fora.
import { escaparHtml } from '@/lib/htmlEscape';
import { WindParticleLayer } from './WindParticleLayer';
import { Wind, LocateFixed, XCircle, Loader2, Layers } from 'lucide-react';
import { useKiteData } from '@/context/KiteDataContext';
import { MAP_TILES, type MapStyle } from '@/lib/mapTiles';

export type { MapStyle };

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
   *
   * Um único remédio em 250ms não bastava na prática: relato real mostrou o
   * mapa com metade da largura em cinza e sem pedir tile nenhum ali — o
   * Leaflet mediu o container ANTES da barra de endereço do iOS recolher (ou
   * antes da transição de entrada na aba assentar), ficou com `_size` menor
   * que o real, e nunca recalculou sozinho depois disso porque nada mudou o
   * `clientWidth`/`clientHeight` de um jeito que o ResizeObserver notasse a
   * tempo. Mais tentativas espaçadas (250/600/1200ms) cobrem esse atraso sem
   * custo perceptível quando a medida já estava certa desde o início —
   * `invalidateSize` é barato quando não há nada para corrigir.
   */
  useEffect(() => {
    const remedir = () => map.invalidateSize({ animate: false });

    // Depois do paint: no frame da montagem o container ainda tem altura 0.
    const raf = requestAnimationFrame(remedir);
    const temporizadores = [250, 600, 1200].map((ms) => setTimeout(remedir, ms));

    const el = map.getContainer();
    const ro = new ResizeObserver(remedir);
    ro.observe(el);
    window.addEventListener('orientationchange', remedir);

    // Voltar de segundo plano (app trocado, tela bloqueada) é outro momento
    // clássico de medida desatualizada — o container pode ter mudado de
    // tamanho enquanto a aba não estava sendo pintada.
    const aoVoltarVisivel = () => {
      if (!document.hidden) remedir();
    };
    document.addEventListener('visibilitychange', aoVoltarVisivel);

    return () => {
      cancelAnimationFrame(raf);
      temporizadores.forEach(clearTimeout);
      ro.disconnect();
      window.removeEventListener('orientationchange', remedir);
      document.removeEventListener('visibilitychange', aoVoltarVisivel);
    };
  }, [map]);

  return null;
}

/** Criar DivIcon com o pin colorido */
function createSpotIcon(spot: Spot): L.DivIcon {
  const { bg, border } = getWindColorClass(spot.currentKnots);
  const value = `${spot.currentKnots}`;

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
        <span>SOS${authorName ? ` • ${escaparHtml(authorName)}` : ''}</span>
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
        <span>${name ? escaparHtml(name) : 'A caminho'}</span>
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
   * `mapRef` (acima) só fica preenchido depois que o `MapContainer` do
   * react-leaflet termina sua própria inicialização assíncrona: o `ref`
   * interno dele cria o mapa Leaflet e chama `setContext(...)` — um
   * `setState` que dispara um RE-RENDER do `MapContainer`, e só NESSE
   * re-render é que `useImperativeHandle` (por trás dos panos) copia a
   * instância para o `forwardedRef` que recebemos aqui. Ou seja,
   * `mapRef.current` pode continuar `null` por um instante depois da
   * montagem, e mutar uma ref NÃO dispara re-render em nenhum ancestral —
   * se um efeito daqui rodar exatamente nesse instante, ele nunca é
   * re-executado só porque a ref mudou depois.
   *
   * `mapReady` existe para fechar essa corrida: `whenReady` é um callback
   * do PRÓPRIO Leaflet (não depende do timing do `setContext`/`context`
   * acima), e vira um `setState` de verdade — garante um re-render, e por
   * consequência um novo passe dos efeitos, depois que o mapa está pronto.
   * Sem isto, em GPS rápido (fix em cache) competindo com o carregamento
   * pesado do chunk do Leaflet na PRIMEIRA vez que a aba Mapa abre (login
   * recém-feito, dezenas de outras requisições do app disparando junto), a
   * localização podia chegar ANTES do mapa estar pronto — e o efeito de
   * centralizar abaixo então nunca tinha uma segunda chance de rodar.
   */
  const [mapReady, setMapReady] = useState(false);

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

  /**
   * Quando o usuário é localizado, centraliza nele com zoom próximo. Só na
   * PRIMEIRA localização bem-sucedida — depois disso o velejador pode dar
   * zoom/arrastar livremente sem o mapa "puxar" de volta a cada atualização
   * do watchPosition.
   *
   * `hasInitiallyLocated` só pode virar `true` DENTRO deste mesmo efeito,
   * junto do `setView` de verdade — antes disso morava num efeito SEPARADO,
   * com a MESMA condição exceto o `mapRef.current`. Isso é exatamente a
   * corrida que `mapReady` (acima) existe para evitar: se o GPS resolvesse
   * antes do mapa estar pronto, aquele segundo efeito ainda assim marcava
   * `hasInitiallyLocated = true` (não checava a ref), e como esse booleano
   * é o que trava o efeito de centralizar para "só uma vez", a
   * centralização nunca mais teria uma segunda chance nesta montagem — só
   * saindo da aba Mapa e voltando (remontando o componente do zero) é que
   * resetava o estado e permitia tentar de novo. Era exatamente o sintoma
   * relatado: "não centraliza ao abrir o app, mas centraliza se eu sair e
   * voltar pro Mapa".
   */
  useEffect(() => {
    if (
      mapReady &&
      locateStatus === 'success' &&
      userPosition &&
      mapRef.current &&
      !hasInitiallyLocated
    ) {
      mapRef.current.setView([userPosition.lat, userPosition.lng], ZOOM_LOCALIZACAO, {
        animate: true,
      });
      setHasInitiallyLocated(true);
    }
  }, [mapReady, locateStatus, userPosition, hasInitiallyLocated]);

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

  const handleMarkerClick = useCallback((spot: Spot) => {
    onSelectSpot(spot);
  }, [onSelectSpot]);

  // Estilo do mapa: satélite por padrão — é o "mapa realista" pedido para a
  // futura timeline social (docs/PLANO-REDE-SOCIAL.md, Fase 0), com oceânico
  // claro (Voyager) e noturno como alternativas.
  const [mapStyle, setMapStyle] = useState<MapStyle>('satelite');

  // Detectar preferência de movimento reduzido para desativar animações
  const [reduceMotion, setReduceMotion] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');

    const listener = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);

  return (
    <div className="flex flex-col h-full relative">
      {/* Ícones de topo + Locate Status Message: um wrapper só, em fluxo
          normal (flex-col), em vez de dois blocos `absolute` independentes
          com `top` fixo em pixel. Antes o aviso verde usava `top-20`
          chutando a altura da fileira de cima, e quebrava se essa altura
          mudasse por qualquer motivo. Empilhando os dois em fluxo normal, o
          aviso sempre nasce logo abaixo da fileira, sem depender de nenhum
          número mágico. */}
      <div className="absolute top-3 left-3 right-3 z-map-ui flex flex-col gap-2 pointer-events-none">
        <div className="flex items-center justify-end gap-2">
          {/* Alterna estilo do mapa (Oceânico Claro / Satélite / Noturno) */}
          <button
            onClick={() => {
              setMapStyle((prev) => (prev === 'oceanico' ? 'satelite' : prev === 'satelite' ? 'escuro' : 'oceanico'));
            }}
            className="p-2.5 rounded-2xl bg-[#0F172A]/90 backdrop-blur-md border border-slate-700/80 text-cyan-300 pointer-events-auto hover:bg-slate-800 active:scale-95 shadow-xl transition-all flex items-center gap-1 text-xs font-bold"
            title={`Alternar estilo do mapa (Atual: ${MAP_TILES[mapStyle].rotulo})`}
            aria-label="Alternar estilo do mapa"
          >
            <Layers size={17} />
            <span className="hidden sm:inline text-[11px] font-bold text-slate-200">
              {MAP_TILES[mapStyle].rotulo}
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

          {/* Botão de centralizar no GPS — de propósito diferente dos dois
              vizinhos (estilo/animação): estes são ajustes de exibição, este
              é a ação que a pessoa mais procura ao abrir o mapa. Fundo cyan
              preenchido (mesma linguagem do botão INICIAR) + ícone de mira
              (LocateFixed, o mesmo símbolo de "centralizar em mim" do Google/
              Apple Maps — MapPin, o pino de gota, significa "um lugar
              marcado", não "minha posição ao vivo") fazem ele se destacar em
              vez de se misturar aos outros dois ícones neutros da fileira. */}
          <button
            onClick={onLocateUser}
            disabled={locateStatus === 'loading'}
            className="p-2.5 rounded-2xl bg-cyan-500 border border-cyan-300/50 text-slate-950 pointer-events-auto hover:bg-cyan-400 active:scale-95 shadow-xl shadow-cyan-500/30 disabled:opacity-50"
            title="Centralizar no meu GPS"
            aria-label="Centralizar mapa na minha localização"
          >
            {locateStatus === 'loading' ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <LocateFixed size={18} className="stroke-[2.5]" />
            )}
          </button>
        </div>

        {/* Locate Status Message — em fluxo normal logo abaixo da fileira
            acima (ver comentário no wrapper pai), nunca mais com `top`
            chutado em pixel. */}
        {locateStatus !== 'idle' && (
          <div className="animate-in fade-in duration-200">
            <div
              role="status"
              aria-live="polite"
              className={`px-3 py-2 rounded-xl text-xs font-bold text-center shadow-lg relative pointer-events-auto ${
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
          whenReady={() => setMapReady(true)}
        >
          {/* Tile layer dinâmico — URL, atribuição e rótulo vêm todos de
              lib/mapTiles.ts (fonte única, ver comentário lá).

              keepBuffer sobe de 2 (padrão) para 6: no mobile o Leaflet só
              busca tile novo quando o gesto de arrastar TERMINA
              (updateWhenIdle, padrão true no mobile) — de propósito, para não
              disparar dezenas de requisições por segundo durante o arrasto.
              O preço é que a área recém-revelada só tem tile pedido DEPOIS
              de soltar o dedo, e a viagem de rede até o tile de satélite
              chegar é o "demora um pouco para carregar" relatado ao
              deslizar. keepBuffer maior pré-busca mais anéis de tiles ao
              redor da área visível enquanto o mapa está parado, então boa
              parte do que aparece ao arrastar já está em cache local
              quando o gesto termina — sem mudar o comportamento de só
              buscar ao soltar o dedo (que continua correto). */}
          <TileLayer
            key={mapStyle}
            attribution={MAP_TILES[mapStyle].attribution}
            url={MAP_TILES[mapStyle].url}
            noWrap={false}
            keepBuffer={6}
          />

          <MapController center={mapCenter} zoom={mapZoom} />

          {/* Partículas seguindo a direção real de cada spot (Open-Meteo). */}
          <WindParticleLayer spots={spots} paused={!windAnim} />

          {/* Spot Markers */}
          {spots.map((spot) => (
            <Marker
              key={spot.id}
              position={[spot.lat, spot.lng]}
              icon={createSpotIcon(spot)}
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
      </div>

      {/* Legend */}
      <div className="absolute bottom-28 left-3 z-map-ui bg-[#0F172A]/90 backdrop-blur-md p-2.5 rounded-2xl border border-slate-700/80 text-[10px] text-white space-y-1 shadow-xl hidden sm:block">
        <span className="font-black block text-slate-400 uppercase text-[9px] tracking-wider">
          Vento (nós)
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
