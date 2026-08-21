'use client';

import 'leaflet/dist/leaflet.css';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Maximize2, Minimize2 } from 'lucide-react';
import { estadoSinal } from '@/lib/downwind';
import { corDoUsuario, COR_SINAL } from '@/lib/downwindCores';
import { escaparHtml, iniciaisDoNome } from '@/lib/htmlEscape';
import { dividirCauda, type PontoTrilha } from '@/lib/trilhaDownwind';
import type { DownwindParticipanteMapa } from '@/lib/useDownwindPosicoes';
import type { DownwindPonto } from '@/context/DownwindContext';

/**
 * O mapa ao vivo do downwind — Leaflet dedicado, separado de
 * components/LeafletMap.tsx de propósito: aquele componente carrega spots,
 * camadas de vento/rajada/onda, WindParticleLayer, busca e controles de
 * estilo — nada disso serve ao downwind, e ele entra no bundle de toda
 * abertura do app. Este é enxuto: participantes, apoio, trilha própria.
 *
 * Client-only: importado sempre via `dynamic(..., { ssr: false })` a partir
 * de quem usa (mesmo padrão de views/MapView.tsx) — Leaflet depende de
 * `window`.
 */

/**
 * Zoom inicial do mapa ao vivo. Era 12 (visão regional, litoral inteiro) —
 * pedido do dono foi entrar já perto do próprio ponto, não de longe. 16 é o
 * mesmo zoom que o botão "Minha localização" do mapa geral usa
 * (components/LeafletMap.tsx, ZOOM_LOCALIZACAO) para a mesma sensação de
 * "perto de verdade" nas duas telas.
 */
const DEFAULT_ZOOM = 16;

function MapaController({
  centro,
  ehPosicaoPropria,
}: {
  centro: [number, number] | null;
  /**
   * `centro` cai para o ponto A do downwind quando a posição própria do
   * velejador ainda não chegou (GPS/beacon leva um instante). Sem distinguir
   * os dois casos, a trava de "só centraliza uma vez" travava no ponto A na
   * primeira renderização e NUNCA recentralizava quando a posição real
   * chegava segundos depois — o mapa ficava preso em A, exatamente o bug
   * relatado. Só marcamos `centralizado` quando o centro já é a posição
   * própria de verdade.
   */
  ehPosicaoPropria: boolean;
}) {
  const map = useMap();

  // Mesma correção de views/LeafletMap.tsx: o container mede 0 na montagem
  // (aba recém-trocada, dvh ainda reavaliando), então os tiles saem cinza sem
  // isto.
  useEffect(() => {
    const remedir = () => map.invalidateSize({ animate: false });
    const raf = requestAnimationFrame(remedir);
    const t = setTimeout(remedir, 250);
    const ro = new ResizeObserver(remedir);
    ro.observe(map.getContainer());
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      ro.disconnect();
    };
  }, [map]);

  // Centraliza só uma vez, quando o primeiro centro fica disponível — depois
  // disso o velejador pode arrastar o mapa livremente sem ele "voltar" a
  // cada poll.
  const [centralizado, setCentralizado] = useState(false);
  useEffect(() => {
    if (!centro || centralizado) return;
    map.setView(centro, DEFAULT_ZOOM, { animate: false });
    // Só trava depois de centralizar na posição REAL do velejador — enquanto
    // `centro` ainda é o fallback do ponto A, o efeito continua livre para
    // rodar de novo assim que a posição própria chegar (o valor de `centro`
    // muda, o array de dependências detecta e refaz o setView).
    if (ehPosicaoPropria) setCentralizado(true);
  }, [centro, ehPosicaoPropria, centralizado, map]);

  return null;
}

function criarIconeVelejador(p: DownwindParticipanteMapa, agora: Date, ehVoce: boolean): L.DivIcon {
  const { estado } = estadoSinal(p.registradoEm ? new Date(p.registradoEm) : null, agora);
  const corAnel = COR_SINAL[estado];
  const esmaecido = estado === 'sem_sinal' ? 'opacity: .45;' : '';
  const tamanho = ehVoce ? 44 : 38;
  const nome = escaparHtml(p.nome);

  const miolo = p.avatarUrl
    ? `<img src="${escaparHtml(p.avatarUrl)}" alt="${nome}" style="width:100%;height:100%;object-fit:cover;border-radius:9999px;" />`
    : `<div style="width:100%;height:100%;border-radius:9999px;background:${corDoUsuario(p.userId)};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;color:#0f172a;">${iniciaisDoNome(p.nome)}</div>`;

  const coroa = p.ehOrganizador
    ? `<div style="position:absolute;top:-4px;right:-2px;font-size:11px;">👑</div>`
    : '';

  const html = `
    <div style="${esmaecido} width:${tamanho}px;height:${tamanho}px;position:relative;">
      <div style="width:100%;height:100%;border-radius:9999px;border:3px solid ${corAnel};box-shadow:0 2px 8px rgba(0,0,0,.5);overflow:hidden;">${miolo}</div>
      ${coroa}
      ${ehVoce ? `<div style="position:absolute;inset:-4px;border-radius:9999px;border:2px solid #22d3ee;"></div>` : ''}
    </div>
  `;

  return L.divIcon({ html, className: 'custom-spot-marker', iconSize: [tamanho, tamanho], iconAnchor: [tamanho / 2, tamanho / 2] });
}

function criarIconeApoio(p: DownwindParticipanteMapa): L.DivIcon {
  const destaque = p.ehMeuApoio;
  const largura = destaque ? 68 : 48;
  const nome = escaparHtml(p.nome);
  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
      <div style="display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;background:${destaque ? '#f59e0b' : '#334155'};border:2px solid ${destaque ? '#fbbf24' : '#475569'};box-shadow:0 2px 6px rgba(0,0,0,.5);opacity:${destaque ? 1 : 0.85};">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2"><path d="M5 17h14M6 17V9l2-4h8l2 4v8M6 12h12"/><circle cx="8.5" cy="17" r="1.5" fill="white"/><circle cx="15.5" cy="17" r="1.5" fill="white"/></svg>
        <span style="font-size:10px;font-weight:900;color:white;white-space:nowrap;">${destaque ? 'SEU APOIO' : nome}</span>
      </div>
    </div>
  `;
  return L.divIcon({ html, className: 'custom-spot-marker', iconSize: [largura, 30], iconAnchor: [largura / 2, 15] });
}

function criarIconePonto(cor: string, letra: string): L.DivIcon {
  const html = `<div style="width:22px;height:22px;border-radius:9999px;background:${cor};border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:white;box-shadow:0 2px 6px rgba(0,0,0,.5);">${letra}</div>`;
  return L.divIcon({ html, className: 'custom-spot-marker', iconSize: [22, 22], iconAnchor: [11, 11] });
}

interface DownwindMapaProps {
  meuUserId: string;
  saida: DownwindPonto | null;
  chegada: DownwindPonto | null;
  participantes: DownwindParticipanteMapa[];
  minhaTrilha: PontoTrilha[];
  onSelecionarParticipante?: (userId: string) => void;
  /**
   * O Modo Navegação (tela preta) cobre este mapa por cima (`z-splash`), mas
   * NÃO o desmonta — o mapa continua vivo, só escondido, às vezes por horas
   * numa travessia. `MapaController` só chama `map.invalidateSize()` uma vez,
   * na montagem: sem esta prop, o Leaflet nunca fica sabendo que precisa
   * remedir/redesenhar ao voltar a ficar visível, e a tela "trava" (tiles
   * desatualizados, cliques/arrasto sem efeito visível, botão de zoom
   * aparentando não fazer nada). Passe `true` enquanto o Modo Navegação
   * estiver coberto o mapa; a transição true→false é o gatilho.
   */
  escondidoPeloModoNavegacao?: boolean;
}

export const DownwindMapa: React.FC<DownwindMapaProps> = ({
  meuUserId,
  saida,
  chegada,
  participantes,
  minhaTrilha,
  onSelecionarParticipante,
  escondidoPeloModoNavegacao = false,
}) => {
  // Relógio próprio para o anel de sinal continuar correndo entre um poll e
  // outro, em vez de ficar congelado no valor do último fetch — mesmo padrão
  // de components/ModoNavegacao.tsx.
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  const minhaPosicaoPropria = useMemo<[number, number] | null>(() => {
    const eu = participantes.find((p) => p.userId === meuUserId);
    if (eu?.lat !== null && eu?.lat !== undefined && eu?.lng !== null && eu?.lng !== undefined) {
      return [eu.lat, eu.lng];
    }
    return null;
  }, [participantes, meuUserId]);

  // Fallback pro ponto A só até a posição própria chegar — ver o comentário
  // em MapaController sobre por que os dois casos não podem ser confundidos.
  const centroInicial = useMemo<[number, number] | null>(() => {
    if (minhaPosicaoPropria) return minhaPosicaoPropria;
    if (saida) return [saida.lat, saida.lng];
    return null;
  }, [minhaPosicaoPropria, saida]);

  const { corpo, cauda } = useMemo(() => dividirCauda(minhaTrilha), [minhaTrilha]);
  const minhaCor = corDoUsuario(meuUserId);

  // Mesmo filtro usado pros marcadores (abaixo) — reaproveitado aqui pro
  // botão "ver todos": só participantes com posição conhecida entram no
  // fitBounds, senão o Leaflet erra num bounds com NaN.
  const participantesComPosicao = useMemo(
    () => participantes.filter((p) => p.lat !== null && p.lng !== null),
    [participantes]
  );
  const podeVerTodos = participantesComPosicao.length >= 2;

  // Toggle de dois estados (pedido do dono): 'meu-foco' é o comportamento de
  // sempre (centraliza e trava zoom 16 na posição própria); 'todos' dá
  // zoom-out pra enquadrar todo mundo com posição conhecida. Guardado aqui
  // (não em MapaController) porque a ação é imperativa e disparada por
  // clique, não por um efeito reagindo a props.
  const [modoVisao, setModoVisao] = useState<'meu-foco' | 'todos'>('meu-foco');
  const mapRef = useRef<L.Map | null>(null);

  const alternarVisao = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (modoVisao === 'meu-foco') {
      if (!podeVerTodos) return;
      const bounds = L.latLngBounds(
        participantesComPosicao.map((p) => [p.lat as number, p.lng as number])
      );
      map.fitBounds(bounds, { padding: [48, 48] });
      setModoVisao('todos');
    } else {
      // Volta pro mesmo comportamento padrão de centralização — reusa
      // `centroInicial`, sem duplicar a lógica que já existe em
      // MapaController.
      if (centroInicial) map.setView(centroInicial, DEFAULT_ZOOM, { animate: true });
      setModoVisao('meu-foco');
    }
  }, [modoVisao, podeVerTodos, participantesComPosicao, centroInicial]);

  // Só age na TRANSIÇÃO de escondido -> visível (não em todo render com
  // `false`, que incluiria a montagem inicial — nesse caso MapaController já
  // cuida do invalidateSize/centralização iniciais sozinho). O ref evita
  // repetir a ação a cada re-render enquanto o valor não muda de verdade.
  const estavaEscondido = useRef(escondidoPeloModoNavegacao);
  useEffect(() => {
    const map = mapRef.current;
    const ficouVisivel = estavaEscondido.current && !escondidoPeloModoNavegacao;
    estavaEscondido.current = escondidoPeloModoNavegacao;
    if (!map || !ficouVisivel) return;

    map.invalidateSize({ animate: false });
    // "Ao sair, deve travar na posição do usuário" — não na última posição
    // imperativa que o mapa tinha (podia estar em modo 'todos', ou num ponto
    // arrastado à mão antes de abrir o Modo Navegação). Reaproveita a MESMA
    // regra de centralização de sempre, não uma terceira lógica.
    if (centroInicial) map.setView(centroInicial, DEFAULT_ZOOM, { animate: false });
    setModoVisao('meu-foco');
  }, [escondidoPeloModoNavegacao, centroInicial]);

  return (
    <div className="relative w-full h-full">
      <MapContainer
        ref={mapRef}
      center={centroInicial ?? [-4.5, -37.5]}
      zoom={DEFAULT_ZOOM}
      zoomControl={false}
      attributionControl={false}
      className="w-full h-full"
      style={{ background: '#e5e7eb' }}
    >
      {/* Mesmo tile "oceânico" (voyager) que o mapa principal usa por padrão
          (components/LeafletMap.tsx, mapStyle inicial 'oceanico') — o mapa do
          downwind nasceu com o tile escuro de propósito (fundo pro rastro/
          trilha "brilhar"), mas o pedido foi ficar igual ao mapa geral, claro,
          para não parecer uma tela diferente do resto do app. */}
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        attribution=""
      />
      <MapaController centro={centroInicial} ehPosicaoPropria={minhaPosicaoPropria !== null} />

      {saida && (
        <Marker position={[saida.lat, saida.lng]} icon={criarIconePonto('#0ea5e9', 'A')} />
      )}
      {chegada && (
        <Marker position={[chegada.lat, chegada.lng]} icon={criarIconePonto('#10b981', 'B')} />
      )}

      {/* Sua trilha, em duas camadas: corpo antigo fino/translúcido, cauda
          recente grossa/opaca — efeito de "rastro vivo" sem gradiente (o
          Leaflet não desenha gradiente em traço). Casing escuro por baixo
          para destacar do tile claro (era branco quando o tile era escuro —
          branco sobre claro fica invisível). */}
      {corpo.length > 1 && (
        <>
          <Polyline
            positions={corpo.map(([lat, lng]) => [lat, lng])}
            pathOptions={{ color: '#0f172a', weight: 6, opacity: 0.18 }}
          />
          <Polyline
            positions={corpo.map(([lat, lng]) => [lat, lng])}
            pathOptions={{ color: minhaCor, weight: 2, opacity: 0.4 }}
          />
        </>
      )}
      {cauda.length > 1 && (
        <>
          <Polyline
            positions={cauda.map(([lat, lng]) => [lat, lng])}
            pathOptions={{ color: '#0f172a', weight: 8, opacity: 0.22 }}
          />
          <Polyline
            positions={cauda.map(([lat, lng]) => [lat, lng])}
            pathOptions={{ color: minhaCor, weight: 4, opacity: 0.95 }}
          />
        </>
      )}

      {participantesComPosicao.map((p) => (
        <Marker
          key={p.userId}
          position={[p.lat as number, p.lng as number]}
          icon={
            p.papel === 'apoio_terra'
              ? criarIconeApoio(p)
              : criarIconeVelejador(p, agora, p.userId === meuUserId)
          }
          zIndexOffset={p.userId === meuUserId ? 2200 : p.ehMeuApoio ? 2400 : 1000}
          eventHandlers={
            onSelecionarParticipante
              ? { click: () => onSelecionarParticipante(p.userId) }
              : undefined
          }
        />
      ))}
    </MapContainer>

      {/* Canto inferior direito: livre de FaixaInfo (topo) e da faixa de
          ações (fora deste container relative, abaixo do mapa) — ver
          views/DownwindAoVivoView.tsx. */}
      <button
        type="button"
        onClick={alternarVisao}
        disabled={modoVisao === 'meu-foco' && !podeVerTodos}
        className="absolute bottom-3 right-3 z-map-ui w-11 h-11 rounded-full bg-[#0F172A]/90 backdrop-blur-sm border border-slate-700/80 text-cyan-400 shadow-lg flex items-center justify-center active:scale-95 transition-all disabled:opacity-40"
        aria-label={modoVisao === 'meu-foco' ? 'Ver todos os participantes no mapa' : 'Voltar a centralizar na minha posição'}
      >
        {modoVisao === 'meu-foco' ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
      </button>
    </div>
  );
};
