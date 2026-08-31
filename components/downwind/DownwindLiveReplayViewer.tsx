'use client';

import 'leaflet/dist/leaflet.css';
import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Radio,
  Share2,
  Users,
  ChevronLeft,
  Layers,
  ArrowRight,
  Loader2,
  Check,
  Trophy,
} from 'lucide-react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import { mesclarPontos } from '@/lib/trilhaDownwind';
import { useAoMudar } from '@/lib/useAoMudar';
import { MAP_TILES } from '@/lib/mapTiles';

interface ParticipanteLive {
  userId: string;
  name: string;
  avatarUrl: string | null;
  papel: string;
  estado: string;
  corHex: string;
  distanciaKm: number;
  velocidadeMaxNos: number;
  ultimaPosicao: {
    lat: number;
    lng: number;
    speedKnots: number;
    heading: number | null;
    registradoEm: string;
    bateriaPct?: number;
  } | null;
}

interface DownwindData {
  id: string;
  nome: string;
  status: string;
  visibilidade: string;
  iniciadoEm: string | null;
  encerradoEm: string | null;
  origemSpotNome: string | null;
  destinoSpotNome: string | null;
  origemLat: number | null;
  origemLng: number | null;
  destinoLat: number | null;
  destinoLng: number | null;
  distanciaEstimadaKm: number | null;
}

interface LiveApiResponse {
  downwind: DownwindData;
  participantes: ParticipanteLive[];
  trilhas: Record<string, [number, number, number, number][]>;
  cursor: string | null;
  incremental: boolean;
  parcial: boolean;
}

export const DownwindLiveReplayViewer: React.FC<{
  downwindId: string;
  modoEmbutido?: boolean;
}> = ({ downwindId, modoEmbutido = false }) => {
  const [dados, setDados] = useState<LiveApiResponse | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mapLayer, setMapLayer] = useState<'escuro' | 'satelite'>('escuro');
  const [painelParticipantesAberto, setPainelParticipantesAberto] = useState(false);
  const [copiado, setCopiado] = useState(false);

  // Estados do Replay Player
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState<number>(1);
  const [replayTimeMs, setReplayTimeMs] = useState<number>(0);
  const [riderFocadoId, setRiderFocadoId] = useState<string | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const spotsLayerRef = useRef<LayerGroup | null>(null);
  const polylinesLayerRef = useRef<LayerGroup | null>(null);
  const markersLayerRef = useRef<LayerGroup | null>(null);
  const tileLayerRef = useRef<unknown>(null);
  const playAnimationRef = useRef<number | null>(null);
  const hasInitiallyFramed = useRef(false);

  const cursorRef = useRef<string | null>(null);

  // 1. Busca inicial e polling incremental
  const carregarDados = useCallback(async () => {
    try {
      const desde = cursorRef.current;
      const qs = desde ? `?desde=${encodeURIComponent(desde)}` : '';
      const res = await fetch(`/api/downwind/${downwindId}/live${qs}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Downwind não encontrado ou indisponível.');
      const data = (await res.json()) as LiveApiResponse;

      cursorRef.current = data.cursor ?? cursorRef.current;

      setDados((anterior) => {
        if (!data.incremental || !anterior) return data;
        const trilhas: LiveApiResponse['trilhas'] = { ...anterior.trilhas };
        for (const [userId, novos] of Object.entries(data.trilhas)) {
          trilhas[userId] = mesclarPontos(trilhas[userId] ?? [], novos, (p) => p[3]);
        }
        return { ...data, trilhas };
      });
      setErro(null);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao conectar.');
    } finally {
      setCarregando(false);
    }
  }, [downwindId]);

  useEffect(() => {
    carregarDados();
    const interval = setInterval(() => {
      if (isLiveMode && !document.hidden) {
        carregarDados();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [carregarDados, isLiveMode]);

  // 2. Limites de tempo
  const { minTsMs, maxTsMs, duracaoTotalMs } = useMemo(() => {
    if (!dados || Object.keys(dados.trilhas).length === 0) {
      return { minTsMs: 0, maxTsMs: 0, duracaoTotalMs: 0 };
    }
    let min = Infinity;
    let max = -Infinity;

    for (const trail of Object.values(dados.trilhas)) {
      for (const p of trail) {
        const ts = p[3];
        if (ts < min) min = ts;
        if (ts > max) max = ts;
      }
    }

    if (min === Infinity) min = 0;
    if (max === -Infinity) max = 0;

    return { minTsMs: min, maxTsMs: max, duracaoTotalMs: Math.max(0, max - min) };
  }, [dados]);

  useAoMudar(
    isLiveMode ? maxTsMs : null,
    () => {
      if (isLiveMode && maxTsMs > 0) setReplayTimeMs(maxTsMs);
    },
    { naMontagem: true }
  );

  // 3. Inicialização do Mapa Leaflet — com garantia de montagem e invalidação de tamanho
  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current || mapInstanceRef.current) return;

    let mounted = true;

    import('leaflet').then((L) => {
      if (!mounted || !mapContainerRef.current || mapInstanceRef.current) return;

      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: true,
      }).setView([-4.5, -37.5], 11);

      mapInstanceRef.current = map;

      // Adiciona controle de zoom no topo esquerdo
      L.control.zoom({ position: 'topleft' }).addTo(map);

      // Camada de Tiles inicial
      const tileConfig = MAP_TILES[mapLayer];
      const tile = L.tileLayer(tileConfig.url, {
        attribution: tileConfig.attribution,
        maxNativeZoom: tileConfig.maxNativeZoom ?? 19,
        maxZoom: 20,
        subdomains: tileConfig.subdomains ?? 'abcd',
      }).addTo(map);
      tileLayerRef.current = tile;

      // Grupos de camadas
      spotsLayerRef.current = L.layerGroup().addTo(map);
      polylinesLayerRef.current = L.layerGroup().addTo(map);
      markersLayerRef.current = L.layerGroup().addTo(map);

      // Invalidação periódica para garantir cobertura total da tela
      const remedir = () => {
        if (mounted && mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize({ animate: false });
        }
      };

      const ro = new ResizeObserver(remedir);
      ro.observe(mapContainerRef.current);

      [50, 150, 350, 800, 1500].forEach((ms) => setTimeout(remedir, ms));
      window.addEventListener('resize', remedir);
    });

    return () => {
      mounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 4. Troca dinâmica da camada de Tiles
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    import('leaflet').then((L) => {
      const map = mapInstanceRef.current;
      if (!map) return;

      if (tileLayerRef.current) {
        map.removeLayer(tileLayerRef.current as L.Layer);
      }

      const tileConfig = MAP_TILES[mapLayer];
      const tile = L.tileLayer(tileConfig.url, {
        attribution: tileConfig.attribution,
        maxNativeZoom: tileConfig.maxNativeZoom ?? 19,
        maxZoom: 20,
        subdomains: tileConfig.subdomains ?? 'abcd',
      }).addTo(map);
      tileLayerRef.current = tile;
    });
  }, [mapLayer]);

  // 5. Calcula posições e trilhas ativas no tempo atual do Replay
  const estadoNoTempo = useMemo(() => {
    if (!dados) return { posicoesAtuais: {}, trilhasVisiveis: {} };

    const posicoesAtuais: Record<
      string,
      { lat: number; lng: number; speedKnots: number; heading: number | null }
    > = {};
    const trilhasVisiveis: Record<string, [number, number][]> = {};

    const tempoCorte = isLiveMode ? maxTsMs : replayTimeMs;

    for (const [userId, trail] of Object.entries(dados.trilhas)) {
      if (trail.length === 0) continue;

      const pontosFiltrados = tempoCorte > 0 ? trail.filter((p) => p[3] <= tempoCorte) : trail;
      trilhasVisiveis[userId] = pontosFiltrados.map((p) => [p[0], p[1]]);

      if (pontosFiltrados.length > 0) {
        const ult = pontosFiltrados[pontosFiltrados.length - 1];
        posicoesAtuais[userId] = {
          lat: ult[0],
          lng: ult[1],
          speedKnots: ult[2],
          heading: null,
        };
      }
    }

    return { posicoesAtuais, trilhasVisiveis };
  }, [dados, isLiveMode, maxTsMs, replayTimeMs]);

  // 6. Desenha Spots (A e B)
  useEffect(() => {
    if (!dados || !mapInstanceRef.current || !spotsLayerRef.current) return;

    import('leaflet').then((L) => {
      const group = spotsLayerRef.current;
      if (!group) return;
      group.clearLayers();

      if (dados.downwind.origemLat && dados.downwind.origemLng) {
        const iconA = L.divIcon({
          className: 'spot-icon-a',
          html: `<div class="flex items-center gap-1 px-2.5 py-1 rounded-full bg-cyan-500 text-slate-950 font-black text-[11px] shadow-xl border border-cyan-200"><span class="w-2 h-2 rounded-full bg-white animate-ping"></span><span>🚩 ${dados.downwind.origemSpotNome || 'Saída'}</span></div>`,
          iconSize: [130, 30],
          iconAnchor: [65, 15],
        });
        L.marker([dados.downwind.origemLat, dados.downwind.origemLng], { icon: iconA }).addTo(group);
      }

      if (dados.downwind.destinoLat && dados.downwind.destinoLng) {
        const iconB = L.divIcon({
          className: 'spot-icon-b',
          html: `<div class="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500 text-slate-950 font-black text-[11px] shadow-xl border border-emerald-200"><span>🏁 ${dados.downwind.destinoSpotNome || 'Chegada'}</span></div>`,
          iconSize: [130, 30],
          iconAnchor: [65, 15],
        });
        L.marker([dados.downwind.destinoLat, dados.downwind.destinoLng], { icon: iconB }).addTo(group);
      }
    });
  }, [dados]);

  // 7. Desenha Polilinhas e Marcadores dos Velejadores
  useEffect(() => {
    if (!dados || !mapInstanceRef.current || !polylinesLayerRef.current || !markersLayerRef.current) return;

    import('leaflet').then((L) => {
      const polyGroup = polylinesLayerRef.current;
      const markerGroup = markersLayerRef.current;
      const map = mapInstanceRef.current;
      if (!polyGroup || !markerGroup || !map) return;

      polyGroup.clearLayers();
      markerGroup.clearLayers();

      const bounds = L.latLngBounds([]);

      // Inclui spots nos limites
      if (dados.downwind.origemLat && dados.downwind.origemLng) {
        bounds.extend([dados.downwind.origemLat, dados.downwind.origemLng]);
      }
      if (dados.downwind.destinoLat && dados.downwind.destinoLng) {
        bounds.extend([dados.downwind.destinoLat, dados.downwind.destinoLng]);
      }

      // Desenha trilhas e marcadores
      for (const p of dados.participantes) {
        const pts = estadoNoTempo.trilhasVisiveis[p.userId] || [];
        if (pts.length > 1) {
          pts.forEach((pt) => bounds.extend(pt));

          // Linha de contorno / sombra
          L.polyline(pts, {
            color: '#000000',
            weight: 6,
            opacity: 0.45,
            lineCap: 'round',
            lineJoin: 'round',
          }).addTo(polyGroup);

          // Linha colorida neon
          L.polyline(pts, {
            color: p.corHex,
            weight: 3.5,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round',
          }).addTo(polyGroup);
        }

        // Posição do participante no tempo atual
        const pos = estadoNoTempo.posicoesAtuais[p.userId] || p.ultimaPosicao;
        if (pos) {
          bounds.extend([pos.lat, pos.lng]);

          const speedVal = pos.speedKnots ?? 0;
          const avatarHtml = p.avatarUrl
            ? `<img src="${p.avatarUrl}" class="w-full h-full object-cover rounded-full" alt="${p.name}" />`
            : `<span class="text-[10px] font-black text-white">${p.name.slice(0, 2).toUpperCase()}</span>`;

          const riderIcon = L.divIcon({
            className: 'rider-live-marker',
            html: `
              <div style="display: flex; flex-direction: column; align-items: center; cursor: pointer;">
                <div style="width: 34px; height: 34px; border-radius: 9999px; border: 2.5px solid ${p.corHex}; background-color: #0b1220; display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.6);">
                  ${avatarHtml}
                </div>
                <div style="margin-top: 2px; padding: 1px 6px; background-color: rgba(11,18,32,0.95); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; font-size: 9px; font-family: monospace; font-weight: 800; color: #ffffff; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.5);">
                  ${speedVal.toFixed(1)} kt
                </div>
              </div>
            `,
            iconSize: [36, 54],
            iconAnchor: [18, 27],
          });

          const marker = L.marker([pos.lat, pos.lng], { icon: riderIcon });
          marker.bindPopup(`
            <div style="font-family: inherit; padding: 4px;">
              <p style="font-weight: 900; font-size: 13px; margin: 0 0 4px 0; color: #ffffff;">${p.name}</p>
              <p style="font-size: 11px; margin: 0; color: #94a3b8;">Velocidade: <b style="color: #38bdf8;">${speedVal.toFixed(1)} nós</b></p>
              <p style="font-size: 11px; margin: 0; color: #94a3b8;">Distância: <b style="color: #34d399;">${p.distanciaKm.toFixed(1)} km</b></p>
            </div>
          `);
          marker.addTo(markerGroup);
        }
      }

      // Enquadra o mapa se ainda não foi ajustado ou se houve mudança inicial
      if (!hasInitiallyFramed.current && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
        hasInitiallyFramed.current = true;
      } else if (!hasInitiallyFramed.current && dados.downwind.origemLat && dados.downwind.origemLng) {
        map.setView([dados.downwind.origemLat, dados.downwind.origemLng], 12);
        hasInitiallyFramed.current = true;
      }
    });
  }, [dados, estadoNoTempo]);

  // 8. Loop de Animação do Replay (Play/Pause/Speed)
  useEffect(() => {
    if (!isPlaying || isLiveMode) {
      if (playAnimationRef.current) cancelAnimationFrame(playAnimationRef.current);
      return;
    }

    let lastTime = performance.now();

    const frame = (now: number) => {
      const deltaSec = (now - lastTime) / 1000;
      lastTime = now;

      const incrementoMs = deltaSec * 1000 * replaySpeed * 2;

      setReplayTimeMs((prev) => {
        const next = prev + incrementoMs;
        if (next >= maxTsMs) {
          setIsPlaying(false);
          return maxTsMs;
        }
        return next;
      });

      playAnimationRef.current = requestAnimationFrame(frame);
    };

    playAnimationRef.current = requestAnimationFrame(frame);

    return () => {
      if (playAnimationRef.current) cancelAnimationFrame(playAnimationRef.current);
    };
  }, [isPlaying, isLiveMode, replaySpeed, maxTsMs]);

  const handleTogglePlay = () => {
    if (isLiveMode) {
      setIsLiveMode(false);
      setIsPlaying(true);
    } else {
      if (replayTimeMs >= maxTsMs && minTsMs > 0) {
        setReplayTimeMs(minTsMs);
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleIrParaAoVivo = () => {
    setIsPlaying(false);
    setIsLiveMode(true);
    setReplayTimeMs(maxTsMs);
  };

  const handleCompartilhar = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const shareData = {
      title: `${dados?.downwind.nome || 'Downwind'} Ao Vivo • KiteNinja`,
      text: `Acompanhe a travessia de kitesurf ao vivo pelo KiteNinja!`,
      url,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {}
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    }
  };

  const formatarHoraReplay = (tsMs: number) => {
    if (!tsMs || tsMs <= 0) return '00:00:00';
    const d = new Date(tsMs);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const temTrilha = dados && Object.keys(dados.trilhas).length > 0;
  const status = dados?.downwind.status ?? 'planejado';

  return (
    <div className="relative w-full h-full flex flex-col bg-[#070D18] overflow-hidden select-none">
      {/* 1. HUD Superior Flutuante */}
      {dados && (
        <header className="absolute top-3 inset-x-3 z-[1000] pointer-events-none flex items-start justify-between gap-2">
          <div className="pointer-events-auto bg-[#0B1220]/92 backdrop-blur-md border border-slate-800/80 rounded-2xl p-3 shadow-2xl shadow-black/80 max-w-sm">
            <div className="flex items-center gap-2 mb-1.5">
              <button
                type="button"
                onClick={() => (window.location.href = '/')}
                className="p-1 -ml-1 rounded-lg text-slate-400 hover:text-white transition-colors"
                title="Voltar ao app"
              >
                <ChevronLeft size={18} />
              </button>

              {status === 'em_andamento' ? (
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-400 text-[10px] font-black tracking-wide uppercase">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  AO VIVO
                </span>
              ) : status === 'encerrado' ? (
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[10px] font-black tracking-wide uppercase">
                  <Trophy size={11} className="text-amber-400" />
                  REPLAY HISTÓRICO
                </span>
              ) : (
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-black tracking-wide uppercase">
                  <Radio size={11} />
                  AGENDADO
                </span>
              )}

              {temTrilha && (
                <span className="text-[11px] text-slate-400 font-mono">
                  {formatarHoraReplay(isLiveMode ? maxTsMs : replayTimeMs)}
                </span>
              )}
            </div>

            <h1 className="text-sm font-black text-white leading-tight truncate">{dados.downwind.nome}</h1>

            <div className="flex items-center gap-2 text-[11px] text-slate-300 mt-1">
              <span className="font-semibold">{dados.downwind.origemSpotNome || 'Saída'}</span>
              <ArrowRight size={12} className="text-cyan-400 shrink-0" />
              <span className="font-semibold">{dados.downwind.destinoSpotNome || 'Chegada'}</span>
            </div>
          </div>

          <div className="pointer-events-auto flex items-center gap-1.5 bg-[#0B1220]/92 backdrop-blur-md border border-slate-800/80 rounded-2xl p-1.5 shadow-2xl shadow-black/80">
            <button
              type="button"
              onClick={() => setMapLayer(mapLayer === 'escuro' ? 'satelite' : 'escuro')}
              className={`p-2 rounded-xl transition-all ${
                mapLayer === 'satelite' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'
              }`}
              title="Alternar satélite / noturno"
              aria-label="Alternar camada de mapa"
            >
              <Layers size={16} />
            </button>

            <button
              type="button"
              onClick={handleCompartilhar}
              className="p-2 rounded-xl text-slate-300 hover:text-white active:scale-95 transition-all"
              title="Compartilhar link ao vivo"
              aria-label="Compartilhar link ao vivo"
            >
              {copiado ? <Check size={16} className="text-emerald-400" /> : <Share2 size={16} />}
            </button>

            {dados.participantes.length > 0 && (
              <button
                type="button"
                onClick={() => setPainelParticipantesAberto(!painelParticipantesAberto)}
                className={`p-2 rounded-xl transition-all flex items-center gap-1 text-xs font-bold ${
                  painelParticipantesAberto ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
                aria-label="Ver velejadores"
              >
                <Users size={16} />
                <span>{dados.participantes.length}</span>
              </button>
            )}
          </div>
        </header>
      )}

      {/* 2. Container do Mapa Leaflet — SEMPRE MONTADO NO DOM */}
      <div ref={mapContainerRef} className="w-full h-full z-0 relative bg-[#070D18]" />

      {/* Overlay de Carregamento */}
      {carregando && (
        <div className="absolute inset-0 z-[2000] flex flex-col items-center justify-center bg-[#070D18]/90 backdrop-blur-sm text-slate-300 gap-3">
          <Loader2 size={36} className="text-cyan-400 animate-spin" />
          <p className="text-xs font-bold text-slate-400">Carregando mapa e telemetria ao vivo...</p>
        </div>
      )}

      {/* Overlay de Erro */}
      {!carregando && (erro || !dados) && (
        <div className="absolute inset-0 z-[2000] flex flex-col items-center justify-center bg-[#070D18]/95 p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mb-3">
            <Radio size={24} />
          </div>
          <h3 className="text-base font-black text-white mb-1">Travessia não encontrada</h3>
          <p className="text-xs text-slate-400 max-w-sm mb-4">{erro || 'Este evento não possui dados de rastreamento.'}</p>
          <button
            type="button"
            onClick={() => (window.location.href = '/')}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-all"
          >
            Voltar para o KiteNinja
          </button>
        </div>
      )}

      {/* 3. Painel Lateral de Velejadores (Leaderboard) */}
      {dados && painelParticipantesAberto && dados.participantes.length > 0 && (
        <aside className="absolute right-3 top-20 bottom-28 z-[1000] w-72 bg-[#0B1220]/95 backdrop-blur-xl border border-slate-800 rounded-3xl p-3 shadow-2xl shadow-black/90 flex flex-col animate-in slide-in-from-right-4 duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
            <h3 className="text-xs font-black text-white flex items-center gap-1.5">
              <Users size={14} className="text-cyan-400" />
              <span>Velejadores ({dados.participantes.length})</span>
            </h3>
            <button
              type="button"
              onClick={() => setPainelParticipantesAberto(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {dados.participantes.map((p) => {
              const pos = estadoNoTempo.posicoesAtuais[p.userId] || p.ultimaPosicao;
              const speedVal = pos?.speedKnots ?? 0;
              return (
                <div
                  key={p.userId}
                  onClick={() => {
                    setRiderFocadoId(p.userId);
                    if (pos && mapInstanceRef.current) {
                      mapInstanceRef.current.flyTo([pos.lat, pos.lng], 15);
                    }
                  }}
                  className={`p-2.5 rounded-2xl border transition-all cursor-pointer ${
                    riderFocadoId === p.userId
                      ? 'bg-cyan-500/15 border-cyan-400/50'
                      : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-8 h-8 rounded-full border-2 overflow-hidden flex items-center justify-center bg-slate-800 shrink-0"
                      style={{ borderColor: p.corHex }}
                    >
                      {p.avatarUrl ? (
                        <img src={p.avatarUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] font-black text-white">{p.name.slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white truncate leading-tight">{p.name}</p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 font-mono">
                        <span>{pos ? `${speedVal.toFixed(1)} nós` : '0 nós'}</span>
                        <span>•</span>
                        <span>{p.distanciaKm ? `${p.distanciaKm.toFixed(1)} km` : '0 km'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* 4. Player de Replay e Linha do Tempo (Barra Inferior) */}
      {dados && (
        temTrilha ? (
          <footer className="absolute bottom-3 inset-x-3 z-[1000] pointer-events-none flex justify-center">
            <div className="pointer-events-auto w-full max-w-xl bg-[#0B1220]/95 backdrop-blur-xl border border-slate-800/90 rounded-3xl p-3 shadow-2xl shadow-black/90 flex flex-col gap-2 ring-1 ring-white/10">
              {/* Barra de Linha do Tempo (Scrubber) */}
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-slate-400 w-12 text-left">
                  {formatarHoraReplay(isLiveMode ? maxTsMs : replayTimeMs)}
                </span>

                <div className="flex-1 relative flex items-center">
                  <input
                    type="range"
                    min={minTsMs}
                    max={maxTsMs}
                    value={isLiveMode ? maxTsMs : replayTimeMs}
                    onChange={(e) => {
                      setIsLiveMode(false);
                      setReplayTimeMs(Number(e.target.value));
                    }}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>

                <span className="text-[10px] font-mono text-slate-400 w-12 text-right">
                  {formatarHoraReplay(maxTsMs)}
                </span>
              </div>

              {/* Controles de Reprodução */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleTogglePlay}
                    className="w-9 h-9 rounded-2xl bg-gradient-to-r from-cyan-400 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-slate-950 flex items-center justify-center font-bold shadow-lg shadow-cyan-500/20 active:scale-95 transition-all"
                    aria-label={isPlaying ? 'Pausar replay' : 'Reproduzir replay'}
                  >
                    {isPlaying ? <Pause size={16} /> : <Play size={16} className="translate-x-0.5 fill-current" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const speeds = [1, 2, 5, 10, 20];
                      const nextIdx = (speeds.indexOf(replaySpeed) + 1) % speeds.length;
                      setReplaySpeed(speeds[nextIdx]);
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-mono font-bold active:scale-95 transition-all"
                    title="Velocidade do replay"
                  >
                    {replaySpeed}x
                  </button>
                </div>

                {/* Botão para sincronizar com o Ao Vivo */}
                <button
                  type="button"
                  onClick={handleIrParaAoVivo}
                  className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95 ${
                    isLiveMode
                      ? 'bg-rose-500/20 border border-rose-500/40 text-rose-300 shadow-md shadow-rose-500/20'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                  }`}
                >
                  <Radio size={13} className={isLiveMode ? 'text-rose-400 animate-pulse' : ''} />
                  <span>{isLiveMode ? 'Ao Vivo Conectado' : 'Ir para Ao Vivo'}</span>
                </button>
              </div>
            </div>
          </footer>
        ) : (
          <footer className="absolute bottom-4 inset-x-4 z-[1000] pointer-events-none flex justify-center">
            <div className="pointer-events-auto px-4 py-2.5 rounded-2xl bg-[#0B1220]/90 backdrop-blur-md border border-slate-800/80 text-xs text-slate-300 flex items-center gap-2 shadow-xl">
              <Radio size={14} className="text-cyan-400 animate-pulse" />
              <span>Aguardando velejadores entrarem na água para exibir telemetria ao vivo.</span>
            </div>
          </footer>
        )
      )}
    </div>
  );
};