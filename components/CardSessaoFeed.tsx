'use client';

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Heart, MessageCircle, Wind, Route, Gauge, Clock, User } from 'lucide-react';
import { TrilhaMiniatura } from './TrilhaMiniatura';
import { formatRelativeTime } from '@/lib/chat';
import type { SessionFeedItem } from '@/types';

/**
 * O mapa de satélite de verdade — só existe no bundle quando alguém rola até
 * perto dele (`next/dynamic`, `ssr: false`, mesmo padrão de
 * `DownwindResumoModal`/`MapView`). O componente em si (`CardSessaoFeedMapa`)
 * só é MONTADO quando `emViewport` vira `true` logo abaixo — o `dynamic()`
 * aqui cuida do bundle, o `IntersectionObserver` cuida do ciclo de vida.
 */
const CardSessaoFeedMapa = dynamic(
  () => import('./CardSessaoFeedMapa').then((m) => m.CardSessaoFeedMapa),
  { ssr: false }
);

/**
 * Margem generosa (~2 alturas de card) antes/depois do viewport real para
 * montar e desmontar o Leaflet — ver seção 3 (Fluidez) do plano de rede
 * social. Generosa dos dois lados: monta um pouco ANTES do card aparecer (o
 * satélite já está pronto quando o velejador chega nele, sem esperar tile
 * carregar na tela) e só desmonta um bom tanto DEPOIS de sair (rolagem rápida
 * de vaivém não fica montando/desmontando mapa a cada pixel).
 */
const MARGEM_VIEWPORT = '500px 0px 500px 0px';

function formatarDuracao(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

interface CardSessaoFeedProps {
  sessao: SessionFeedItem;
}

/**
 * O card do feed de velejos (Fase 3, seção 3.5 do plano) — layout inspirado
 * no print do Surfr citado no plano, mas só com o que o app de fato mede
 * (ver "o que NÃO copiar" na seção 5: sem altura de salto por GPS, sem
 * "subscribe to unlock", sem leaderboard).
 *
 * `React.memo`: a lista pode ter dezenas de cards montados ao mesmo tempo
 * (mesmo com `content-visibility:auto` cortando o custo de PINTURA dos que
 * estão fora da tela, o componente React em si continua existindo na árvore)
 * — sem memo, qualquer re-render do `FeedView` (ex.: outro card curtindo e
 * atualizando seu próprio estado local) re-renderizaria todos os irmãos à
 * toa. Só funciona de verdade se o pai nunca passar objeto/array criado
 * inline (ver `views/FeedView.tsx`: `sessao` vem direto do array de estado,
 * nunca de um spread `{...sessao}` novo a cada render).
 */
export const CardSessaoFeed = memo(function CardSessaoFeed({ sessao }: CardSessaoFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [emViewport, setEmViewport] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Um observer por card (não um observer global compartilhado): o feed só
    // tem a página atual de ~15 cards montados por vez, longe da escala em
    // que um observer por instância pesaria — e cada card entra/sai da tela
    // de forma independente, então compartilhar não economizaria trabalho
    // real, só complexidade.
    const observer = new IntersectionObserver(
      ([entrada]) => setEmViewport(entrada.isIntersecting),
      { rootMargin: MARGEM_VIEWPORT }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const temTrilha = Boolean(sessao.trilhaReduzida && sessao.trilhaReduzida.length > 0);

  // Curtida otimista (seção 3 do plano): pinta no toque, a requisição vai
  // atrás. `null` = "sem override local", mostra o que veio do servidor
  // (`sessao.euCurti`/`sessao.curtidas`) — é o estado normal. Um objeto aqui
  // é a exceção: só existe enquanto o toque local diverge do que o
  // `FeedView` tem (durante a requisição, ou depois dela, até o próximo
  // fetch trazer a verdade do servidor de novo).
  const [otimista, setOtimista] = useState<{ curtido: boolean; contagem: number } | null>(null);

  // Sempre que uma nova verdade do servidor chega para ESTA sessão (feed
  // recarregado por pull-to-refresh, por exemplo), o override local perde a
  // validade — sem isto, um pull-to-refresh que trouxesse curtidas de OUTRAS
  // pessoas continuaria escondido atrás do valor otimista antigo para sempre.
  useEffect(() => {
    setOtimista(null);
  }, [sessao.euCurti, sessao.curtidas]);

  const curtido = otimista ? otimista.curtido : sessao.euCurti;
  const contagemCurtidas = otimista ? otimista.contagem : sessao.curtidas;

  const handleCurtir = useCallback(() => {
    const proximoCurtido = !curtido;
    const proximaContagem = Math.max(0, contagemCurtidas + (proximoCurtido ? 1 : -1));
    setOtimista({ curtido: proximoCurtido, contagem: proximaContagem });

    fetch(`/api/sessions/${sessao.id}/like`, { method: proximoCurtido ? 'POST' : 'DELETE' })
      .then((res) => {
        if (!res.ok) throw new Error('curtida falhou');
        return res.json() as Promise<{ count: number }>;
      })
      .then((body) => setOtimista({ curtido: proximoCurtido, contagem: body.count }))
      .catch(() => {
        // Reverte: some o override e volta a mostrar o que o servidor tinha
        // antes do toque — nunca deixa a UI presa num estado que a
        // requisição não confirmou.
        setOtimista(null);
      });
  }, [curtido, contagemCurtidas, sessao.id]);

  return (
    <article
      ref={containerRef}
      className="feed-card rounded-2xl border border-slate-700/80 bg-[#1E293B] text-slate-100 shadow-xl overflow-hidden"
    >
      {/* Topo: avatar + nome + spot + bandeira à esquerda; duração + vento à
          direita (seção 3.5 do plano, layout do print do Surfr). */}
      <div className="p-4 flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-slate-800 ring-2 ring-cyan-400 overflow-hidden shrink-0 flex items-center justify-center shadow-md">
            {sessao.authorAvatarUrl ? (
              <img src={sessao.authorAvatarUrl} alt={sessao.authorName} className="w-full h-full object-cover" />
            ) : (
              <User size={20} className="text-slate-300" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="font-black text-sm text-white leading-tight truncate flex items-center gap-1.5">
              <span className="truncate">{sessao.authorName}</span>
              <span className="text-base shrink-0" title="País">
                {sessao.authorCountryFlag}
              </span>
            </h2>
            <p className="text-xs text-cyan-400 font-bold truncate">{sessao.spotName}</p>
            <p className="text-[11px] text-slate-400 font-mono">{formatRelativeTime(sessao.createdAt)}</p>
          </div>
        </div>

        <div className="flex flex-col items-end shrink-0 text-right">
          <span className="flex items-center gap-1 text-xs font-black text-slate-200">
            <Clock size={12} className="text-slate-400" />
            {formatarDuracao(sessao.durationMinutes)}
          </span>
          <span className="flex items-center gap-1 text-xs font-black text-emerald-400 mt-0.5">
            <Wind size={12} />
            {sessao.avgWindKnots} nós
          </span>
        </div>
      </div>

      {/* Meio: a trilha. TrilhaMiniatura (SVG) SEMPRE renderizada por baixo;
          o Leaflet real só monta quando o card está na tela (ou perto dela)
          — ver `MARGEM_VIEWPORT` acima. Sessão sem trilha (digitada à mão)
          não mostra mapa nenhum aqui, nunca inventa uma. */}
      {temTrilha && (
        <div className="relative aspect-4/3 sm:aspect-16/10 bg-black overflow-hidden">
          <TrilhaMiniatura trilha={sessao.trilhaReduzida!} className="absolute inset-0 w-full h-full" />
          {emViewport && (
            <div className="absolute inset-0 animate-[fadeInMapa_0.4s_ease-out]">
              <CardSessaoFeedMapa trilha={sessao.trilhaReduzida!} />
            </div>
          )}
        </div>
      )}

      {/* Faixa de 4 números: Distância, Vel. máx, Duração, Vento (seção 3.5 /
          5 do plano). `highestJumpM` NUNCA aparece aqui — é manual do
          logbook, não medido por GPS (ver seção 5: "NÃO copiar Jumps/Max
          airtime"), e mostrá-lo junto dos 4 números mediria daria a entender
          que é dado medido igual aos outros. */}
      <div className="grid grid-cols-4 gap-2 px-4 py-3 border-t border-b border-slate-800 bg-[#0F172A]/60">
        <EstatisticaCard icone={<Route size={14} className="text-cyan-400" />} rotulo="Distância">
          {sessao.distanceKm !== undefined ? `${sessao.distanceKm.toFixed(1)}km` : '—'}
        </EstatisticaCard>
        <EstatisticaCard icone={<Gauge size={14} className="text-amber-400" />} rotulo="Vel. máx">
          {sessao.maxSpeedKnots !== undefined ? `${sessao.maxSpeedKnots.toFixed(1)}nós` : '—'}
        </EstatisticaCard>
        <EstatisticaCard icone={<Clock size={14} className="text-slate-300" />} rotulo="Duração">
          {formatarDuracao(sessao.durationMinutes)}
        </EstatisticaCard>
        <EstatisticaCard icone={<Wind size={14} className="text-emerald-400" />} rotulo="Vento">
          {sessao.avgWindKnots}nós
        </EstatisticaCard>
      </div>

      {/* Rodapé: curtir + contagem, contagem de comentários (só leitura
          nesta fase — ver "Escopo consciente" do plano), disciplina/prancha
          à direita. */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleCurtir}
            aria-pressed={curtido}
            className={`flex items-center gap-1.5 text-xs font-black transition-all active:scale-125 min-h-11 ${
              curtido
                ? 'text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                : 'text-slate-400 hover:text-rose-400'
            }`}
          >
            <Heart size={18} className={curtido ? 'fill-current' : ''} />
            <span>{contagemCurtidas}</span>
          </button>

          <span className="flex items-center gap-1.5 text-xs font-black text-slate-400">
            <MessageCircle size={18} />
            <span>{sessao.comentarios}</span>
          </span>
        </div>

        <span className="px-3 py-1 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[11px] font-black truncate max-w-[55%]">
          {sessao.discipline}
          {sessao.boardModel ? ` · ${sessao.boardModel}` : ''}
        </span>
      </div>
    </article>
  );
});

/** Uma célula da faixa de 4 números — extraída para não repetir o markup 4
 * vezes e para o rótulo/valor sempre ficarem no mesmo lugar visual. */
function EstatisticaCard({
  icone,
  rotulo,
  children,
}: {
  icone: React.ReactNode;
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-0.5">
      {icone}
      <span className="text-sm font-black text-white leading-none">{children}</span>
      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">{rotulo}</span>
    </div>
  );
}
