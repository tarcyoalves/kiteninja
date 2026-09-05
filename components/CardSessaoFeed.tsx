'use client';

import React, { memo, useEffect, useRef, useState } from 'react';
import { Heart, MessageCircle, Wind, Route, Gauge, Clock, User } from 'lucide-react';
import { CarrosselDoVelejo } from './CarrosselDoVelejo';
import { formatRelativeTime } from '@/lib/chat';
import { useCurtidaOtimista } from '@/lib/useCurtidaOtimista';
import type { SessionFeedItem } from '@/types';
import { formatarVelocidadeVelejo } from '../lib/velocidadeVelejo';

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
  /**
   * Abre o perfil público do autor (seção 4.5 do plano de rede social) — quem
   * chama passa o próprio `setRiderIdAberto` do contexto (identidade estável
   * de um `useState`), nunca uma função nova a cada render: `CardSessaoFeed`
   * é `React.memo` e uma prop de função recriada quebraria o memo para toda
   * a lista a cada render do pai.
   */
  onAbrirPerfil: (riderId: string) => void;
  /**
   * Abre o detalhe da sessão (mapa full-bleed + estatísticas + comentários,
   * Fase 5 do plano de rede social) — mesma identidade estável de
   * `onAbrirPerfil` acima, vinda de `setSessaoIdAberta` do contexto.
   */
  onAbrirDetalhe: (sessionId: string) => void;
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
export const CardSessaoFeed = memo(function CardSessaoFeed({
  sessao,
  onAbrirPerfil,
  onAbrirDetalhe,
}: CardSessaoFeedProps) {
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


  // Curtida otimista (seção 3 do plano) — lógica extraída para
  // lib/useCurtidaOtimista.ts, reaproveitada também por SessionDetailModal.
  const { curtido, contagem: contagemCurtidas, alternar: handleCurtir } = useCurtidaOtimista(
    sessao.id,
    sessao.euCurti,
    sessao.curtidas
  );

  return (
    <article
      ref={containerRef}
      onClick={() => onAbrirDetalhe(sessao.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onAbrirDetalhe(sessao.id);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Ver detalhe do velejo em ${sessao.spotName}`}
      className="feed-card rounded-2xl border border-slate-700/80 bg-[#1E293B] text-slate-100 shadow-xl overflow-hidden cursor-pointer"
    >
      {/* Topo: avatar + nome + spot + bandeira à esquerda; duração + vento à
          direita (seção 3.5 do plano, layout do print do Surfr). */}
      <div className="p-4 flex items-start justify-between gap-2">
        {/* Botão, não div com onClick (mesmo motivo do lightbox de foto em
            FeedView.tsx): precisa de foco e Enter para quem navega por
            teclado. Abre o perfil público do autor — seção 4.5 do plano.
            stopPropagation: o <article> inteiro agora abre o detalhe da
            sessão (Fase 5) — sem isto, tocar no autor abriria os dois
            modais ao mesmo tempo. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAbrirPerfil(sessao.authorId);
          }}
          className="flex items-center gap-3 min-w-0 text-left"
          aria-label={`Ver perfil de ${sessao.authorName}`}
        >
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
        </button>

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

      {/* Meio: trilha e foto lado a lado, deslizando na horizontal.
          A trilha vem primeiro — é o registro do que aconteceu, e é o que
          diferencia um velejo de uma foto qualquer. Sessão digitada à mão, sem
          trilha nem foto, não mostra nada aqui: nunca inventa um mapa.
          Ver components/CarrosselDoVelejo.tsx. */}
      <CarrosselDoVelejo
        sessaoId={sessao.id}
        trilha={sessao.trilhaReduzida}
        totalFotos={sessao.totalFotos ?? 0}
        emViewport={emViewport}
      />

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
          {/* km/h, igual ao Modo Navegação e ao resumo do downwind. Mostrar
              o MESMO número em nós aqui era o que fazia o app parecer errar a
              velocidade — ver lib/velocidadeVelejo.ts. */}
          {formatarVelocidadeVelejo(sessao.maxSpeedKnots)}
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
            onClick={(e) => {
              e.stopPropagation();
              handleCurtir();
            }}
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
 * vezes e para o rótulo/valor sempre ficarem no mesmo lugar visual.
 * Exportada: `SessionDetailModal.tsx` (Fase 5) reaproveita a MESMA aparência
 * visual para a grade maior de estatísticas do detalhe. */
export function EstatisticaCard({
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
