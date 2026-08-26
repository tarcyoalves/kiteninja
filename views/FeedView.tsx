'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';
import {
  Heart,
  MessageCircle,
  Search,
  Share2,
  Send,
  Plus,
  Wind,
  ThumbsUp,
  User,
  Sailboat,
  Users,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { CommunityPost, SessionFeedItem } from '../types';
import { PhotoLightboxModal } from '../components/PhotoLightboxModal';
import { CardSessaoFeed } from '../components/CardSessaoFeed';
import { devePuxarAtualizar, progressoPull } from '../lib/pullToRefresh';
import { formatRelativeTime } from '../lib/chat';

/** Dados da foto aberta em tela cheia; null = lightbox fechado. */
interface LightboxState {
  imageUrl: string;
  title?: string;
  authorName?: string;
  spotName?: string;
  windKnots?: number;
  date?: string;
}

/** Resposta de `GET /api/feed`. */
interface RespostaFeed {
  sessoes: SessionFeedItem[];
  proximoCursor: string | null;
}

async function buscarPaginaFeed(cursor: string | null): Promise<RespostaFeed> {
  const url = cursor ? `/api/feed?cursor=${encodeURIComponent(cursor)}` : '/api/feed';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Falha ao carregar o feed.');
  return res.json();
}

/**
 * Aba "Velejos": o feed novo de sessões (Fase 3 do plano de rede social),
 * scroll infinito por keyset — nunca `OFFSET` (ver seção 3 "Fluidez").
 *
 * Atualiza em 3 momentos, e SÓ nesses três (nenhum `setInterval` novo — o app
 * já tem 3 polls em andamento: chat 4s, DM 10s, SOS):
 * 1. Ao montar (abrir a aba, já que este componente só existe dentro dela).
 * 2. Puxar para atualizar (gesto de toque no topo da lista).
 * 3. Voltar de background/troca de aba do navegador (`visibilitychange`).
 */
interface AbaVelejosProps {
  /** Abre a folha de busca de velejadores (seção 4.5 do plano: o estado
   * vazio precisa de um jeito de CUMPRIR a própria instrução). */
  onAbrirBusca: () => void;
  /** Repassado direto para cada `CardSessaoFeed` — identidade estável do
   * `setRiderIdAberto` do contexto, ver comentário em CardSessaoFeed.tsx. */
  onAbrirPerfil: (riderId: string) => void;
  /** Idem, para `setSessaoIdAberta` — abre o detalhe da sessão (Fase 5). */
  onAbrirDetalhe: (sessionId: string) => void;
}

function AbaVelejos({ onAbrirBusca, onAbrirPerfil, onAbrirDetalhe }: AbaVelejosProps) {
  const [sessoes, setSessoes] = useState<SessionFeedItem[]>([]);
  const [proximoCursor, setProximoCursor] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [carregouUmaVez, setCarregouUmaVez] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [puxando, setPuxando] = useState(false);

  // Refs (não state) para os três usos que NÃO devem re-renderizar sozinhos:
  // 1) trava contra requisição duplicada (scroll rápido chamando a sentinela
  //    duas vezes antes da primeira resposta voltar); 2) o próprio scroller
  //    para medir scrollTop no início do gesto de puxar; 3) o ponto onde o
  //    dedo tocou a tela, para o pull-to-refresh calcular o delta.
  const carregandoRef = useRef(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const toqueInicialRef = useRef<{ y: number; scrollTopNoInicio: number } | null>(null);
  const [progressoPullVisual, setProgressoPullVisual] = useState(0);

  const carregar = useCallback(async (cursor: string | null, substituir: boolean) => {
    if (carregandoRef.current) return;
    carregandoRef.current = true;
    setCarregando(true);
    setErro(null);
    try {
      const body = await buscarPaginaFeed(cursor);
      setSessoes((prev) => (substituir ? body.sessoes : [...prev, ...body.sessoes]));
      setProximoCursor(body.proximoCursor);
    } catch {
      setErro('Não deu para carregar o feed agora. Puxe para tentar de novo.');
    } finally {
      carregandoRef.current = false;
      setCarregando(false);
      setCarregouUmaVez(true);
    }
  }, []);

  const atualizarDoZero = useCallback(() => carregar(null, true), [carregar]);

  // 1) Ao montar.
  useEffect(() => {
    atualizarDoZero();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3) Voltar de background/troca de aba do navegador.
  useEffect(() => {
    const aoVoltarAoForeground = () => {
      if (document.visibilityState === 'visible') atualizarDoZero();
    };
    document.addEventListener('visibilitychange', aoVoltarAoForeground);
    window.addEventListener('focus', aoVoltarAoForeground);
    return () => {
      document.removeEventListener('visibilitychange', aoVoltarAoForeground);
      window.removeEventListener('focus', aoVoltarAoForeground);
    };
  }, [atualizarDoZero]);

  // Scroll infinito: uma sentinela invisível no fim da lista dispara a
  // próxima página assim que entra na tela — nada de "carregar mais" manual,
  // e nada de recalcular altura/posição de scroll (IntersectionObserver faz
  // isso de graça).
  const sentinelaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelaRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entrada]) => {
        if (entrada.isIntersecting && proximoCursor && !carregandoRef.current) {
          carregar(proximoCursor, false);
        }
      },
      { rootMargin: '400px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [proximoCursor, carregar]);

  // 2) Pull-to-refresh: só quando o scroller já está no topo (lib/pullToRefresh.ts
  // decide isso puramente, sem depender de DOM, para o gesto poder ser testado).
  const aoTocar = useCallback((e: React.TouchEvent) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    toqueInicialRef.current = { y: e.touches[0].clientY, scrollTopNoInicio: scroller.scrollTop };
  }, []);

  const aoMoverToque = useCallback((e: React.TouchEvent) => {
    const inicio = toqueInicialRef.current;
    if (!inicio) return;
    const delta = e.touches[0].clientY - inicio.y;
    if (inicio.scrollTopNoInicio <= 0 && delta > 0) {
      setPuxando(true);
      setProgressoPullVisual(progressoPull(delta));
    }
  }, []);

  const aoSoltarToque = useCallback(
    (e: React.TouchEvent) => {
      const inicio = toqueInicialRef.current;
      toqueInicialRef.current = null;
      setPuxando(false);
      setProgressoPullVisual(0);
      if (!inicio) return;
      const delta = e.changedTouches[0].clientY - inicio.y;
      if (devePuxarAtualizar(inicio.scrollTopNoInicio, delta)) {
        atualizarDoZero();
      }
    },
    [atualizarDoZero]
  );

  return (
    <div
      ref={scrollerRef}
      onTouchStart={aoTocar}
      onTouchMove={aoMoverToque}
      onTouchEnd={aoSoltarToque}
      className="space-y-4 max-w-lg mx-auto w-full pt-2"
    >
      {/* Indicador de puxar-para-atualizar — só ocupa espaço quando o gesto
          está em andamento, para não empurrar o layout no dia a dia. */}
      {puxando && (
        <div
          className="flex items-center justify-center text-cyan-400 transition-opacity"
          style={{ opacity: progressoPullVisual }}
        >
          <RefreshCw size={18} className={progressoPullVisual >= 1 ? 'animate-spin' : ''} />
        </div>
      )}

      {!carregouUmaVez && carregando && (
        <div className="flex justify-center py-10 text-cyan-400">
          <Loader2 size={28} className="animate-spin" />
        </div>
      )}

      {carregouUmaVez && sessoes.length === 0 && !erro && (
        <div className="mx-2 mt-6 p-7 rounded-2xl border border-slate-800 bg-[#1E293B]/50 text-center">
          <Sailboat size={30} className="mx-auto text-cyan-400" />
          <p className="mt-3 font-black text-slate-100">Nenhum velejo por aqui ainda</p>
          <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
            Siga outros velejadores para ver os velejos deles aqui, ou registre a sua
            própria sessão no mapa — ela aparece pra quem te segue.
          </p>
          {/* Sem isto a instrução acima era impossível de cumprir (seção 7 do
              plano: "reordenação decidida depois da Fase 3") — não existia
              tela de busca em lugar nenhum do app. */}
          <button
            type="button"
            onClick={onAbrirBusca}
            className="mt-4 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-black text-sm active:scale-95 transition-transform"
          >
            <Search size={16} className="stroke-[2.5]" />
            Buscar velejadores
          </button>
        </div>
      )}

      {erro && sessoes.length === 0 && (
        <div className="mx-2 mt-6 p-7 rounded-2xl border border-rose-900/60 bg-rose-950/20 text-center">
          <p className="text-sm text-rose-300 font-bold">{erro}</p>
        </div>
      )}

      {sessoes.map((sessao) => (
        <CardSessaoFeed
          key={sessao.id}
          sessao={sessao}
          onAbrirPerfil={onAbrirPerfil}
          onAbrirDetalhe={onAbrirDetalhe}
        />
      ))}

      {/* Sentinela do scroll infinito — 1px invisível, só serve de gatilho
          para o IntersectionObserver acima. */}
      {proximoCursor && <div ref={sentinelaRef} className="h-1" aria-hidden="true" />}

      {carregando && carregouUmaVez && (
        <div className="flex justify-center py-4 text-cyan-400">
          <Loader2 size={22} className="animate-spin" />
        </div>
      )}
    </div>
  );
}

export const FeedView: React.FC = () => {
  const {
    posts,
    toggleLikePost,
    addComment,
    setIsNewPostOpen,
    beachMode,
    setIsBuscaVelejadoresOpen,
    setRiderIdAberto,
    setSessaoIdAberta,
    feedAba: aba,
    setFeedAba: setAba,
  } = useKiteData();
  const { user, openAuthModal } = useAuth();

  const [activeCommentPostId, setActiveCommentPostId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);

  const handleSendComment = (postId: string) => {
    if (!commentText.trim()) return;
    if (!user) {
      openAuthModal();
      return;
    }
    addComment(postId, commentText, user.name);
    setCommentText('');
  };

  const handleShare = (post: CommunityPost) => {
    if (navigator.share) {
      navigator.share({
        title: post.title,
        text: `${post.title} no spot ${post.spotName} via KiteNinja!`,
        url: window.location.href,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(`KiteNinja: ${post.title} em ${post.spotName}`);
      alert('Link do relato copiado!');
    }
  };

  return (
    <div className="flex flex-col min-h-full feed-pad-bottom relative">
      {/* Abas "Velejos" / "Comunidade" — mesmo idioma visual das abas de
          views/ChatView.tsx (pílulas ativas em cor sólida, role="tablist"). */}
      <div
        className="sticky top-0 z-10 px-3 pt-2 pb-2 bg-[#0B1220]/95 backdrop-blur-xs border-b border-slate-800/90"
        role="tablist"
        aria-label="Seções do feed"
      >
        <div className="flex items-center gap-2 max-w-lg mx-auto w-full">
          <button
            type="button"
            role="tab"
            aria-selected={aba === 'velejos'}
            onClick={() => setAba('velejos')}
            className={`flex-1 h-10 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all ${
              aba === 'velejos'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25 scale-[1.01]'
                : 'bg-[#1E293B] text-slate-300 border border-slate-700/80 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <Sailboat size={15} className="shrink-0" />
            <span>Velejos</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={aba === 'comunidade'}
            onClick={() => setAba('comunidade')}
            className={`flex-1 h-10 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all ${
              aba === 'comunidade'
                ? 'bg-fuchsia-500 text-slate-950 shadow-md shadow-fuchsia-500/25 scale-[1.01]'
                : 'bg-[#1E293B] text-slate-300 border border-slate-700/80 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <Users size={15} className="shrink-0" />
            <span>Comunidade</span>
          </button>

          {/* Ponto de entrada da busca de velejadores (seção 4.5 do plano) —
              só na aba Velejos: é onde "achar" alguém para seguir faz
              sentido; a Comunidade é feed de relatos, não de pessoas. */}
          {aba === 'velejos' && (
            <button
              type="button"
              onClick={() => setIsBuscaVelejadoresOpen(true)}
              className="h-10 w-10 shrink-0 rounded-xl bg-[#1E293B] border border-slate-700/80 text-slate-300 hover:text-white hover:bg-slate-700/50 flex items-center justify-center transition-all active:scale-95"
              aria-label="Buscar velejadores"
              title="Buscar velejadores"
            >
              <Search size={16} />
            </button>
          )}
        </div>
      </div>

      {aba === 'velejos' ? (
        <AbaVelejos
          onAbrirBusca={() => setIsBuscaVelejadoresOpen(true)}
          onAbrirPerfil={setRiderIdAberto}
          onAbrirDetalhe={setSessaoIdAberta}
        />
      ) : (
        /* Aba "Comunidade": exatamente o feed de posts que já existia antes
           da Fase 3, só movido para cá — nenhuma mudança de comportamento
           (ver seção 3.6 do plano: "não remova isso"). */
        <div className="space-y-4 max-w-lg mx-auto w-full pt-2">
          {posts.length === 0 && (
            <div className="mx-2 mt-6 p-7 rounded-2xl border border-slate-800 bg-[#1E293B]/50 text-center">
              <MessageCircle size={30} className="mx-auto text-cyan-400" />
              <p className="mt-3 font-black text-slate-100">Nenhum relato ainda</p>
              <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
                Velejou hoje? Conte como estava o vento. Seu relato ajuda quem chega
                depois a decidir se vale montar o kite.
              </p>
              <button
                type="button"
                onClick={() => setIsNewPostOpen(true)}
                className="mt-4 px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-black text-sm active:scale-95 transition-transform"
              >
                Publicar o primeiro relato
              </button>
            </div>
          )}
          {posts.map(post => (
            <article
              key={post.id}
              className={`rounded-2xl border transition-colors shadow-xl overflow-hidden ${
                beachMode
                  ? 'bg-[#020617] border-slate-800 text-white'
                  : 'bg-[#1E293B] border-slate-700/80 text-slate-100'
              }`}
            >
              {/* Post Header */}
              <div className="p-4 flex items-start justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Author Avatar */}
                  <div className="w-10 h-10 rounded-full bg-slate-800 ring-2 ring-cyan-400 overflow-hidden shrink-0 flex items-center justify-center shadow-md">
                    {post.authorAvatar ? (
                      <img src={post.authorAvatar} alt={post.authorName} className="w-full h-full object-cover" />
                    ) : (
                      <User size={20} className="text-slate-300" />
                    )}
                  </div>

                  {/* Post Titles & Location */}
                  <div className="min-w-0">
                    <h2 className="font-black text-sm sm:text-base text-white leading-tight truncate">
                      {post.title}
                    </h2>
                    <div className="flex items-center gap-1 text-xs text-cyan-400 mt-0.5 font-bold">
                      <span className="truncate">{post.spotName} &bull; {post.spotLocation}</span>
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {post.timestamp}
                    </span>
                  </div>
                </div>

                {/* Author Country Flag & Name */}
                <div className="flex flex-col items-end shrink-0 pl-2">
                  <span className="text-xl" title="País">
                    {post.authorCountryFlag || '🇧🇷'}
                  </span>
                  <span className="text-[11px] font-black text-slate-300 mt-0.5">
                    {post.authorName}
                  </span>
                </div>
              </div>

              {/* Post Image */}
              {post.photoUrl && (
                <div className="relative aspect-4/3 sm:aspect-16/10 bg-black overflow-hidden">
                  {/* Botão, não img com onClick: precisa de foco e Enter para
                      quem navega por teclado. */}
                  <button
                    type="button"
                    onClick={() =>
                      setLightbox({
                        imageUrl: post.photoUrl!,
                        title: post.title,
                        authorName: post.authorName,
                        spotName: post.spotName,
                        windKnots: post.windReport?.knots,
                        date: post.timestamp,
                      })
                    }
                    className="block w-full h-full cursor-zoom-in"
                    aria-label={`Ampliar foto: ${post.title}`}
                  >
                    <img
                      src={post.photoUrl}
                      alt={post.title}
                      className="w-full h-full object-cover"
                    />
                  </button>

                  {/* Wind Report Pill Tag if present */}
                  {post.windReport && (
                    <div className="absolute bottom-3 left-3 bg-[#0F172A]/85 backdrop-blur-md px-3 py-1.5 rounded-full border border-cyan-500/40 text-white flex items-center gap-2 text-xs shadow-xl">
                      <Wind size={13} className="text-cyan-400" />
                      <span className="font-black text-cyan-300">{post.windReport.knots} nós</span>
                      <span className="text-slate-400">&bull;</span>
                      <span className="font-bold text-slate-200 text-[11px]">{post.windReport.kiteUsed}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Interaction Bar matching Screenshot 3 */}
              <div className="px-4 py-3 flex items-center justify-between border-b border-slate-800">
                <div className="flex items-center gap-4">
                  {/* Like Button */}
                  <button
                    onClick={() => toggleLikePost(post.id)}
                    className={`flex items-center gap-1.5 text-xs font-black transition-all active:scale-125 ${
                      post.isLiked
                        ? 'text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                        : 'text-slate-400 hover:text-rose-400'
                    }`}
                  >
                    <ThumbsUp size={18} className={post.isLiked ? 'fill-current' : ''} />
                    <span>{post.likes}</span>
                  </button>

                  {/* Comments Toggle */}
                  <button
                    onClick={() =>
                      setActiveCommentPostId(activeCommentPostId === post.id ? null : post.id)
                    }
                    className="flex items-center gap-1.5 text-xs font-black text-slate-400 hover:text-white transition-colors"
                  >
                    <MessageCircle size={18} />
                    <span>{post.comments.length}</span>
                  </button>

                  {/* Share Button */}
                  <button
                    onClick={() => handleShare(post)}
                    className="p-2 min-w-11 min-h-11 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex items-center justify-center"
                    aria-label="Compartilhar relato"
                  >
                    <Share2 size={18} />
                  </button>
                </div>

                {/* Tag Badge */}
                {post.tag && (
                  <span className="px-3 py-1 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[11px] font-black">
                    {post.tag}
                  </span>
                )}
              </div>

              {/* Post Description Content */}
              <div className="p-4 text-xs sm:text-sm text-slate-200 space-y-2">
                <p className="leading-relaxed whitespace-pre-line">{post.content}</p>
              </div>

              {/* Comments Section Drawer */}
              {activeCommentPostId === post.id && (
                <div className="p-4 bg-[#0F172A]/80 border-t border-slate-800 space-y-3">
                  <h4 className="font-black text-xs text-slate-400 uppercase tracking-wider">
                    Comentários dos Riders ({post.comments.length})
                  </h4>

                  {/* Existing comments */}
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {post.comments.length > 0 ? (
                      post.comments.map(c => (
                        <div key={c.id} className="p-2.5 rounded-xl bg-[#1E293B] text-xs border border-slate-700/80">
                          <div className="flex items-center justify-between font-black text-white mb-0.5">
                            <span className="text-cyan-400">{c.userName}</span>
                            <span className="text-[10px] text-slate-400 font-normal">{formatRelativeTime(c.time)}</span>
                          </div>
                          <p className="text-slate-300">{c.text}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-400 italic">Seja o primeiro a comentar sobre este velejo!</p>
                    )}
                  </div>

                  {/* Comment Input */}
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={commentText}
                      onChange={e => setCommentText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSendComment(post.id)}
                      placeholder="Adicionar comentário..."
                      className="flex-1 px-3 py-2 rounded-xl bg-[#1E293B] border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-cyan-400"
                    />
                    <button
                      onClick={() => handleSendComment(post.id)}
                      className="p-2.5 rounded-xl bg-cyan-500 text-slate-950 font-black hover:bg-cyan-400 active:scale-95 transition-all shadow-md shadow-cyan-500/20"
                    >
                      <Send size={15} />
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {/* Floating Blue "Publicar" Button matching Screenshot 3. Só na aba
          Comunidade: publicar uma sessão de velejo acontece no mapa/logbook,
          não aqui — este FAB é sempre sobre CommunityPost.
          publish-fab-bottom (globals.css) posiciona acima do menu flutuante
          usando --nav-h + safe area — bottom fixo deixava o menu cobri-lo. */}
      {aba === 'comunidade' && (
        <div className="fixed publish-fab-bottom left-0 right-0 z-20 flex justify-center pointer-events-none">
          <button
            onClick={() => {
              if (!user) {
                openAuthModal();
              } else {
                setIsNewPostOpen(true);
              }
            }}
            className="pointer-events-auto flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm tracking-wide shadow-2xl shadow-cyan-500/30 active:scale-95 transition-all border border-cyan-300/40"
          >
            <Plus size={18} className="stroke-[3]" />
            <span>Publicar Relato</span>
          </button>
        </div>
      )}

      <PhotoLightboxModal
        isOpen={lightbox !== null}
        onClose={() => setLightbox(null)}
        imageUrl={lightbox?.imageUrl ?? ''}
        title={lightbox?.title}
        authorName={lightbox?.authorName}
        spotName={lightbox?.spotName}
        windKnots={lightbox?.windKnots}
        date={lightbox?.date}
      />
    </div>
  );
};
