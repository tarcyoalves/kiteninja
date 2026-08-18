'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Heart,
  MapPin,
  Eye,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Tag,
  Calendar,
  Package,
  User,
  Handshake,
  Trash2,
  BadgeCheck,
  Clock,
  Maximize2,
} from 'lucide-react';
import { PhotoLightboxModal } from './PhotoLightboxModal';
import { formatBRL, formatListingSize } from '../lib/marketplace';
import type { Listing, ListingStatus } from '../types';

interface ListingDetailModalProps {
  listingId: string | null;
  onClose: () => void;
  /** Chamado após favoritar/editar/remover, para o feed refletir a mudança. */
  onChanged: () => void;
}

/** Status que o dono pode alternar direto do detalhe. */
const STATUS_RAPIDOS: ListingStatus[] = ['Ativo', 'Reservado', 'Vendido'];

const CORES_STATUS: Record<ListingStatus, string> = {
  Ativo: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  Reservado: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  Vendido: 'bg-slate-700 text-slate-300 border-slate-600',
  Removido: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

export const ListingDetailModal: React.FC<ListingDetailModalProps> = ({
  listingId,
  onClose,
  onChanged,
}) => {
  const [listing, setListing] = useState<Listing | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [fotoAtual, setFotoAtual] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [acaoBusy, setAcaoBusy] = useState(false);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);

  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!listingId) {
      setListing(null);
      return;
    }

    let ativo = true;
    setCarregando(true);
    setErro(null);
    setFotoAtual(0);
    setConfirmandoRemocao(false);

    (async () => {
      try {
        const res = await fetch(`/api/listings/${listingId}`);
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            (body && typeof body === 'object' && 'error' in body
              ? String((body as { error: unknown }).error)
              : null) || 'Não foi possível carregar o anúncio.'
          );
        }
        if (ativo) setListing((body as { listing: Listing }).listing);
      } catch (err) {
        if (ativo) setErro(err instanceof Error ? err.message : 'Falha ao carregar o anúncio.');
      } finally {
        if (ativo) setCarregando(false);
      }
    })();

    return () => {
      // Evita gravar resposta de um anúncio que o usuário já fechou.
      ativo = false;
    };
  }, [listingId]);

  // Esc fecha e o body para de rolar enquanto o detalhe está aberto.
  useEffect(() => {
    if (!listingId) return;

    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !lightbox) onClose();
    };
    window.addEventListener('keydown', onKey);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = anterior;
    };
  }, [listingId, onClose, lightbox]);

  const favoritar = useCallback(async () => {
    if (!listing) return;
    setAcaoBusy(true);
    try {
      const res = await fetch(`/api/listings/${listing.id}/favorite`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error('Falha ao favoritar.');
      const { isFavorite, favoritesCount } = body as { isFavorite: boolean; favoritesCount: number };
      setListing((prev) => (prev ? { ...prev, isFavorite, favoritesCount } : prev));
      onChanged();
    } catch {
      setErro('Não foi possível salvar o favorito. Tente de novo.');
    } finally {
      setAcaoBusy(false);
    }
  }, [listing, onChanged]);

  const mudarStatus = async (status: ListingStatus) => {
    if (!listing) return;
    setAcaoBusy(true);
    setErro(null);
    try {
      const res = await fetch(`/api/listings/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Falha ao atualizar o anúncio.');
      setListing((prev) => (prev ? { ...prev, status } : prev));
      onChanged();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível atualizar o anúncio.');
    } finally {
      setAcaoBusy(false);
    }
  };

  const remover = async () => {
    if (!listing) return;
    setAcaoBusy(true);
    setErro(null);
    try {
      const res = await fetch(`/api/listings/${listing.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Falha ao remover o anúncio.');
      onChanged();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível remover o anúncio.');
      setAcaoBusy(false);
    }
  };

  if (!listingId) return null;

  const fotos = listing?.photos ?? [];
  const tamanho = listing
    ? formatListingSize({
        category: listing.category,
        sizeM2: listing.sizeM2 ?? null,
        sizeCm: listing.sizeCm ?? null,
      })
    : null;

  return (
    <>
      <div className="fixed inset-0 z-modal flex items-start sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-xs overflow-y-auto">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={listing ? listing.title : 'Detalhe do anúncio'}
          className="bg-[#0F172A] text-slate-100 w-full max-w-md sm:rounded-3xl border-slate-800 sm:border shadow-2xl min-h-full sm:min-h-0 sm:my-6 overflow-hidden"
        >
          <div className="sticky top-0 overlay-safe-top bg-[#0F172A]/95 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-2">
            <h2 className="font-black text-sm text-white truncate">
              {listing ? listing.title : 'Anúncio'}
            </h2>
            <button
              type="button"
              ref={closeButtonRef}
              onClick={onClose}
              className="min-w-11 min-h-11 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors shrink-0"
              aria-label="Fechar detalhe do anúncio"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          {carregando && (
            <div className="py-20 flex flex-col items-center gap-3 text-slate-400">
              <Loader2 size={28} className="animate-spin text-cyan-400" aria-hidden="true" />
              <p className="text-xs font-bold">Carregando anúncio...</p>
            </div>
          )}

          {!carregando && erro && !listing && (
            <div className="p-8 text-center space-y-4">
              <p role="alert" className="text-sm font-bold text-rose-300">
                {erro}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-3 min-h-11 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-black text-xs"
              >
                Fechar
              </button>
            </div>
          )}

          {listing && (
            <>
              {/* Carrossel de fotos */}
              <div className="relative bg-black aspect-4/3">
                {fotos.length > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setLightbox(true)}
                      className="block w-full h-full cursor-zoom-in"
                      aria-label={`Ampliar foto ${fotoAtual + 1} de ${fotos.length}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- data URL vinda do banco, sem host para o next/image otimizar */}
                      <img
                        src={fotos[fotoAtual]}
                        alt={`${listing.title} — foto ${fotoAtual + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>

                    {fotos.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setFotoAtual((i) => (i - 1 + fotos.length) % fotos.length)
                          }
                          aria-label="Foto anterior"
                          className="absolute left-2 top-1/2 -translate-y-1/2 min-w-11 min-h-11 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white border border-white/10"
                        >
                          <ChevronLeft size={20} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setFotoAtual((i) => (i + 1) % fotos.length)}
                          aria-label="Próxima foto"
                          className="absolute right-2 top-1/2 -translate-y-1/2 min-w-11 min-h-11 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white border border-white/10"
                        >
                          <ChevronRight size={20} aria-hidden="true" />
                        </button>

                        <div
                          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5"
                          aria-hidden="true"
                        >
                          {fotos.map((_, i) => (
                            <span
                              key={i}
                              className={`w-2 h-2 rounded-full transition-colors ${
                                i === fotoAtual ? 'bg-cyan-400' : 'bg-white/40'
                              }`}
                            />
                          ))}
                        </div>
                      </>
                    )}

                    <span className="absolute top-3 right-3 flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/60 text-white text-[11px] font-black border border-white/10">
                      <Maximize2 size={11} aria-hidden="true" />
                      {fotoAtual + 1}/{fotos.length}
                    </span>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-600">
                    <Package size={36} aria-hidden="true" />
                    <span className="text-xs font-bold">Sem foto</span>
                  </div>
                )}

                <span
                  className={`absolute top-3 left-3 px-3 py-1 rounded-full text-[11px] font-black border backdrop-blur-md ${CORES_STATUS[listing.status]}`}
                >
                  {listing.status}
                </span>
              </div>

              <div className="p-4 space-y-4">
                {erro && (
                  <p
                    role="alert"
                    className="text-xs font-bold text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-xl px-3 py-2.5"
                  >
                    {erro}
                  </p>
                )}

                {/* Preço + favorito */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-black text-2xl text-emerald-400">
                      {formatBRL(listing.priceCents)}
                    </p>
                    {listing.negotiable && (
                      <span className="inline-flex items-center gap-1 mt-1 text-[11px] font-black text-emerald-300">
                        <Handshake size={12} aria-hidden="true" />
                        Aceita negociar
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={favoritar}
                    disabled={acaoBusy}
                    aria-pressed={listing.isFavorite}
                    aria-label={
                      listing.isFavorite ? 'Remover dos favoritos' : 'Salvar nos favoritos'
                    }
                    className={`min-w-11 min-h-11 px-3 flex items-center gap-1.5 rounded-xl border font-black text-xs transition-all active:scale-95 disabled:opacity-60 ${
                      listing.isFavorite
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        : 'bg-[#1E293B] text-slate-300 border-slate-700 hover:border-slate-500'
                    }`}
                  >
                    <Heart
                      size={17}
                      className={listing.isFavorite ? 'fill-current' : ''}
                      aria-hidden="true"
                    />
                    <span>{listing.favoritesCount}</span>
                  </button>
                </div>

                {/* Badges */}
                <div className="flex flex-wrap gap-1.5 text-[11px] font-black">
                  <span className="px-2.5 py-1 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    {listing.category}
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    {listing.condition}
                  </span>
                  {tamanho && (
                    <span className="px-2.5 py-1 rounded-full bg-slate-700 text-slate-200">
                      {tamanho}
                    </span>
                  )}
                  {listing.yearManufactured && (
                    <span className="px-2.5 py-1 rounded-full bg-slate-700 text-slate-200 flex items-center gap-1">
                      <Calendar size={11} aria-hidden="true" />
                      {listing.yearManufactured}
                    </span>
                  )}
                </div>

                {(listing.brand || listing.model) && (
                  <p className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Tag size={13} className="text-cyan-400" aria-hidden="true" />
                    {[listing.brand, listing.model].filter(Boolean).join(' ')}
                  </p>
                )}

                <p className="text-xs sm:text-sm text-slate-200 leading-relaxed whitespace-pre-line">
                  {listing.description}
                </p>

                <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 pt-1 border-t border-slate-800">
                  <span className="flex items-center gap-1 pt-2">
                    <MapPin size={12} className="text-rose-400" aria-hidden="true" />
                    {listing.city} &bull; {listing.state}
                  </span>
                  <span className="flex items-center gap-1 pt-2">
                    <Eye size={12} aria-hidden="true" />
                    {listing.viewsCount} visualizaç{listing.viewsCount === 1 ? 'ão' : 'ões'}
                  </span>
                </div>

                {/* Vendedor */}
                <div className="p-3 rounded-2xl bg-[#1E293B] border border-slate-700 flex items-center gap-3">
                  <span className="w-11 h-11 rounded-full bg-slate-800 ring-2 ring-cyan-400 overflow-hidden shrink-0 flex items-center justify-center">
                    {listing.sellerAvatar ? (
                      /* eslint-disable-next-line @next/next/no-img-element -- avatar é data URL do próprio banco */
                      <img
                        src={listing.sellerAvatar}
                        alt={listing.sellerName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User size={20} className="text-slate-400" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-sm text-white truncate flex items-center gap-1.5">
                      {listing.sellerName}
                      {listing.isOwner && (
                        <span className="px-2 py-0.5 rounded-full bg-cyan-500 text-slate-950 text-[10px] font-black uppercase">
                          Você
                        </span>
                      )}
                    </p>
                    {listing.sellerRiderId && (
                      <p className="text-[11px] font-mono font-bold text-cyan-400">
                        ID: {listing.sellerRiderId}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-400 font-bold flex items-center gap-1 mt-0.5">
                      <Clock size={10} aria-hidden="true" />
                      Anunciado em{' '}
                      {new Date(listing.createdAt).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                </div>

                {/*
                  Sem botão de contato ainda: o app não tem canal de mensagem
                  direta, e expor e-mail ou telefone aqui vazaria dado de contato
                  para toda a comunidade. O chat já existe como caminho.
                */}
                {!listing.isOwner && (
                  <p className="text-[11px] text-slate-400 text-center leading-relaxed">
                    Fale com <strong className="text-slate-200">{listing.sellerName}</strong> pelo
                    chat de velejadores para combinar a venda.
                  </p>
                )}

                {/* Ações do dono */}
                {listing.isOwner && (
                  <div className="pt-3 border-t border-slate-800 space-y-2.5">
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                      Gerenciar anúncio
                    </p>

                    <div className="grid grid-cols-3 gap-2">
                      {STATUS_RAPIDOS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => mudarStatus(s)}
                          disabled={acaoBusy || listing.status === s}
                          aria-pressed={listing.status === s}
                          className={`px-2 py-3 min-h-11 rounded-xl text-xs font-black border transition-all disabled:opacity-100 ${
                            listing.status === s
                              ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                              : 'bg-[#1E293B] text-slate-300 border-slate-700 hover:border-slate-500 disabled:opacity-50'
                          }`}
                        >
                          {listing.status === s && (
                            <BadgeCheck size={12} className="inline mr-1" aria-hidden="true" />
                          )}
                          {s}
                        </button>
                      ))}
                    </div>

                    {confirmandoRemocao ? (
                      <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 space-y-2.5">
                        <p role="alert" className="text-xs font-bold text-rose-200">
                          Remover o anúncio? Ele sai do feed, mas você mantém o
                          histórico e pode reativá-lo depois.
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={remover}
                            disabled={acaoBusy}
                            className="flex-1 py-3 min-h-11 rounded-xl bg-rose-500 text-white font-black text-xs active:scale-98 transition-all disabled:opacity-60 flex items-center justify-center gap-1.5"
                          >
                            {acaoBusy ? (
                              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                            ) : (
                              <Trash2 size={14} aria-hidden="true" />
                            )}
                            <span>Sim, remover</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmandoRemocao(false)}
                            disabled={acaoBusy}
                            className="flex-1 py-3 min-h-11 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-black text-xs"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmandoRemocao(true)}
                        disabled={acaoBusy}
                        className="w-full py-3 min-h-11 rounded-xl bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 text-rose-300 font-black text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        <span>Remover anúncio</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <PhotoLightboxModal
        isOpen={lightbox && fotos.length > 0}
        onClose={() => setLightbox(false)}
        imageUrl={fotos[fotoAtual] ?? ''}
        title={listing?.title}
        authorName={listing?.sellerName}
        spotName={listing ? `${listing.city} — ${listing.state}` : undefined}
      />
    </>
  );
};
