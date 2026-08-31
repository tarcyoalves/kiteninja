'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Sailboat, User, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { BotaoSeguir } from './BotaoSeguir';
import { CardSessaoFeed } from './CardSessaoFeed';
import type { RelacaoRider, RiderProfile, SessionFeedItem } from '@/types';
import { useAoMudar } from '../lib/useAoMudar';

interface RiderProfileModalProps {
  /** `null` = modal fechado — mesmo contrato de `ListingDetailModal`
   * (`listingId: string | null`), para o pai controlar com um único state. */
  riderId: string | null;
  onClose: () => void;
  /** Repassado para cada `CardSessaoFeed` da lista de velejos — mesmo
   * `setRiderIdAberto` do contexto que abriu ESTE modal (ver app/page.tsx),
   * então tocar no autor de um velejo aqui dentro troca o perfil em exibição
   * em vez de não fazer nada. */
  onAbrirPerfil: (riderId: string) => void;
  /** Repassado para cada `CardSessaoFeed` da lista de velejos deste perfil —
   * mesmo `setSessaoIdAberta` do contexto que abre o detalhe de sessão de
   * qualquer outro lugar do app (Fase 5 do plano de rede social). */
  onAbrirDetalhe: (sessionId: string) => void;
}

interface RespostaPerfil {
  rider: RiderProfile;
  velejos: SessionFeedItem[];
}

/** `euSigo` a partir da relação — mesmo par usado em BotaoSeguir/lib/social.ts. */
function euSigoNaRelacao(relacao: RelacaoRider): boolean {
  return relacao === 'seguindo' || relacao === 'amigos';
}

/**
 * Perfil público do velejador (seção 4.4 do plano de rede social) — o
 * terceiro passo do ciclo achar → seguir → ver o velejo: a busca (Fase 2)
 * acha, o BotaoSeguir segue, e aqui o velejador vê os velejos de quem seguiu.
 *
 * Modal full-screen por cima (não uma `view` de aba): é aberto de vários
 * lugares diferentes (busca, nome/avatar do card do feed) e nunca é destino
 * de navegação direta — mesmo raciocínio de `ListingDetailModal`/
 * `SpotDetailModal`, os dois modais de detalhe que o app já tem.
 */
export const RiderProfileModal: React.FC<RiderProfileModalProps> = ({
  riderId,
  onClose,
  onAbrirPerfil,
  onAbrirDetalhe,
}) => {
  const { user } = useAuth();
  const [rider, setRider] = useState<RiderProfile | null>(null);
  const [velejos, setVelejos] = useState<SessionFeedItem[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const closeButtonRef = useRef<HTMLButtonElement>(null);

  /*
   * Limpeza síncrona no render, fetch no efeito. Ver lib/useAoMudar.ts: com
   * tudo dentro do useEffect, o modal chegava a pintar UM QUADRO com o perfil
   * do velejador anterior antes de limpar — visível ao abrir dois perfis em
   * seguida.
   */
  useAoMudar(riderId, () => {
    setRider(null);
    setVelejos([]);
    setErro(null);
    setCarregando(riderId !== null);
  });

  useEffect(() => {
    if (!riderId) return;

    let ativo = true;

    (async () => {
      try {
        const res = await fetch(`/api/riders/${riderId}`, { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            (body && typeof body === 'object' && 'error' in body
              ? String((body as { error: unknown }).error)
              : null) || 'Não foi possível carregar o perfil.'
          );
        }
        if (!ativo) return;
        const { rider: r, velejos: v } = body as RespostaPerfil;
        setRider(r);
        setVelejos(v);
      } catch (err) {
        if (ativo) setErro(err instanceof Error ? err.message : 'Falha ao carregar o perfil.');
      } finally {
        if (ativo) setCarregando(false);
      }
    })();

    return () => {
      // Evita aplicar a resposta de um perfil que o velejador já fechou (ou
      // trocou por outro, tocando em dois resultados de busca em sequência).
      ativo = false;
    };
  }, [riderId]);

  // Esc fecha e trava o scroll do fundo — mesmo padrão de ListingDetailModal.
  useEffect(() => {
    if (!riderId) return;
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = anterior;
    };
  }, [riderId, onClose]);

  // Ajusta o contador de seguidores na hora (otimista, igual ao próprio
  // BotaoSeguir) — sem isto, seguir alguém no perfil dele só atualizaria o
  // BOTÃO, deixando "42 seguidores" parado até um refetch completo.
  const handleChangeRelacao = useCallback((novaRelacao: RelacaoRider) => {
    setRider((prev) => {
      if (!prev) return prev;
      const antes = euSigoNaRelacao(prev.relacao);
      const depois = euSigoNaRelacao(novaRelacao);
      const delta = antes === depois ? 0 : depois ? 1 : -1;
      return { ...prev, relacao: novaRelacao, seguidores: Math.max(0, prev.seguidores + delta) };
    });
  }, []);

  if (!riderId) return null;

  const souEuMesmo = rider !== null && user !== null && rider.id === user.id;

  return (
    <div className="fixed inset-0 z-modal flex items-start sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-xs overflow-y-auto">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={rider ? `Perfil de ${rider.name}` : 'Perfil do velejador'}
        className="bg-[#0F172A] text-slate-100 w-full max-w-md sm:rounded-3xl border-slate-800 sm:border shadow-2xl min-h-full sm:min-h-0 sm:my-6 overflow-hidden"
      >
        <div className="sticky top-0 overlay-safe-top bg-[#0F172A]/95 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-2">
          <h2 className="font-black text-sm text-white truncate">{rider ? rider.name : 'Perfil'}</h2>
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            className="min-w-11 min-h-11 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors shrink-0"
            aria-label="Fechar perfil"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {carregando && (
          <div className="py-20 flex flex-col items-center gap-3 text-slate-400">
            <Loader2 size={28} className="animate-spin text-cyan-400" aria-hidden="true" />
            <p className="text-xs font-bold">Carregando perfil...</p>
          </div>
        )}

        {!carregando && erro && !rider && (
          <div className="p-8 text-center space-y-4">
            <AlertTriangle size={26} className="mx-auto text-rose-400" />
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

        {rider && (
          <div className="max-h-[calc(100dvh-56px)] sm:max-h-[80vh] overflow-y-auto">
            {/* Cabeçalho do perfil (seção 4.4 do plano). */}
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-20 h-20 shrink-0 rounded-full bg-slate-800 ring-2 ring-cyan-400 overflow-hidden flex items-center justify-center shadow-md">
                  {rider.avatarUrl ? (
                    <img src={rider.avatarUrl} alt={rider.name} className="w-full h-full object-cover" />
                  ) : (
                    <User size={32} className="text-slate-300" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="font-black text-lg text-white truncate">{rider.name}</h3>
                    <span className="text-xl shrink-0" title={rider.nationality}>
                      {rider.countryFlag}
                    </span>
                  </div>
                  <p className="text-xs font-mono font-bold text-slate-400">#{rider.riderId}</p>
                  <p className="text-xs text-cyan-400 font-bold mt-1 truncate">
                    {rider.riderLevel}
                    {rider.homeSpot ? ` • ${rider.homeSpot}` : ''}
                  </p>
                </div>
              </div>

              {rider.bio && <p className="text-sm text-slate-300 leading-relaxed">{rider.bio}</p>}

              <div className="flex items-center gap-5">
                <div>
                  <span className="font-black text-white text-sm">{rider.seguidores}</span>
                  <span className="text-xs text-slate-400 ml-1">seguidores</span>
                </div>
                <div>
                  <span className="font-black text-white text-sm">{rider.seguindo}</span>
                  <span className="text-xs text-slate-400 ml-1">seguindo</span>
                </div>
              </div>

              {/* Seguir a si mesmo não faz sentido (lib/social.ts, podeSeguir
                  recusaria com 400) — o botão simplesmente não aparece. */}
              {!souEuMesmo && (
                <BotaoSeguir
                  riderId={rider.id}
                  relacao={rider.relacao}
                  onChangeRelacao={handleChangeRelacao}
                  className="w-full justify-center h-11"
                />
              )}
            </div>

            {/* Velejos do perfil — mesmo card do feed (CardSessaoFeed), sem
                tradução nenhuma: a rota já devolve o item na forma de
                SessionFeedItem (ver app/api/riders/[id]/route.ts). */}
            <div className="border-t border-slate-800 px-4 py-4 space-y-3">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider px-1">
                Velejos
              </h4>

              {velejos.length === 0 ? (
                <div className="p-6 rounded-2xl border border-slate-800 bg-[#1E293B]/50 text-center">
                  <Sailboat size={26} className="mx-auto text-slate-500" />
                  <p className="mt-2.5 text-xs text-slate-400">
                    Nenhum velejo visível aqui ainda.
                  </p>
                </div>
              ) : (
                velejos.map((sessao) => (
                  <CardSessaoFeed
                    key={sessao.id}
                    sessao={sessao}
                    onAbrirPerfil={onAbrirPerfil}
                    onAbrirDetalhe={onAbrirDetalhe}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
