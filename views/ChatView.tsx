'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  Check,
  CheckCheck,
  ChevronLeft,
  Compass,
  Copy,
  Flame,
  Globe,
  Loader2,
  MapPin,
  MessageSquare,
  Radio,
  Send,
  Sparkles,
  Trash2,
  User,
  Users,
  Wind,
} from 'lucide-react';
import { useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';
import {
  CHAT_TEXT_MAX,
  GENERAL_ROOM,
  formatClockTime,
  formatRelativeTime,
  isPresenceOnline,
  sanitizeMessageText,
  shouldGroupWithPrevious,
  spotRoomName,
} from '../lib/chat';
import { ChatMessage, OnlineRider } from '../types';

/** Busca mensagens a cada 4s para conversa fluida */
const POLL_MS = 4_000;

/** Heartbeat de presença a cada 25s */
const HEARTBEAT_MS = 25_000;

/** Tolerância para considerar que o velejador está no fim da conversa */
const BOTTOM_SLACK_PX = 90;

type Tab = 'conversa' | 'online';

/** Atalhos rápidos de kitesurf para envio com 1 toque */
const QUICK_KITE_SHORTCUTS = [
  { label: '💨 Vento top!', text: '💨 Vento tá muito top por aqui! Alguém na água?' },
  { label: '🪁 Partiu velejar!', text: '🪁 Montando o kite agora! Partiu velejar!' },
  { label: '🌊 Maré subindo', text: '🌊 Maré subindo rápido, condição ficando perfeita.' },
  { label: '🤙 Bora pro mar!', text: '🤙 Bora pro mar galera!' },
  { label: '⚠️ Alerta no pico', text: '⚠️ Atenção galera: vento com rajadas fortes e mar mexido.' },
  { label: '🏄 Downwind', text: '🏄 Quem topa um downwind hoje?' },
  { label: '☀️ Clima perfeito', text: '☀️ Solzão e terral constante!' },
];

/** Formata data para o divisor de dia no chat */
function formatDayDivider(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) return 'Hoje';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return 'Ontem';

  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
}

export const ChatView: React.FC = () => {
  const { spots, beachMode, setActiveTab } = useKiteData();
  const { user } = useAuth();

  const [tab, setTab] = useState<Tab>('conversa');
  const [room, setRoom] = useState<string>(GENERAL_ROOM);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [online, setOnline] = useState<OnlineRider[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [draft, setDraft] = useState('');
  const [atSpotId, setAtSpotId] = useState<string>('');
  const [unread, setUnread] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sinceRef = useRef<string | null>(null);
  const roomRef = useRef<string>(GENERAL_ROOM);
  const atSpotRef = useRef<string>('');
  const atBottomRef = useRef(true);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    atSpotRef.current = atSpotId;
  }, [atSpotId]);

  const nowTick = useNowTick();

  const scrollToEnd = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current;
    if (el) {
      if (behavior === 'smooth') {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } else {
        el.scrollTop = el.scrollHeight;
      }
      atBottomRef.current = true;
      setUnread(0);
    }
    if (endRef.current) {
      endRef.current.scrollIntoView({ behavior, block: 'end' });
    }
  }, []);

  // Adapta o chat dinamicamente ao teclado virtual no iOS/Android
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;

    const updateHeight = () => {
      const kh = window.innerHeight - vv.height;
      const open = kh > 130;
      setKeyboardHeight(open ? Math.round(kh) : 0);
      if (open) {
        requestAnimationFrame(() => scrollToEnd('auto'));
        setTimeout(() => scrollToEnd('smooth'), 120);
        setTimeout(() => scrollToEnd('smooth'), 280);
      }
    };

    vv.addEventListener('resize', updateHeight);
    vv.addEventListener('scroll', updateHeight);
    return () => {
      vv.removeEventListener('resize', updateHeight);
      vv.removeEventListener('scroll', updateHeight);
    };
  }, [scrollToEnd]);

  /** Marca se o velejador está no fim; autoriza o auto-scroll */
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distancia = el.scrollHeight - el.scrollTop - el.clientHeight;
    const noFim = distancia <= BOTTOM_SLACK_PX;
    atBottomRef.current = noFim;
    if (noFim) setUnread(0);
  }, []);

  /** Carga inicial da sala */
  const loadRoom = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    sinceRef.current = null;

    try {
      const res = await fetch(`/api/chat/messages?room=${encodeURIComponent(target)}`, {
        cache: 'no-store',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? 'Não foi possível carregar a conversa.');

      const lista = (body.messages ?? []) as ChatMessage[];
      setMessages(lista);
      sinceRef.current = body.latestAt ?? null;
      setUnread(0);
      atBottomRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha de conexão.');
    } finally {
      setLoading(false);
    }
  }, []);

  /** Busca incremental de mensagens */
  const pollMessages = useCallback(async () => {
    const target = roomRef.current;
    const since = sinceRef.current;
    if (!since) return;

    try {
      const res = await fetch(
        `/api/chat/messages?room=${encodeURIComponent(target)}&since=${encodeURIComponent(since)}`,
        { cache: 'no-store' }
      );
      if (!res.ok) return;
      const body = await res.json().catch(() => null);
      if (!body) return;

      if (roomRef.current !== target) return;

      const novas = (body.messages ?? []) as ChatMessage[];
      if (novas.length === 0) return;

      setMessages((prev) => {
        const vistos = new Set(prev.map((m) => m.id));
        return [...prev, ...novas.filter((m) => !vistos.has(m.id))];
      });

      if (body.latestAt) sinceRef.current = body.latestAt;

      if (atBottomRef.current) {
        requestAnimationFrame(() => scrollToEnd('smooth'));
      } else {
        const deOutros = novas.filter((m) => m.userId !== user?.id).length;
        if (deOutros > 0) setUnread((n) => n + deOutros);
      }

      setError(null);
    } catch {
      // Ignora falhas temporárias de rede
    }
  }, [scrollToEnd, user?.id]);

  const loadOnline = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/presence', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json().catch(() => null);
      if (body) setOnline((body.online ?? []) as OnlineRider[]);
    } catch {
      // Ignora falhas de presença
    }
  }, []);

  const sendHeartbeat = useCallback(async () => {
    try {
      await fetch('/api/chat/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: roomRef.current,
          atSpotId: atSpotRef.current || null,
        }),
      });
    } catch {
      // Ignora falhas de heartbeat
    }
  }, []);

  // Troca de sala
  useEffect(() => {
    loadRoom(room).then(() => {
      scrollToEnd('auto');
    });
  }, [room, loadRoom, scrollToEnd]);

  // Garante que SEMPRE abra nas últimas mensagens (rolagem para o final)
  useEffect(() => {
    if (!loading && messages.length > 0) {
      scrollToEnd('auto');
      const t1 = setTimeout(() => scrollToEnd('auto'), 40);
      const t2 = setTimeout(() => scrollToEnd('auto'), 150);
      const t3 = setTimeout(() => scrollToEnd('auto'), 350);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [loading, room, messages.length, scrollToEnd]);

  // Polling e heartbeat sincronizados com a visibilidade da tela
  useEffect(() => {
    let pollId: ReturnType<typeof setInterval> | null = null;
    let beatId: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (pollId !== null) clearInterval(pollId);
      if (beatId !== null) clearInterval(beatId);
      pollId = null;
      beatId = null;
    };

    const start = () => {
      stop();
      pollId = setInterval(() => {
        pollMessages();
        loadOnline();
      }, POLL_MS);
      beatId = setInterval(sendHeartbeat, HEARTBEAT_MS);
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        pollMessages();
        loadOnline();
        sendHeartbeat();
        start();
      }
    };

    if (!document.hidden) {
      loadOnline();
      sendHeartbeat();
      start();
    }

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [pollMessages, loadOnline, sendHeartbeat]);

  useEffect(() => {
    sendHeartbeat().then(loadOnline);
  }, [atSpotId, sendHeartbeat, loadOnline]);

  const handleSend = async (customText?: string) => {
    const textToSend = customText ?? draft;
    const clean = sanitizeMessageText(textToSend);
    if (!clean.ok) {
      setSendError(clean.error);
      return;
    }
    if (sending) return;

    setSending(true);
    setSendError(null);

    // Otimista: limpa o rascunho de imediato
    if (!customText) setDraft('');

    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, text: clean.text }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setSendError(body?.error ?? 'Não foi possível enviar a mensagem.');
        if (!customText) setDraft(textToSend);
        return;
      }

      const enviada = body.message as { id: string; userId: string; text: string; createdAt: string };
      const local: ChatMessage = {
        id: enviada.id,
        userId: enviada.userId,
        userName: user?.name ?? 'Você',
        userAvatar: user?.avatarUrl,
        userRiderId: user?.riderId ?? '',
        text: enviada.text,
        createdAt: enviada.createdAt,
      };

      setMessages((prev) => (prev.some((m) => m.id === local.id) ? prev : [...prev, local]));
      if (enviada.createdAt > (sinceRef.current ?? '')) sinceRef.current = enviada.createdAt;
      requestAnimationFrame(() => scrollToEnd('smooth'));
    } catch {
      setSendError('Falha de conexão. Tente novamente.');
      if (!customText) setDraft(textToSend);
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Apagar esta mensagem?')) return;

    const anterior = messages;
    setMessages((prev) => prev.filter((m) => m.id !== id));

    try {
      const res = await fetch(`/api/chat/messages/${id}`, { method: 'DELETE' });
      if (!res.ok) setMessages(anterior);
    } catch {
      setMessages(anterior);
    }
  };

  const handleCopy = (text: string, id: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback silencioso
    }
  };

  const roomLabel = useMemo(() => {
    if (room === GENERAL_ROOM) return 'Geral';
    const id = room.startsWith('spot:') ? room.slice(5) : room;
    return spots.find((s) => s.id === id)?.name ?? id;
  }, [room, spots]);

  const onlineCount = useMemo(
    () => online.filter((o) => isPresenceOnline(o.lastSeenAt, nowTick)).length,
    [online, nowTick]
  );

  const cardBg = beachMode ? 'bg-[#020617] border-slate-800' : 'bg-[#1E293B] border-slate-700/80';

  // Lista dos principais spots para troca rápida de sala no carrossel horizontal
  const quickRooms = useMemo(() => {
    const list = [{ id: GENERAL_ROOM, name: 'Geral', icon: '🌍' }];
    for (const s of spots.slice(0, 8)) {
      list.push({ id: spotRoomName(s.id), name: s.name, icon: '🏖️' });
    }
    return list;
  }, [spots]);

  return (
    <div className="h-full flex flex-col overflow-hidden max-w-lg mx-auto w-full bg-[#0B1220]">
      {/* 1. Header Fixo: Abas e Seletor de Sala */}
      <div className="shrink-0 bg-[#0F172A] border-b border-slate-800/90 px-3 pt-2 pb-2 space-y-2 z-10 shadow-xs">
        {/* Topo com botão Voltar e Toggle Conversa vs Online */}
        <div className="flex items-center gap-2" role="tablist" aria-label="Seções do chat">
          <button
            type="button"
            onClick={() => setActiveTab('favoritos')}
            className="h-10 px-2.5 rounded-xl bg-[#1E293B] border border-slate-700/80 text-slate-300 hover:text-white flex items-center justify-center transition-all active:scale-95 shrink-0"
            title="Voltar aos Spots"
            aria-label="Voltar para Spots"
          >
            <ChevronLeft size={20} className="stroke-[2.5]" />
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={tab === 'conversa'}
            onClick={() => setTab('conversa')}
            className={`flex-1 h-10 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all ${
              tab === 'conversa'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25 scale-[1.01]'
                : 'bg-[#1E293B] text-slate-300 border border-slate-700/80 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <MessageSquare size={15} className="shrink-0" />
            <span>Chat ({roomLabel})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'online'}
            onClick={() => setTab('online')}
            className={`flex-1 h-10 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all ${
              tab === 'online'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/25 scale-[1.01]'
                : 'bg-[#1E293B] text-slate-300 border border-slate-700/80 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <Radio size={15} className="shrink-0" />
            <span>Na Água</span>
            {onlineCount > 0 && (
              <span
                className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                  tab === 'online' ? 'bg-slate-950/25 text-slate-950' : 'bg-emerald-500 text-slate-950 animate-pulse'
                }`}
              >
                {onlineCount}
              </span>
            )}
          </button>
        </div>

        {/* Carrossel de Pílulas Rápidas de Salas */}
        {tab === 'conversa' && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar pt-0.5">
            {quickRooms.map((qr) => {
              const isSelected = room === qr.id;
              return (
                <button
                  key={qr.id}
                  type="button"
                  onClick={() => setRoom(qr.id)}
                  className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-bold flex items-center gap-1.2 transition-all ${
                    isSelected
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50 shadow-xs'
                      : 'bg-slate-800/80 text-slate-400 border border-slate-700/60 hover:text-slate-200'
                  }`}
                >
                  <span>{qr.icon}</span>
                  <span>{qr.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. Conteúdo Principal */}
      {tab === 'conversa' ? (
        <>
          {/* Lista de Mensagens */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-1"
            aria-live="polite"
            aria-label={`Mensagens da sala ${roomLabel}`}
          >
            {loading && (
              <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-xs font-bold">
                <Loader2 size={18} className="animate-spin text-cyan-400" />
                <span>Carregando mensagens da sala...</span>
              </div>
            )}

            {!loading && error && (
              <div className="mt-6 p-5 rounded-2xl border border-rose-500/40 bg-rose-500/10 text-center">
                <AlertTriangle size={26} className="mx-auto text-rose-400" />
                <p className="mt-2.5 font-black text-slate-100 text-sm">Sem conexão com o chat</p>
                <p className="mt-1 text-xs text-slate-300">{error}</p>
                <button
                  type="button"
                  onClick={() => loadRoom(room)}
                  className="mt-3.5 px-5 h-10 rounded-xl bg-cyan-500 text-slate-950 font-black text-xs active:scale-95 transition-transform"
                >
                  Tentar novamente
                </button>
              </div>
            )}

            {!loading && !error && messages.length === 0 && (
              <div className={`mt-8 p-6 rounded-2xl border text-center ${cardBg}`}>
                <div className="w-12 h-12 mx-auto rounded-full bg-cyan-500/10 border border-cyan-400/30 flex items-center justify-center text-cyan-400">
                  <Wind size={24} />
                </div>
                <p className="mt-3 font-black text-slate-100 text-sm">Sala {roomLabel} aberta!</p>
                <p className="mt-1.5 text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
                  Compartilhe as condições de vento, maré e tamanho de kite agora mesmo com os outros velejadores.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleSend('💨 Vento constante e maré subindo por aqui!')}
                    className="px-3 py-1.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-bold hover:bg-cyan-500/25 transition-colors"
                  >
                    💨 Relatar vento agora
                  </button>
                </div>
              </div>
            )}

            {!loading &&
              !error &&
              messages.map((m, i) => {
                const mine = m.userId === user?.id;
                const prev = messages[i - 1];
                const grouped = shouldGroupWithPrevious(prev, m);
                const showDayDivider =
                  !prev ||
                  new Date(m.createdAt).toDateString() !== new Date(prev.createdAt).toDateString();

                return (
                  <React.Fragment key={m.id}>
                    {/* Divisor de Dia */}
                    {showDayDivider && (
                      <div className="flex items-center justify-center my-3">
                        <span className="px-3 py-1 rounded-full bg-slate-800/90 border border-slate-700/80 text-[10px] font-black text-slate-300 tracking-wide uppercase shadow-xs">
                          {formatDayDivider(m.createdAt)}
                        </span>
                      </div>
                    )}

                    <div
                      className={`flex items-end gap-2 group ${
                        mine ? 'justify-end' : 'justify-start'
                      } ${grouped ? 'mt-0.5' : 'mt-2.5'}`}
                    >
                      {/* Avatar do Autor (apenas em mensagens de outros) */}
                      {!mine && (
                        <div className="w-8 h-8 shrink-0 mb-0.5">
                          {!grouped ? (
                            <div className="w-8 h-8 rounded-full bg-slate-800 ring-2 ring-cyan-400/60 overflow-hidden flex items-center justify-center shadow-xs">
                              {m.userAvatar ? (
                                <img
                                  src={m.userAvatar}
                                  alt={m.userName}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <User size={14} className="text-slate-300" />
                              )}
                            </div>
                          ) : (
                            <div className="w-8" />
                          )}
                        </div>
                      )}

                      {/* Balão de Mensagem */}
                      <div
                        className={`max-w-[82%] min-w-[90px] flex flex-col ${
                          mine ? 'items-end' : 'items-start'
                        }`}
                      >
                        {!grouped && !mine && (
                          <div className="flex items-center gap-1.5 mb-0.5 px-1">
                            <span className="text-[11px] font-black text-emerald-300">
                              {m.userName}
                            </span>
                            {m.userRiderId && (
                              <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-800/80 px-1.5 py-0.2 rounded-md">
                                #{m.userRiderId}
                              </span>
                            )}
                          </div>
                        )}

                        <div
                          className={`relative px-3.5 py-2 rounded-2xl border text-sm transition-all shadow-xs ${
                            mine
                              ? 'bg-linear-to-br from-cyan-600/30 to-cyan-500/20 border-cyan-500/50 text-white rounded-br-xs'
                              : 'bg-slate-800/90 border-slate-700 text-slate-100 rounded-bl-xs'
                          }`}
                        >
                          {/* Texto da Mensagem */}
                          <p className="leading-snug whitespace-pre-wrap break-words text-[13.5px] select-text">
                            {m.text}
                          </p>

                          {/* Rodapé do Balão: Horário, Ações e Status */}
                          <div className="mt-1 flex items-center justify-end gap-1.5 select-none">
                            {copiedId === m.id ? (
                              <span className="text-[10px] text-cyan-300 font-bold flex items-center gap-0.5">
                                <Check size={11} /> Copiado
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleCopy(m.text, m.id)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-slate-200 transition-opacity"
                                title="Copiar texto"
                              >
                                <Copy size={11} />
                              </button>
                            )}

                            <span
                              className="text-[10px] text-slate-400 font-mono tracking-tight"
                              title={formatRelativeTime(m.createdAt, nowTick)}
                            >
                              {formatClockTime(m.createdAt)}
                            </span>

                            {mine && (
                              <span className="text-cyan-400" title="Entregue">
                                <CheckCheck size={13} className="stroke-[2.5]" />
                              </span>
                            )}

                            {mine && (
                              <button
                                type="button"
                                onClick={() => handleDelete(m.id)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-rose-400 transition-opacity ml-0.5"
                                title="Apagar mensagem"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}

            <div ref={endRef} />
          </div>

          {/* Botão Flutuante: Novas Mensagens */}
          {unread > 0 && (
            <div className="shrink-0 px-3 pb-2 flex justify-center z-10">
              <button
                type="button"
                onClick={() => scrollToEnd('smooth')}
                className="flex items-center gap-2 px-4 h-9 rounded-full bg-cyan-500 text-slate-950 font-black text-xs shadow-lg shadow-cyan-500/40 active:scale-95 transition-all animate-bounce"
              >
                <ArrowDown size={14} className="stroke-[3]" />
                <span>
                  {unread} nova{unread > 1 ? 's' : ''} mensage{unread > 1 ? 'ns' : 'm'}
                </span>
              </button>
            </div>
          )}

          {/* 3. Barra de Atalhos Rápidos (Kiter Bar) */}
          <div className="shrink-0 bg-[#0A0F1D] border-t border-slate-800/80 px-2.5 py-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="text-[10px] font-black text-cyan-400/80 uppercase tracking-wider shrink-0 flex items-center gap-1 pl-1">
              <Sparkles size={11} /> Rápido:
            </span>
            {QUICK_KITE_SHORTCUTS.map((sc, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSend(sc.text)}
                className="shrink-0 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 text-slate-300 hover:text-white text-[11px] font-semibold transition-all active:scale-95"
              >
                {sc.label}
              </button>
            ))}
          </div>

          {/* 4. Campo de Digitação Fixo e Estável com Elevação Dinâmica do Teclado */}
          <div
            style={{
              paddingBottom: keyboardHeight > 0 ? `${keyboardHeight + 6}px` : undefined,
            }}
            className={`shrink-0 bg-[#0F172A] border-t border-slate-800 px-3 pt-2.5 shadow-lg transition-[padding] duration-150 ${
              keyboardHeight > 0 ? 'pb-2' : 'pb-18 safe-area-pb'
            }`}
          >
            {sendError && (
              <p
                role="alert"
                className="mb-2 text-[11px] text-rose-300 bg-rose-500/15 border border-rose-500/30 rounded-xl px-3 py-1.5 flex items-center justify-between"
              >
                <span>{sendError}</span>
                <button
                  type="button"
                  onClick={() => setSendError(null)}
                  className="text-rose-300 font-bold hover:text-rose-100"
                >
                  ✕
                </button>
              </p>
            )}

            <div className="flex items-center gap-2">
              <div className="flex-1 relative min-w-0">
                <input
                  ref={inputRef}
                  type="text"
                  value={draft}
                  maxLength={CHAT_TEXT_MAX}
                  onFocus={() => {
                    setTimeout(() => scrollToEnd('smooth'), 120);
                    setTimeout(() => scrollToEnd('smooth'), 280);
                  }}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (sendError) setSendError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={`Mensagem em ${roomLabel}...`}
                  className="w-full h-11 px-3.5 pr-10 rounded-xl bg-[#1E293B] border border-slate-700 text-[15px] text-white placeholder-slate-400 focus:outline-hidden focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/50 transition-all"
                />

                {draft.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft('');
                      inputRef.current?.focus();
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs p-1"
                    title="Limpar texto"
                  >
                    ✕
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => handleSend()}
                disabled={sending || draft.trim().length === 0}
                className="w-11 h-11 shrink-0 rounded-xl bg-cyan-500 text-slate-950 font-black flex items-center justify-center hover:bg-cyan-400 active:scale-95 transition-all shadow-md shadow-cyan-500/25 disabled:opacity-40 disabled:active:scale-100"
                aria-label="Enviar mensagem"
              >
                {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </div>

            {/* Contador de Caracteres Discreto */}
            {draft.length > CHAT_TEXT_MAX - 80 && (
              <div className="mt-1 flex justify-end">
                <span className="text-[10px] font-mono text-slate-400">
                  {draft.length}/{CHAT_TEXT_MAX}
                </span>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Aba Online: Quem está na água */
        <OnlinePanel
          online={online}
          now={nowTick}
          cardBg={cardBg}
          atSpotId={atSpotId}
          onChangeSpot={setAtSpotId}
          spots={spots.map((s) => ({ id: s.id, name: s.name, location: s.location }))}
          onRetry={loadOnline}
          onWave={(userName) => {
            setTab('conversa');
            handleSend(`🤙 Salve ${userName}! Bons ventos!`);
          }}
        />
      )}
    </div>
  );
};

/** Relógio que avança a cada 20s para atualizar tempos relativos */
function useNowTick(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(id);
  }, []);

  return now;
}

interface OnlinePanelProps {
  online: OnlineRider[];
  now: Date;
  cardBg: string;
  atSpotId: string;
  onChangeSpot: (id: string) => void;
  spots: { id: string; name: string; location: string }[];
  onRetry: () => void;
  onWave: (userName: string) => void;
}

/** Aba "Online / Na Água Agora" */
const OnlinePanel: React.FC<OnlinePanelProps> = ({
  online,
  now,
  cardBg,
  atSpotId,
  onChangeSpot,
  spots,
  onRetry,
  onWave,
}) => {
  const ativos = online.filter((o) => isPresenceOnline(o.lastSeenAt, now));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 pb-24 space-y-3">
      {/* Card: Marcar meu spot atual */}
      <div className={`p-4 rounded-2xl border ${cardBg} shadow-sm`}>
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <MapPin size={16} />
          </div>
          <div>
            <h3 className="text-xs font-black text-slate-100 uppercase tracking-wide">
              Estou na Praia / No Spot
            </h3>
            <p className="text-[11px] text-slate-400">
              Marque onde você está velejando agora para os outros te encontrarem.
            </p>
          </div>
        </div>

        <div className="mt-3">
          <select
            value={atSpotId}
            onChange={(e) => onChangeSpot(e.target.value)}
            className="w-full h-11 px-3 rounded-xl bg-[#0F172A] border border-slate-700 text-slate-100 font-bold text-sm focus:outline-hidden focus:border-emerald-400"
          >
            <option value="">Não estou em nenhum spot no momento</option>
            {spots.map((s) => (
              <option key={s.id} value={s.id}>
                📍 {s.name} — {s.location}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Cabeçalho da Lista */}
      <div className="flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <h3 className="text-xs font-black text-slate-300 uppercase tracking-wider">
            Velejadores Conectados ({ativos.length})
          </h3>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-bold text-cyan-400 hover:text-cyan-300 h-8 px-2 flex items-center transition-colors"
        >
          Atualizar
        </button>
      </div>

      {/* Lista de Velejadores Ativos */}
      {ativos.length === 0 ? (
        <div className={`p-8 rounded-2xl border text-center ${cardBg}`}>
          <div className="w-12 h-12 mx-auto rounded-full bg-slate-800 flex items-center justify-center text-slate-500 mb-3">
            <Users size={24} />
          </div>
          <p className="font-black text-slate-100 text-sm">Nenhum velejador na água agora</p>
          <p className="mt-1.5 text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
            Quando você ou outros membros abrirem o KiteNinja na praia, aparecerão aqui em tempo real.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {ativos.map((o) => (
            <div
              key={o.userId}
              className={`p-3 rounded-2xl border flex items-center gap-3 transition-all hover:border-slate-600 ${cardBg}`}
            >
              <div className="relative shrink-0">
                <div className="w-11 h-11 rounded-full bg-slate-800 ring-2 ring-emerald-400/80 overflow-hidden flex items-center justify-center shadow-xs">
                  {o.userAvatar ? (
                    <img
                      src={o.userAvatar}
                      alt={o.userName}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <User size={20} className="text-slate-300" />
                  )}
                </div>
                <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-400 rounded-full ring-2 ring-[#1E293B]" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-black text-sm text-white truncate">{o.userName}</span>
                  {o.countryFlag && <span className="text-sm shrink-0">{o.countryFlag}</span>}
                </div>
                <p className="text-[11px] text-slate-400 truncate">
                  {o.userLevel ?? 'Velejador'} • #{o.userRiderId}
                </p>
                {o.atSpotName ? (
                  <p className="text-[11px] font-bold text-emerald-400 flex items-center gap-1 mt-0.5 truncate">
                    <MapPin size={11} className="shrink-0" />
                    <span className="truncate">{o.atSpotName}</span>
                  </p>
                ) : (
                  <p className="text-[10px] text-slate-500 mt-0.5">Online no app</p>
                )}
              </div>

              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <span className="text-[10px] font-mono text-slate-400">
                  {formatRelativeTime(o.lastSeenAt, now)}
                </span>
                <button
                  type="button"
                  onClick={() => onWave(o.userName)}
                  className="px-2.5 py-1 rounded-full bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-[11px] font-bold active:scale-95 transition-all"
                  title={`Mandar um salve para ${o.userName}`}
                >
                  Acenar 🤙
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
