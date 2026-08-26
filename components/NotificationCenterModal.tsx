'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  AlertTriangle,
  Bell,
  Check,
  Heart,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Navigation,
  RefreshCw,
  Sparkles,
  Trash2,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import { formatRelativeTime } from '@/lib/chat';
import type { AppNotification } from '@/types';

interface NotificationCenterModalProps {
  aberto: boolean;
  onClose: () => void;
  onAbrirSessao: (sessionId: string) => void;
  onAbrirPerfil: (riderId: string) => void;
  totalChatUnread: number;
  onIrParaChat: () => void;
  onAbrirDownwind?: (downwindId: string) => void;
}

function mensagemNotificacao(n: AppNotification): string {
  switch (n.type) {
    case 'curtida_sessao':
      return `curtiu seu velejo${n.spotName ? ` em ${n.spotName}` : ''}`;
    case 'comentario_sessao':
      return `comentou seu velejo${n.spotName ? ` em ${n.spotName}` : ''}${
        n.commentText ? `: "${n.commentText}"` : ''
      }`;
    case 'resposta_comentario':
      return `respondeu seu comentário${n.commentText ? `: "${n.commentText}"` : ''}`;
    case 'novo_seguidor':
      return 'começou a seguir você';
    case 'convite_downwind':
      return `convidou você para o downwind${n.downwindNome ? ` "${n.downwindNome}"` : ''}`;
  }
}

function iconeNotificacao(type: AppNotification['type']) {
  switch (type) {
    case 'curtida_sessao':
      return <Heart size={14} className="text-rose-400" />;
    case 'comentario_sessao':
    case 'resposta_comentario':
      return <MessageCircle size={14} className="text-cyan-400" />;
    case 'novo_seguidor':
      return <UserPlus size={14} className="text-emerald-400" />;
    case 'convite_downwind':
      return <Navigation size={14} className="text-cyan-400" />;
  }
}

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  aberto,
  onClose,
  onAbrirSessao,
  onAbrirPerfil,
  totalChatUnread,
  onIrParaChat,
  onAbrirDownwind,
}) => {
  const [notificacoes, setNotificacoes] = useState<AppNotification[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [processandoInviteId, setProcessandoInviteId] = useState<string | null>(null);
  const [temNovaVersao, setTemNovaVersao] = useState(false);
  const [atualizandoApp, setAtualizandoApp] = useState(false);
  const [limpandoLidas, setLimpandoLidas] = useState(false);

  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Verifica se há nova versão ao abrir a central
  useEffect(() => {
    if (!aberto || typeof window === 'undefined') return;
    fetch(`/api/version?_t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const initialSha = (window as unknown as { __BUILD_COMMIT__?: string }).__BUILD_COMMIT__;
        if (!initialSha) {
          (window as unknown as { __BUILD_COMMIT__?: string }).__BUILD_COMMIT__ = data.commit;
        } else if (data.commit !== 'local' && initialSha !== 'local' && data.commit !== initialSha) {
          setTemNovaVersao(true);
        }
      })
      .catch(() => {});
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;

    let ativo = true;
    setCarregando(true);
    setErro(null);

    fetch('/api/notifications', { method: 'POST' }).catch(() => {});

    (async () => {
      try {
        const res = await fetch('/api/notifications', { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            (body && typeof body === 'object' && 'error' in body
              ? String((body as { error: unknown }).error)
              : null) || 'Não foi possível carregar as notificações.'
          );
        }
        if (!ativo) return;
        setNotificacoes((body as { notificacoes: AppNotification[] }).notificacoes);
      } catch (err) {
        if (ativo) setErro(err instanceof Error ? err.message : 'Falha ao carregar notificações.');
      } finally {
        if (ativo) setCarregando(false);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
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
  }, [aberto, onClose]);

  const handleAtualizarApp = async () => {
    setAtualizandoApp(true);
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
          await reg.update().catch(() => {});
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      // Ignora falha de cache
    }
    window.location.reload();
  };

  const handleApagarNotificacao = async (id: string) => {
    try {
      setNotificacoes((prev) => prev.filter((n) => n.id !== id));
      await fetch(`/api/notifications?id=${id}`, { method: 'DELETE' });
    } catch {
      // Ignora erro de rede
    }
  };

  const handleLimparLidas = async () => {
    setLimpandoLidas(true);
    try {
      setNotificacoes((prev) => prev.filter((n) => n.readAt === null));
      await fetch('/api/notifications?all=read', { method: 'DELETE' });
    } catch {
      // Ignora erro de rede
    } finally {
      setLimpandoLidas(false);
    }
  };

  if (!aberto) return null;

  const handleTocarNotificacao = (n: AppNotification) => {
    if (n.type === 'convite_downwind') {
      return;
    }
    onClose();
    if (n.type === 'novo_seguidor') {
      onAbrirPerfil(n.actorId);
    } else if (n.sessionId) {
      onAbrirSessao(n.sessionId);
    }
  };

  const handleAceitarConvite = async (inviteId: string, downwindId?: string) => {
    setProcessandoInviteId(inviteId);
    try {
      const res = await fetch(`/api/downwind/invites/${inviteId}/accept`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Falha ao aceitar convite.');

      setNotificacoes((prev) => prev.filter((item) => item.inviteId !== inviteId));
      onClose();
      if (onAbrirDownwind && (downwindId || body.downwindId)) {
        onAbrirDownwind(downwindId || body.downwindId);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao aceitar convite.');
    } finally {
      setProcessandoInviteId(null);
    }
  };

  const handleRecusarConvite = async (inviteId: string) => {
    setProcessandoInviteId(inviteId);
    try {
      const res = await fetch(`/api/downwind/invites/${inviteId}/decline`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Falha ao recusar convite.');

      setNotificacoes((prev) => prev.filter((item) => item.inviteId !== inviteId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao recusar convite.');
    } finally {
      setProcessandoInviteId(null);
    }
  };

  const temLidas = notificacoes.some((n) => n.readAt !== null);

  return (
    <div className="fixed inset-0 z-modal flex items-start sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-xs overflow-y-auto">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Notificações"
        className="bg-[#0F172A] text-slate-100 w-full max-w-md sm:rounded-3xl border-slate-800 sm:border shadow-2xl min-h-full sm:min-h-0 sm:my-6 overflow-hidden"
      >
        <div className="sticky top-0 overlay-safe-top bg-[#0F172A]/95 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-cyan-400" />
            <h2 className="font-black text-sm text-white">Notificações</h2>
          </div>

          <div className="flex items-center gap-2">
            {temLidas && (
              <button
                type="button"
                onClick={handleLimparLidas}
                disabled={limpandoLidas}
                className="text-[11px] font-bold text-slate-400 hover:text-rose-300 flex items-center gap-1 py-1 px-2 rounded-lg hover:bg-slate-800/80 transition-colors"
                title="Apagar notificações lidas"
              >
                <Trash2 size={12} />
                <span>{limpandoLidas ? 'Limpando…' : 'Limpar lidas'}</span>
              </button>
            )}
            <button
              type="button"
              ref={closeButtonRef}
              onClick={onClose}
              className="min-w-9 min-h-9 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors shrink-0"
              aria-label="Fechar notificações"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="max-h-[calc(100dvh-56px)] sm:max-h-[80vh] overflow-y-auto">
          {/* Card fixo de Nova Versão Disponível */}
          {temNovaVersao && (
            <div className="p-3.5 bg-gradient-to-r from-cyan-950/80 to-blue-950/80 border-b border-cyan-500/30 flex items-center justify-between gap-3 animate-in fade-in duration-300">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center shrink-0 border border-cyan-400/30 animate-pulse">
                  <Sparkles size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black text-white leading-tight">Nova versão do KiteNinja</p>
                  <p className="text-[10px] text-cyan-200/80 truncate">Melhorias prontas para instalar</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleAtualizarApp}
                disabled={atualizandoApp}
                className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-slate-950 font-black text-xs shadow-md shadow-cyan-500/30 active:scale-95 transition-all shrink-0 flex items-center gap-1.5"
              >
                <RefreshCw size={12} className={atualizandoApp ? 'animate-spin' : ''} />
                <span>{atualizandoApp ? 'Atualizando…' : 'Atualizar'}</span>
              </button>
            </div>
          )}

          {totalChatUnread > 0 && (
            <button
              type="button"
              onClick={() => {
                onIrParaChat();
                onClose();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors text-left"
            >
              <MessagesSquare size={18} className="text-cyan-300 shrink-0" />
              <span className="text-xs font-bold text-cyan-200">
                Você tem {totalChatUnread} mensagem{totalChatUnread > 1 ? 's' : ''} não lida
                {totalChatUnread > 1 ? 's' : ''} no chat
              </span>
            </button>
          )}

          {carregando && notificacoes.length === 0 && (
            <div className="py-16 flex flex-col items-center gap-3 text-slate-400">
              <div className="w-6 h-6 rounded-full border-2 border-slate-600 border-t-cyan-400 animate-spin" />
              <p className="text-xs font-bold">Carregando notificações...</p>
            </div>
          )}

          {!carregando && erro && notificacoes.length === 0 && (
            <div className="p-8 text-center space-y-3">
              <AlertTriangle size={24} className="mx-auto text-rose-400" />
              <p role="alert" className="text-sm font-bold text-rose-300">
                {erro}
              </p>
            </div>
          )}

          {!carregando && !erro && notificacoes.length === 0 && !temNovaVersao && (
            <div className="p-10 text-center">
              <Bell size={28} className="mx-auto text-slate-600" />
              <p className="mt-3 text-xs text-slate-500">Nenhuma notificação no momento.</p>
            </div>
          )}

          <ul>
            {notificacoes.map((n) => (
              <li key={n.id} className="relative group">
                <div
                  onClick={() => handleTocarNotificacao(n)}
                  className={`w-full flex items-start gap-3 px-4 py-3 border-b border-slate-800/80 text-left transition-colors ${
                    n.type !== 'convite_downwind' ? 'cursor-pointer hover:bg-slate-800/60' : ''
                  } ${n.readAt === null ? 'bg-cyan-500/5' : ''}`}
                >
                  <div className="relative shrink-0">
                    <div className="w-9 h-9 rounded-full bg-slate-800 ring-1 ring-slate-700 overflow-hidden flex items-center justify-center">
                      {n.actorAvatarUrl ? (
                        <img src={n.actorAvatarUrl} alt={n.actorName} className="w-full h-full object-cover" />
                      ) : (
                        <User size={16} className="text-slate-400" />
                      )}
                    </div>
                    <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#0F172A] border border-slate-800 flex items-center justify-center">
                      {iconeNotificacao(n.type)}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1 pr-6">
                    <p className="text-xs text-slate-200 leading-snug break-words">
                      <span className="font-black text-white">{n.actorName}</span> {mensagemNotificacao(n)}
                    </p>
                    <span className="text-[10px] text-slate-500 font-mono">{formatRelativeTime(n.createdAt)}</span>

                    {/* Ações diretas para convite de downwind */}
                    {n.type === 'convite_downwind' && n.inviteId && (
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => handleAceitarConvite(n.inviteId!, n.downwindId)}
                          disabled={processandoInviteId === n.inviteId}
                          className="px-3 py-1.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-black rounded-lg transition-all active:scale-95 flex items-center gap-1"
                        >
                          {processandoInviteId === n.inviteId ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Check size={13} />
                          )}
                          <span>Aceitar</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRecusarConvite(n.inviteId!)}
                          disabled={processandoInviteId === n.inviteId}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg transition-all active:scale-95 flex items-center gap-1"
                        >
                          <X size={13} />
                          <span>Recusar</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Botão de apagar notificação individual */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleApagarNotificacao(n.id);
                    }}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800/80 transition-all opacity-80 sm:opacity-0 group-hover:opacity-100 shrink-0"
                    title="Apagar notificação"
                    aria-label="Apagar notificação"
                  >
                    <Trash2 size={13} />
                  </button>

                  {n.readAt === null && (
                    <span className="mt-1 w-2 h-2 rounded-full bg-cyan-400 shrink-0" aria-label="Não lida" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};