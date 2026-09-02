'use client';

import 'leaflet/dist/leaflet.css';
import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  Play,
  Pause,
  Radio,
  Share2,
  Users,
  ChevronLeft,
  Layers,
  ArrowRight,
  Loader2,
  Check,
  Trophy,
  Navigation,
  Gauge,
  Clock,
  X,
  Crosshair,
} from 'lucide-react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import { useRouter } from 'next/navigation';
import { mesclarPontos } from '@/lib/trilhaDownwind';
import { useAoMudar } from '@/lib/useAoMudar';
import { opcoesDeTile } from '@/lib/mapTiles';
import { escaparHtml, iniciaisDoNome } from '@/lib/htmlEscape';
import { metricasDaTrilhaReplay } from '@/lib/metricasReplay';

function formatarUltimaAtualizacao(registradoEm: string | null | undefined, tsMs?: number): { hora: string; relativo: string } {
  const ts = tsMs && tsMs > 0 ? tsMs : (registradoEm ? new Date(registradoEm).getTime() : 0);
  if (!ts || isNaN(ts)) {
    return { hora: 'Sem registro', relativo: 'Aguardando sinal' };
  }
  const date = new Date(ts);
  const hora = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  
  let relativo = '';
  if (diffSec < 15) {
    relativo = 'agora mesmo';
  } else if (diffSec < 60) {
    relativo = `há ${diffSec}s atrás`;
  } else if (diffSec < 3600) {
    const min = Math.floor(diffSec / 60);
    relativo = `há ${min} min atrás`;
  } else if (diffSec < 86400) {
    const horas = Math.floor(diffSec / 3600);
    relativo = `há ${horas}h atrás`;
  } else {
    relativo = date.toLocaleDateString('pt-BR');
  }

  return { hora, relativo };
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
  cursor: string | null;
  incremental: boolean;
  parcial: boolean;
}

export const DownwindLiveReplayViewer: React.FC<{
  downwindId: string;
  modoEmbutido?: boolean;
}> = ({ downwindId }) => {
  const router = useRouter();
  const [dados, setDados] = useState<LiveApiResponse | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mapLayer, setMapLayer] = useState<'escuro' | 'satelite'>('escuro');
  const [painelParticipantesAberto, setPainelParticipantesAberto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [mapPronto, setMapPronto] = useState(false);

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
  const { minTsMs, maxTsMs } = useMemo(() => {
    if (!dados || Object.keys(dados.trilhas).length === 0) {
      return { minTsMs: 0, maxTsMs: 0 };
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

    return { minTsMs: min, maxTsMs: max };
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
    let resizeObserver: ResizeObserver | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const remedir = () => {
      if (mounted && mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize({ animate: false });
      }
    };

    import('leaflet').then((L) => {
      if (!mounted || !mapContainerRef.current || mapInstanceRef.current) return;

      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: true,
      }).setView([-4.5, -37.5], 11);

      mapInstanceRef.current = map;

      // O mapa ocupa a tela toda; tocar na área livre fecha somente o detalhe
      // flutuante do rider, sem desmontar o replay nem alterar o painel.
      map.on('click', () => setRiderFocadoId(null));

      // Adiciona controle de zoom; o CSS do viewer o posiciona abaixo do HUD.
      L.control.zoom({ position: 'topleft' }).addTo(map);

      // Grupos de camadas. A camada de tiles entra no efeito seguinte depois
      // de `mapPronto`: assim não capturamos `mapLayer` antigo nesta montagem
      // assíncrona e uma troca rápida de estilo não é sobrescrita.
      spotsLayerRef.current = L.layerGroup().addTo(map);
      polylinesLayerRef.current = L.layerGroup().addTo(map);
      markersLayerRef.current = L.layerGroup().addTo(map);

      resizeObserver = new ResizeObserver(remedir);
      resizeObserver.observe(mapContainerRef.current);

      for (const ms of [50, 150, 350, 800, 1500]) {
        timers.push(setTimeout(remedir, ms));
      }
      window.addEventListener('resize', remedir);

      // Dados e Leaflet chegam de forma assíncrona. Este estado força os efeitos
      // de spots/trilhas a rodarem mesmo quando a API respondeu antes do mapa.
      setMapPronto(true);
    });

    return () => {
      mounted = false;
      resizeObserver?.disconnect();
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', remedir);
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

      /*
       * ESTE ERA O MAPA CINZA.
       *
       * A montagem à mão passava `subdomains: tileConfig.subdomains` com o
       * campo opcional — ou seja, `undefined`. O `setOptions` do Leaflet copia
       * a chave mesmo assim (`for (var i in options)`), sobrescrevendo o
       * padrão 'abc' da biblioteca; aí `_getSubdomain` faz `.length` de
       * undefined e estoura em CADA tile. Resultado: fundo cinza, marcadores
       * por cima, nenhuma mensagem de erro na tela.
       */
      const { url, ...opcoes } = opcoesDeTile(mapLayer);
      const tile = L.tileLayer(url, opcoes).addTo(map);
      tileLayerRef.current = tile;
    });
  }, [mapLayer, mapPronto]);

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

      const pontosFiltrados = trail.filter((p) => p[3] <= tempoCorte);
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
          html: `<div class="flex items-center gap-1 px-2.5 py-1 rounded-full bg-cyan-500 text-slate-950 font-black text-[11px] shadow-xl border border-cyan-200"><span class="w-2 h-2 rounded-full bg-white animate-ping"></span><span>🚩 ${escaparHtml(dados.downwind.origemSpotNome || 'Saída')}</span></div>`,
          iconSize: [130, 30],
          iconAnchor: [65, 15],
        });
        L.marker([dados.downwind.origemLat, dados.downwind.origemLng], { icon: iconA }).addTo(group);
      }

      if (dados.downwind.destinoLat && dados.downwind.destinoLng) {
        const iconB = L.divIcon({
          className: 'spot-icon-b',
          html: `<div class="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500 text-slate-950 font-black text-[11px] shadow-xl border border-emerald-200"><span>🏁 ${escaparHtml(dados.downwind.destinoSpotNome || 'Chegada')}</span></div>`,
          iconSize: [130, 30],
          iconAnchor: [65, 15],
        });
        L.marker([dados.downwind.destinoLat, dados.downwind.destinoLng], { icon: iconB }).addTo(group);
      }
    });
  }, [dados, mapPronto]);

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

        // No modo ao vivo, a query dedicada `ultimaPosicao` serve de fallback
        // para quem ainda não tem ponto no lote amostrado. No replay isso seria
        // viajar no tempo: antes da primeira amostra, o avatar aparecia na
        // posição atual. Portanto o fallback é exclusivo do modo ao vivo.
        const pos =
          estadoNoTempo.posicoesAtuais[p.userId] ||
          (isLiveMode ? p.ultimaPosicao : null);
        if (pos) {
          bounds.extend([pos.lat, pos.lng]);

          const speedVal = pos.speedKnots ?? 0;
          const nome = escaparHtml(p.name);
          const avatarHtml = p.avatarUrl
            ? `<img src="${escaparHtml(p.avatarUrl)}" class="w-full h-full object-cover rounded-full" alt="${nome}" />`
            : `<span class="text-[10px] font-black text-white">${iniciaisDoNome(p.name)}</span>`;

          const estaFocado = riderFocadoId === p.userId;

          const riderIcon = L.divIcon({
            className: 'rider-live-marker',
            html: `
              <div style="display: flex; flex-direction: column; align-items: center; cursor: pointer; transform: ${estaFocado ? 'scale(1.2)' : 'scale(1)'}; transition: transform 0.2s ease;">
                <div style="width: 36px; height: 36px; border-radius: 9999px; border: ${estaFocado ? '3px' : '2.5px'} solid ${estaFocado ? '#38bdf8' : p.corHex}; background-color: #0b1220; display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: 0 4px 14px rgba(0,0,0,0.8);">
                  ${avatarHtml}
                </div>
                <div style="margin-top: 2px; padding: 1.5px 6px; background-color: rgba(11,18,32,0.95); border: 1px solid ${estaFocado ? '#38bdf8' : 'rgba(255,255,255,0.2)'}; border-radius: 6px; font-size: 9.5px; font-family: monospace; font-weight: 900; color: #ffffff; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.6);">
                  ${speedVal.toFixed(1)} kt
                </div>
              </div>
            `,
            iconSize: [38, 56],
            iconAnchor: [19, 28],
          });

          const marker = L.marker([pos.lat, pos.lng], { icon: riderIcon });
          marker.on('click', (event) => {
            // Não deixar o mesmo clique subir até o mapa e fechar o card recém-aberto.
            L.DomEvent.stopPropagation(event);
            setPainelParticipantesAberto(false);
            setRiderFocadoId(p.userId);
            map.flyTo([pos.lat, pos.lng], 15, { animate: true, duration: 0.8 });
          });
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
  }, [dados, estadoNoTempo, isLiveMode, mapPronto, riderFocadoId]);

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

  // Participante focado selecionado
  const riderSelecionado = useMemo(() => {
    if (!riderFocadoId || !dados) return null;
    return dados.participantes.find((p) => p.userId === riderFocadoId) || null;
  }, [riderFocadoId, dados]);

  const posicaoRiderSelecionado = useMemo(() => {
    if (!riderSelecionado) return null;
    return (
      estadoNoTempo.posicoesAtuais[riderSelecionado.userId] ||
      (isLiveMode ? riderSelecionado.ultimaPosicao : null)
    );
  }, [estadoNoTempo, isLiveMode, riderSelecionado]);

  const metricasRiderSelecionado = useMemo(() => {
    if (!riderSelecionado) {
      return { distanciaKm: 0, velocidadeMaxNos: 0, ultimoRegistroMs: null };
    }

    const trilha = dados?.trilhas[riderSelecionado.userId] ?? [];
    const tempoCorte = isLiveMode ? Number.POSITIVE_INFINITY : replayTimeMs;
    return metricasDaTrilhaReplay(trilha, tempoCorte);
  }, [dados, isLiveMode, replayTimeMs, riderSelecionado]);

  const infoAtualizacao = useMemo(() => {
    if (!riderSelecionado || !posicaoRiderSelecionado) {
      return { hora: 'Sem posição', relativo: 'Aguardando primeiro sinal' };
    }

    return formatarUltimaAtualizacao(
      riderSelecionado.ultimaPosicao?.registradoEm,
      metricasRiderSelecionado.ultimoRegistroMs ?? undefined,
    );
  }, [metricasRiderSelecionado.ultimoRegistroMs, posicaoRiderSelecionado, riderSelecionado]);

  const distanciaRiderSelecionado = Math.max(
    metricasRiderSelecionado.distanciaKm,
    riderSelecionado?.distanciaKm ?? 0,
  );
  const velocidadeMaxRiderSelecionado = Math.max(
    metricasRiderSelecionado.velocidadeMaxNos,
    riderSelecionado?.velocidadeMaxNos ?? 0,
  );

  return (
    <div
      className={`dw-live-viewer ${temTrilha ? 'dw-live-has-track' : 'dw-live-no-track'} ${painelParticipantesAberto ? 'dw-live-panel-open' : ''} ${riderSelecionado ? 'dw-live-detail-open' : ''} relative w-full h-full flex flex-col bg-[#070D18] overflow-hidden select-none`}
    >
      {/* 1. HUD Superior Flutuante */}
      {dados && (
        <header className="dw-live-header pointer-events-none">
          <div className="dw-live-summary pointer-events-auto min-w-0 bg-[#0B1220]/92 backdrop-blur-md border border-slate-800/80 rounded-2xl p-3 shadow-2xl shadow-black/80">
            <div className="flex items-center gap-2 mb-1.5 min-w-0">
              <button
                type="button"
                onClick={() => router.push('/')}
                className="dw-live-icon-button -ml-1 rounded-xl text-slate-400 hover:text-white transition-colors"
                title="Voltar ao app"
                aria-label="Voltar ao KiteNinja"
              >
                <ChevronLeft size={18} />
              </button>

              {status === 'em_andamento' ? (
                <span className="dw-live-status flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-400 text-[10px] font-black tracking-wide uppercase">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  AO VIVO
                </span>
              ) : status === 'encerrado' ? (
                <span className="dw-live-status flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[10px] font-black tracking-wide uppercase">
                  <Trophy size={11} className="text-amber-400" />
                  REPLAY HISTÓRICO
                </span>
              ) : (
                <span className="dw-live-status flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-black tracking-wide uppercase">
                  <Radio size={11} />
                  AGENDADO
                </span>
              )}

              {temTrilha && (
                <span className="dw-live-current-time text-[11px] text-slate-400 font-mono whitespace-nowrap">
                  {formatarHoraReplay(isLiveMode ? maxTsMs : replayTimeMs)}
                </span>
              )}
            </div>

            <h1 className="text-sm font-black text-white leading-tight truncate">{dados.downwind.nome}</h1>

            <div className="dw-live-route flex items-center gap-2 text-[11px] text-slate-300 mt-1 min-w-0">
              <span className="font-semibold truncate">{dados.downwind.origemSpotNome || 'Saída'}</span>
              <ArrowRight size={12} className="text-cyan-400 shrink-0" />
              <span className="font-semibold truncate">{dados.downwind.destinoSpotNome || 'Chegada'}</span>
            </div>
          </div>

          <div className="dw-live-actions pointer-events-auto flex items-center gap-1 bg-[#0B1220]/92 backdrop-blur-md border border-slate-800/80 rounded-2xl p-1.5 shadow-2xl shadow-black/80">
            <button
              type="button"
              onClick={() => setMapLayer(mapLayer === 'escuro' ? 'satelite' : 'escuro')}
              className={`dw-live-icon-button rounded-xl transition-all ${
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
              className="dw-live-icon-button rounded-xl text-slate-300 hover:text-white active:scale-95 transition-all"
              title="Compartilhar link ao vivo"
              aria-label="Compartilhar link ao vivo"
            >
              {copiado ? <Check size={16} className="text-emerald-400" /> : <Share2 size={16} />}
            </button>

            {dados.participantes.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setRiderFocadoId(null);
                  setPainelParticipantesAberto((aberto) => !aberto);
                }}
                className={`dw-live-icon-button rounded-xl transition-all flex items-center justify-center gap-1 text-xs font-bold ${
                  painelParticipantesAberto ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
                aria-label={painelParticipantesAberto ? 'Fechar velejadores' : 'Ver velejadores'}
                aria-expanded={painelParticipantesAberto}
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
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-all"
          >
            Voltar para o KiteNinja
          </button>
        </div>
      )}

      {/* 3. Painel Lateral de Velejadores (Leaderboard) */}
      {dados && painelParticipantesAberto && dados.participantes.length > 0 && (
        <aside className="dw-live-participants bg-[#0B1220]/95 backdrop-blur-xl border border-slate-800 rounded-3xl p-3 shadow-2xl shadow-black/90 flex flex-col animate-in slide-in-from-right-4 duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
            <h3 className="text-xs font-black text-white flex items-center gap-1.5">
              <Users size={14} className="text-cyan-400" />
              <span>Velejadores ({dados.participantes.length})</span>
            </h3>
            <button
              type="button"
              onClick={() => setPainelParticipantesAberto(false)}
              className="dw-live-icon-button rounded-xl text-slate-400 hover:text-white"
              aria-label="Fechar velejadores"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {dados.participantes.map((p) => {
              const pos = estadoNoTempo.posicoesAtuais[p.userId] || p.ultimaPosicao;
              const speedVal = pos?.speedKnots ?? 0;
              const metricas = metricasDaTrilhaReplay(
                dados.trilhas[p.userId] ?? [],
                isLiveMode ? Number.POSITIVE_INFINITY : replayTimeMs,
              );
              const distanciaKm = Math.max(p.distanciaKm, metricas.distanciaKm);
              return (
                <div
                  key={p.userId}
                  onClick={() => {
                    setPainelParticipantesAberto(false);
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
                        <span>{distanciaKm > 0 ? `${distanciaKm.toFixed(1)} km` : '0 km'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* 4. Detalhes do Velejador ao Clicar no Avatar / Marcador */}
      {riderSelecionado && (
        <section
          className="dw-live-rider-card bg-[#0B1220]/95 backdrop-blur-xl border border-slate-700/80 rounded-3xl p-4 shadow-2xl shadow-black/90 animate-in fade-in slide-in-from-bottom-4 duration-200"
          aria-label={`Detalhes de ${riderSelecionado.name}`}
        >
          <div className="dw-live-rider-head flex items-start justify-between gap-2 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-12 h-12 rounded-full border-2 overflow-hidden flex items-center justify-center bg-slate-800 shrink-0 shadow-lg"
                style={{ borderColor: riderSelecionado.corHex }}
              >
                {riderSelecionado.avatarUrl ? (
                  <img src={riderSelecionado.avatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs font-black text-white">{riderSelecionado.name.slice(0, 2).toUpperCase()}</span>
                )}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black text-white truncate">{riderSelecionado.name}</h3>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 uppercase">
                    {riderSelecionado.papel === 'velejador' ? 'Velejador' : 'Apoio em Terra'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Estado: <span className="text-slate-200 font-semibold uppercase">{riderSelecionado.estado}</span>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setRiderFocadoId(null)}
              className="dw-live-icon-button rounded-xl bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              aria-label="Fechar detalhes"
            >
              <X size={16} />
            </button>
          </div>

          {/* Seção: Última Atualização da Posição */}
          <div className="dw-live-rider-update mt-3 p-2.5 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Clock size={15} className="text-cyan-400 shrink-0" />
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Última atualização</p>
                <p className="font-mono text-white text-xs font-bold">
                  {infoAtualizacao.hora} <span className="text-slate-400 font-normal">({infoAtualizacao.relativo})</span>
                </p>
              </div>
            </div>

            {posicaoRiderSelecionado && (
              <button
                type="button"
                onClick={() => {
                  if (mapInstanceRef.current) {
                    mapInstanceRef.current.flyTo([posicaoRiderSelecionado.lat, posicaoRiderSelecionado.lng], 16, {
                      animate: true,
                      duration: 0.8,
                    });
                  }
                }}
                className="dw-live-touch px-2.5 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-bold text-[11px] flex items-center gap-1 transition-all active:scale-95 shrink-0"
              >
                <Crosshair size={13} />
                <span>Centralizar</span>
              </button>
            )}
          </div>

          {/* Grid de Métricas de Performance */}
          <div className="dw-live-rider-metrics grid grid-cols-3 gap-2 mt-3 text-center">
            <div className="p-2.5 rounded-2xl bg-slate-900/60 border border-slate-800">
              <span className="text-[10px] text-slate-400 font-bold flex items-center justify-center gap-1">
                <Gauge size={12} className="text-cyan-400" /> Atual
              </span>
              <p className="text-sm font-black text-white font-mono mt-0.5">
                {(posicaoRiderSelecionado?.speedKnots ?? 0).toFixed(1)} <span className="text-[10px] font-normal text-slate-400">nós</span>
              </p>
              <p className="text-[9px] text-slate-500 font-mono">
                {((posicaoRiderSelecionado?.speedKnots ?? 0) * 1.852).toFixed(1)} km/h
              </p>
            </div>

            <div className="p-2.5 rounded-2xl bg-slate-900/60 border border-slate-800">
              <span className="text-[10px] text-slate-400 font-bold flex items-center justify-center gap-1">
                <Trophy size={12} className="text-amber-400" /> Máxima
              </span>
              <p className="text-sm font-black text-amber-300 font-mono mt-0.5">
                {velocidadeMaxRiderSelecionado.toFixed(1)} <span className="text-[10px] font-normal text-slate-400">nós</span>
              </p>
              <p className="text-[9px] text-slate-500 font-mono">
                {(velocidadeMaxRiderSelecionado * 1.852).toFixed(1)} km/h
              </p>
            </div>

            <div className="p-2.5 rounded-2xl bg-slate-900/60 border border-slate-800">
              <span className="text-[10px] text-slate-400 font-bold flex items-center justify-center gap-1">
                <Navigation size={12} className="text-emerald-400" /> Distância
              </span>
              <p className="text-sm font-black text-emerald-300 font-mono mt-0.5">
                {distanciaRiderSelecionado.toFixed(1)} <span className="text-[10px] font-normal text-slate-400">km</span>
              </p>
              <p className="text-[9px] text-slate-500 font-mono">
                {(distanciaRiderSelecionado / 1.852).toFixed(1)} NM
              </p>
            </div>
          </div>
        </section>
      )}

      {/* 5. Player de Replay e Linha do Tempo (Barra Inferior).
          O card de detalhes é um estado focal: em telas baixas não existe espaço
          seguro para os dois sem sobreposição. Fechar o card restaura o player. */}
      {dados && !riderSelecionado && (
        temTrilha ? (
          <footer className="dw-live-footer pointer-events-none flex justify-center">
            <div className="dw-live-player pointer-events-auto w-full max-w-xl bg-[#0B1220]/95 backdrop-blur-xl border border-slate-800/90 rounded-3xl p-3 shadow-2xl shadow-black/90 flex flex-col gap-2 ring-1 ring-white/10">
              {/* Barra de Linha do Tempo (Scrubber) */}
              <div className="dw-live-timeline flex items-center gap-3">
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
              <div className="dw-live-controls flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleTogglePlay}
                    className="dw-live-play w-11 h-11 rounded-2xl bg-gradient-to-r from-cyan-400 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-slate-950 flex items-center justify-center font-bold shadow-lg shadow-cyan-500/20 active:scale-95 transition-all"
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
                    className="dw-live-touch px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-mono font-bold active:scale-95 transition-all"
                    title="Velocidade do replay"
                  >
                    {replaySpeed}x
                  </button>
                </div>

                {/* Botão para sincronizar com o Ao Vivo */}
                <button
                  type="button"
                  onClick={handleIrParaAoVivo}
                  className={`dw-live-live-button dw-live-touch px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95 ${
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
          <footer className="dw-live-footer dw-live-waiting pointer-events-none flex justify-center">
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