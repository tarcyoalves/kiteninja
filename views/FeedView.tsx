'use client';

import React, { useState } from 'react';
import { useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';
import {
  Heart,
  MessageCircle,
  Share2,
  Send,
  Plus,
  Wind,
  MapPin,
  Sparkles,
  Tag,
  MoreVertical,
  ThumbsUp,
  User,
} from 'lucide-react';
import { CommunityPost } from '../types';
import { PhotoLightboxModal } from '../components/PhotoLightboxModal';

/** Dados da foto aberta em tela cheia; null = lightbox fechado. */
interface LightboxState {
  imageUrl: string;
  title?: string;
  authorName?: string;
  spotName?: string;
  windKnots?: number;
  date?: string;
}

export const FeedView: React.FC = () => {
  const { posts, toggleLikePost, addComment, setIsNewPostOpen, beachMode } = useKiteData();
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
      {/* Feed List matching Screenshot 3 */}
      <div className="space-y-4 max-w-lg mx-auto w-full pt-2">
        {posts.length === 0 && (
          /* Feed novo começa vazio: sem isso a primeira impressão é tela branca. */
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
                          <span className="text-[10px] text-slate-400 font-normal">{c.time}</span>
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

      {/* Floating Blue "Publicar" Button matching Screenshot 3.
          publish-fab-bottom (globals.css) posiciona acima do menu flutuante
          usando --nav-h + safe area — bottom fixo deixava o menu cobri-lo. */}
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
