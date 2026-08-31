'use client';

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Play,
  Pause,
  RotateCcw,
  FastForward,
  Radio,
  Share2,
  Users,
  Compass,
  Zap,
  Flag,
  Battery,
  MapPin,
  Maximize2,
  Minimize2,
  ChevronUp,
  ChevronDown,
  Layers,
  ArrowRight,
  Loader2,
  Check,
} from 'lucide-react';
import type { Map as LeafletMap } from 'leaflet';
import { mesclarPontos } from '@/lib/trilhaDownwind';
import { useAoMudar } from '@/lib/useAoMudar';

interface PontoTrilhaLive {
  0: number; // lat
  1: number; // lng
  2: number; // speedKnots
  3: number; // tsMs
}

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
  /** Devolver em `?desde=` no próximo poll. Ver lib/trilhaDownwind.ts. */
  cursor: string | null;
  /** `true` = a resposta traz só o que é novo; MESCLAR, nunca substituir. */
  incremental: boolean;
  /** `true` = o servidor bateu no teto e ainda há pontos por entregar. */
  parcial: boolean;
}

export const DownwindLiveReplayViewer: React.FC<{
  downwindId: string;
  modoEmbutido?: boolean;
}> = ({ downwindId, modoEmbutido = false }) => {
  const [dados, setDados] = useState<LiveApiResponse | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mapLayer, setMapLayer] = useState<'dark' | 'satellite'>('dark');
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
  const markersRef = useRef<Record<string, unknown>>({});
  const polylineLayerRef = useRef<unknown>(null);
  const playAnimationRef = useRef<number | null>(null);

  /*
   * Cursor do rastro já recebido. Em ref, não em state, de propósito: mudá-lo
   * não deve re-renderizar nem recriar `carregarDados` (o que reiniciaria o
   * intervalo de poll a cada resposta).
   */
  const cursorRef = useRef<string | null>(null);

  // 1. Busca inicial e polling incremental
  const carregarDados = useCallback(async () => {
    try {
      // Primeira chamada sem `desde`: traz a trilha inteira já amostrada pelo
      // servidor. Das seguintes em diante vai só o delta — antes, cada poll de
      // 5s rebaixava o histórico completo da travessia (ver
      // docs/VARREDURA-2026-08-31.md, V-03).
      const desde = cursorRef.current;
      const qs = desde ? `?desde=${encodeURIComponent(desde)}` : '';
      const res = await fetch(`/api/downwind/${downwindId}/live${qs}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Downwind não encontrado ou indisponível.');
      const data = (await res.json()) as LiveApiResponse;

      cursorRef.current = data.cursor ?? cursorRef.current;

      setDados((anterior) => {
        // Carga inicial (ou primeira resposta): substitui.
        if (!data.incremental || !anterior) return data;
        // Delta: mescla trilha a trilha. `mesclarPontos` deduplica por
        // timestamp e descarta os pontos MAIS ANTIGOS ao estourar o teto.
        const trilhas: LiveApiResponse['trilhas'] = { ...anterior.trilhas };
        for (const [userId, novos] of Object.entries(data.trilhas)) {
          trilhas[userId] = mesclarPontos(trilhas[userId] ?? [], novos, (p) => p[3]);
        }
        // Cabeçalho e participantes vêm completos em toda resposta — só a
        // trilha é incremental.
        return { ...data, trilhas };
      });
      setErro(null);

      /*
       * `data.parcial` = o servidor bateu no teto e ainda há rastro por
       * entregar. Não há tratamento especial de propósito: o cursor não
       * saltou (ver proximoCursor em lib/trilhaDownwind.ts), então o próximo
       * poll continua exatamente de onde parou, sem buraco na trilha.
       *
       * Chegou a existir aqui um reagendamento imediato para fechar o vão em
       * 300ms. Foi removido: `parcial` só acontece quando um delta passa de
       * 60 pontos por participante — ou seja, quando a aba ficou muito tempo
       * fechada — e resolver isso exigia guardar a própria função num ref,
       * que a regra react-hooks/refs do React 19 acusa com razão. Trocar 5s
       * de atraso num caso raro por um padrão frágil não valia.
       */
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao conectar.');
    } finally {
      setCarregando(false);
    }
  }, [downwindId]);

  useEffect(() => {
    carregarDados();
    // Se o downwind estiver em andamento, faz polling a cada 5 segundos
    const interval = setInterval(() => {
      if (isLiveMode && !document.hidden) {
        carregarDados();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [carregarDados, isLiveMode]);

  // 2. Calcula limites de tempo da travessia
  const { minTsMs, maxTsMs, duracaoTotalMs } = useMemo(() => {
    // Sem trilha nenhuma, o limite é 0 — sentinela de "não há tempo a
    // mostrar". Antes isto devolvia `Date.now()`, o que é uma leitura de
    // relógio DURANTE O RENDER: o React 19 acusa como impureza (dois renders
    // do mesmo estado davam valores diferentes) e o efeito colateral visível
    // era a barra de tempo exibindo a hora atual num replay vazio.
    // `formatarHoraReplay` já trata 0 e mostra 00:00:00.
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

  // Mantém o replayTimeMs colado no fim da trilha enquanto está ao vivo, para
  // que sair do modo Live já caia no instante mais recente e não no começo da
  // travessia. Ajuste síncrono de estado: pertence ao render, não a um efeito
  // (em efeito, o slider aparecia por um quadro na posição antiga).
  useAoMudar(
    isLiveMode ? maxTsMs : null,
    () => {
      if (isLiveMode && maxTsMs > 0) setReplayTimeMs(maxTsMs);
    },
    { naMontagem: true }
  );

  // 3. Inicialização do Mapa Leaflet
  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current || mapInstanceRef.current) return;

    import('leaflet').then((L) => {
      if (!mapContainerRef.current) return;

      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false,
      }).setView([-3.7319, -38.5267], 12);

      mapInstanceRef.current = map;

      // Adiciona controle de zoom no topo esquerdo
      L.control.zoom({ position: 'topleft' }).addTo(map);

      // Camada de mapa
      const tileUrl =
        mapLayer === 'satellite'
          ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

      L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 4. Atualiza camada de mapa quando altera dark/satellite
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    import('leaflet').then((L) => {
      const map = mapInstanceRef.current;
      if (!map) return;

      map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) {
          map.removeLayer(layer);
        }
      });

      const tileUrl =
        mapLayer === 'satellite'
          ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

      L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);
    });
  }, [mapLayer]);

  // 5. Calcula posições e trilhas ativas no tempo atual do Replay
  const estadoNoTempo = useMemo(() => {
    if (!dados) return { posicoesAtuais: {}, trilhasVisiveis: {} };

    const posicoesAtuais: Record<
      string,
      { lat: number; lng: number; speed: number; heading: number | null }
    > = {};
    const trilhasVisiveis: Record<string, [number, number][]> = {};

    const tempoCorte = isLiveMode ? maxTsMs : replayTimeMs;

    for (const [userId, trail] of Object.entries(dados.trilhas)) {
      if (trail.length === 0) continue;

      const pontosFiltrados = trail.filter((p) => p[3] <= tempoCorte);
      trilhasVisiveis[userId] = pontosFiltrados.map((p) => [p[0], p[1]]);

      if (pontosFiltrados.length > 0) {
        const ult = pontosFiltrados[pontosFiltrados.length - 1];
        posicoesAtuais[userId] = {
          lat: ult[0],
          lng: ult[1],
          speed: ult[2],
          heading: null,
        };
      }
    }

    return { posicoesAtuais, trilhasVisiveis };
  }, [dados, isLiveMode, maxTsMs, replayTimeMs]);

  // 6. Desenha Marcadores e Polilinhas no Mapa
  useEffect(() => {
    if (!dados || !mapInstanceRef.current) return;

    import('leaflet').then((L) => {
      const map = mapInstanceRef.current;
      if (!map) return;

      // Desenha Spots de Origem e Destino
      const bounds = L.latLngBounds([]);

      if (dados.downwind.origemLat && dados.downwind.origemLng) {
        const origemLatLng: [number, number] = [dados.downwind.origemLat, dados.downwind.origemLng];
        bounds.extend(origemLatLng);
      }
      if (dados.downwind.destinoLat && dados.downwind.destinoLng) {
        const destinoLatLng: [number, number] = [dados.downwind.destinoLat, dados.downwind.destinoLng];
        bounds.extend(destinoLatLng);
      }

      // Desenha Polilinhas dos Velejadores
      for (const p of dados.participantes) {
        const pts = estadoNoTempo.trilhasVisiveis[p.userId];
        if (pts && pts.length > 1) {
          pts.forEach((pt) => bounds.extend(pt));
        }
      }

      // Se for a primeira carga com limites válidos, ajusta o zoom
      if (bounds.isValid() && !map.getBounds().isValid()) {
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    });
  }, [dados, estadoNoTempo]);

  // 7. Loop de Animação do Replay (Play/Pause/Speed)
  useEffect(() => {
    if (!isPlaying || isLiveMode) {
      if (playAnimationRef.current) cancelAnimationFrame(playAnimationRef.current);
      return;
    }

    let lastTime = performance.now();

    const frame = (now: number) => {
      const deltaSec = (now - lastTime) / 1000;
      lastTime = now;

      // Avança no tempo de acordo com a velocidade multiplicadora (ex: 5x, 10x)
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
      if (replayTimeMs >= maxTsMs) {
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
    if (!tsMs) return '00:00:00';
    const d = new Date(tsMs);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  if (carregando) {
    return (
      <div className="h-full w-full min-h-[400px] flex flex-col items-center justify-center bg-[#070D18] text-slate-300 gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-slate-700 border-t-cyan-400 animate-spin" />
        <p className="text-xs font-bold text-slate-400">Carregando mapa e telemetria ao vivo...</p>
      </div>
    );
  }

  if (erro || !dados) {
    return (
      <div className="h-full w-full min-h-[400px] flex flex-col items-center justify-center bg-[#070D18] text-slate-300 p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mb-3">
          <Radio size={24} />
        </div>
        <h3 className="text-base font-black text-white mb-1">Travessia não encontrada</h3>
        <p className="text-xs text-slate-400 max-w-sm mb-4">{erro || 'Este downwind não possui posições gravadas.'}</p>
      </div>
    );
  }

  const progressoPercent =
    duracaoTotalMs > 0 ? Math.min(100, Math.max(0, ((replayTimeMs - minTsMs) / duracaoTotalMs) * 100)) : 100;

  return (
    <div className="relative w-full h-full flex flex-col bg-[#070D18] overflow-hidden select-none">
      {/* 1. HUD Superior Flutuante */}
      <header className="absolute top-3 inset-x-3 z-[1000] pointer-events-none flex items-start justify-between gap-2">
        <div className="pointer-events-auto bg-[#0B1220]/90 backdrop-blur-md border border-slate-800/80 rounded-2xl p-3 shadow-2xl shadow-black/80 max-w-sm">
          <div className="flex items-center gap-2 mb-1">
            {isLiveMode ? (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-400 text-[10px] font-black tracking-wide uppercase">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                AO VIVO
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[10px] font-black tracking-wide uppercase">
                <RotateCcw size={11} />
                REPLAY
              </span>
            )}
            <span className="text-[11px] text-slate-400 font-mono">
              {formatarHoraReplay(isLiveMode ? maxTsMs : replayTimeMs)}
            </span>
          </div>

          <h1 className="text-sm font-black text-white leading-tight truncate">{dados.downwind.nome}</h1>

          <div className="flex items-center gap-2 text-[11px] text-slate-300 mt-1">
            <span className="font-semibold">{dados.downwind.origemSpotNome || 'Saída'}</span>
            <ArrowRight size={12} className="text-cyan-400 shrink-0" />
            <span className="font-semibold">{dados.downwind.destinoSpotNome || 'Chegada'}</span>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-1.5 bg-[#0B1220]/90 backdrop-blur-md border border-slate-800/80 rounded-2xl p-1.5 shadow-2xl shadow-black/80">
          <button
            type="button"
            onClick={() => setMapLayer(mapLayer === 'dark' ? 'satellite' : 'dark')}
            className={`p-2 rounded-xl transition-all ${
              mapLayer === 'satellite' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'
            }`}
            title="Alternar camada satélite/mapa"
            aria-label="Alternar camada de mapa"
          >
            <Layers size={16} />
          </button>

          <button
            type="button"
            onClick={handleCompartilhar}
            className="p-2 rounded-xl text-slate-300 hover:text-white active:scale-95 transition-all"
            title="Compartilhar travessia ao vivo"
            aria-label="Compartilhar link ao vivo"
          >
            {copiado ? <Check size={16} className="text-emerald-400" /> : <Share2 size={16} />}
          </button>

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
        </div>
      </header>

      {/* 2. Container do Mapa Leaflet */}
      <div ref={mapContainerRef} className="flex-1 w-full h-full z-0" />

      {/* 3. Painel Lateral de Velejadores (Leaderboard) */}
      {painelParticipantesAberto && (
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
                        <span>{pos ? `${pos.speed.toFixed(1)} nós` : '0 nós'}</span>
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
    </div>
  );
};