'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  Loader2,
  MapPin,
  MessageSquare,
  Radio,
  Send,
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

/** Busca mensagens a cada 5s. Chat sem tempo real precisa parecer vivo. */
const POLL_MS = 5_000;

/**
 * Heartbeat a cada 30s, contra uma janela de presença de 2 min: cabem quatro
 * batidas na janela, então perder uma no 3G da praia não tira ninguém da lista.
 */
const HEARTBEAT_MS = 30_000;

/** Tolerância para considerar que o velejador está "no fim" da conversa. */
const BOTTOM_SLACK_PX = 80;

type Tab = 'conversa' | 'online';

export const ChatView: React.FC = () => {
  const { spots, beachMode } = useKiteData();
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  /**
   * Refs em vez de state para o que o polling lê.
   *
   * O intervalo é registrado uma vez; se ele dependesse de `messages` ou de
   * `atBottom` via closure, cada mensagem nova recriaria o timer — e um
   * `setInterval` recriado a cada 5s nunca chega a disparar de forma estável.
   */
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

  const scrollToEnd = useCallback((behavior: ScrollBehavior = 'smooth') => {
    endRef.current?.scrollIntoView({ behavior, block: 'end' });
    atBottomRef.current = true;
    setUnread(0);
  }, []);

  /** Marca se o velejador está no fim; é o que autoriza o auto-scroll. */
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distancia = el.scrollHeight - el.scrollTop - el.clientHeight;
    const noFim = distancia <= BOTTOM_SLACK_PX;
    atBottomRef.current = noFim;
    if (noFim) setUnread(0);
  }, []);

  /**
   * Carga inicial da sala (sem `since`): traz as últimas mensagens e ancora no
   * fim. Trocar de sala precisa zerar o cursor, senão o `since` da sala antiga
   * filtraria a nova e a conversa apareceria vazia.
   */
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

  /**
   * Busca incremental. Só o que é novo desde `sinceRef` — é o que mantém o
   * payload pequeno o suficiente para rodar a cada 5s no 3G.
   */
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

      // A resposta pode chegar depois de o velejador trocar de sala: descartar
      // evita mensagens da sala antiga aparecerem na nova.
      if (roomRef.current !== target) return;

      const novas = (body.messages ?? []) as ChatMessage[];
      if (novas.length === 0) return;

      setMessages((prev) => {
        // Dedup por id: o próprio POST já inseriu a mensagem na lista, e sem
        // isso ela apareceria duplicada quando o polling a trouxesse de volta.
        const vistos = new Set(prev.map((m) => m.id));
        const merge = [...prev, ...novas.filter((m) => !vistos.has(m.id))];
        return merge;
      });

      if (body.latestAt) sinceRef.current = body.latestAt;

      // Se o velejador subiu para ler o histórico, não arrastamos a tela dele.
      if (atBottomRef.current) {
        // rAF para o scroll acontecer depois do React pintar as novas linhas.
        requestAnimationFrame(() => scrollToEnd('smooth'));
      } else {
        const deOutros = novas.filter((m) => m.userId !== user?.id).length;
        if (deOutros > 0) setUnread((n) => n + deOutros);
      }

      setError(null);
    } catch {
      // Falha de polling é silenciosa: o sinal cai e volta na praia, e um erro
      // vermelho piscando a cada 5s seria pior que a lacuna momentânea.
    }
  }, [scrollToEnd, user?.id]);

  const loadOnline = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/presence', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json().catch(() => null);
      if (body) setOnline((body.online ?? []) as OnlineRider[]);
    } catch {
      // Idem: mantém a última lista conhecida em vez de esvaziar a tela.
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
      // Heartbeat perdido só significa aparecer offline por um ciclo.
    }
  }, []);

  // Troca de sala: recarrega do zero e ancora no fim.
  useEffect(() => {
    loadRoom(room).then(() => {
      requestAnimationFrame(() => scrollToEnd('auto'));
    });
  }, [room, loadRoom, scrollToEnd]);

  /**
   * Polling e heartbeat.
   *
   * Pausa quando `document.hidden`: na praia, com 3G e bateria contada, uma aba
   * em background buscando a cada 5s só queima dados e energia sem ninguém para
   * ler o resultado. No `visibilitychange` de volta, buscamos na hora (para não
   * esperar o próximo tick) e religamos os timers.
   *
   * Todos os timers e o listener são removidos no unmount — deixar um interval
   * vivo aqui manteria a aba fazendo fetch depois de sair da tela do chat.
   */
  useEffect(() => {
    let pollId: ReturnType<typeof setInterval> | null = null;
    let beatId: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (pollId !== null) {
        clearInterval(pollId);
        pollId = null;
      }
      if (beatId !== null) {
        clearInterval(beatId);
        beatId = null;
      }
    };

    const start = () => {
      stop(); // nunca acumular dois intervalos do mesmo tipo
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
        // Recupera o atraso acumulado enquanto estava em background.
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

  // Marcar/desmarcar o spot precisa refletir na lista dos outros na hora, sem
  // esperar até 30s pelo próximo heartbeat.
  useEffect(() => {
    sendHeartbeat().then(loadOnline);
  }, [atSpotId, sendHeartbeat, loadOnline]);

  const handleSend = async () => {
    // Validamos aqui com a MESMA função do servidor: o botão desabilitado é
    // cortesia, a garantia continua sendo a rota.
    const clean = sanitizeMessageText(draft);
    if (!clean.ok) {
      setSendError(clean.error);
      return;
    }
    if (sending) return;

    setSending(true);
    setSendError(null);

    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, text: clean.text }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        // 429 é o rate limit: a mensagem do servidor já explica a espera.
        setSendError(body?.error ?? 'Não foi possível enviar.');
        return;
      }

      setDraft('');

      // O POST devolve só id/createdAt; nome e avatar do próprio autor já estão
      // na sessão do cliente, então montamos o balão sem outro round-trip.
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
      // Quem acabou de escrever quer ver o que escreveu, mesmo tendo rolado antes.
      if (enviada.createdAt > (sinceRef.current ?? '')) sinceRef.current = enviada.createdAt;
      requestAnimationFrame(() => scrollToEnd('smooth'));
    } catch {
      setSendError('Falha de conexão. Tente de novo.');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Apagar esta mensagem?')) return;

    // Otimista: o balão sai na hora e volta se o servidor recusar.
    const anterior = messages;
    setMessages((prev) => prev.filter((m) => m.id !== id));

    try {
      const res = await fetch(`/api/chat/messages/${id}`, { method: 'DELETE' });
      if (!res.ok) setMessages(anterior);
    } catch {
      setMessages(anterior);
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

  return (
    <div className="flex flex-col app-viewport max-w-lg mx-auto w-full">
      {/* Abas + seletor de sala */}
      <div className={`shrink-0 border-b ${beachMode ? 'border-slate-800' : 'border-slate-800'} px-3 pt-2 pb-2.5 space-y-2`}>
        <div className="flex items-center gap-2" role="tablist" aria-label="Seções do chat">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'conversa'}
            onClick={() => setTab('conversa')}
            className={`flex-1 min-h-11 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-colors ${
              tab === 'conversa'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                : 'bg-[#1E293B] text-slate-300 border border-slate-700 hover:text-white'
            }`}
          >
            <MessageSquare size={15} />
            <span>Conversa</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'online'}
            onClick={() => setTab('online')}
            className={`flex-1 min-h-11 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-colors ${
              tab === 'online'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                : 'bg-[#1E293B] text-slate-300 border border-slate-700 hover:text-white'
            }`}
          >
            <Radio size={15} />
            <span>Online</span>
            {onlineCount > 0 && (
              <span
                className={`ml-0.5 px-1.5 rounded-full text-[10px] font-black ${
                  tab === 'online' ? 'bg-slate-950/25 text-slate-950' : 'bg-emerald-500 text-slate-950'
                }`}
              >
                {onlineCount}
              </span>
            )}
          </button>
        </div>

        <label className="block">
          <span className="sr-only">Escolher sala do chat</span>
          <select
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            className="w-full min-h-11 px-3 rounded-xl bg-[#0F172A] border border-slate-700 text-slate-100 font-bold focus:outline-hidden focus:border-cyan-400"
          >
            <option value={GENERAL_ROOM}>Sala Geral — todos os velejadores</option>
            {spots.map((s) => (
              <option key={s.id} value={spotRoomName(s.id)}>
                {s.name} — {s.location}
              </option>
            ))}
          </select>
        </label>
      </div>

      {tab === 'conversa' ? (
        <>
          {/* Lista de mensagens */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-1.5"
            aria-live="polite"
            aria-label={`Mensagens da sala ${roomLabel}`}
          >
            {loading && (
              <div className="flex items-center justify-center gap-2 py-10 text-slate-400 text-xs font-bold">
                <Loader2 size={16} className="animate-spin text-cyan-400" />
                <span>Carregando a conversa...</span>
              </div>
            )}

            {!loading && error && (
              <div className={`mt-6 p-5 rounded-2xl border border-rose-500/40 bg-rose-500/10 text-center`}>
                <AlertTriangle size={26} className="mx-auto text-rose-400" />
                <p className="mt-2.5 font-black text-slate-100 text-sm">Sem conexão com a sala</p>
                <p className="mt-1 text-xs text-slate-300">{error}</p>
                <button
                  type="button"
                  onClick={() => loadRoom(room)}
                  className="mt-3.5 px-5 min-h-11 rounded-xl bg-cyan-500 text-slate-950 font-black text-xs active:scale-95 transition-transform"
                >
                  Tentar de novo
                </button>
              </div>
            )}

            {!loading && !error && messages.length === 0 && (
              <div className={`mt-6 p-6 rounded-2xl border text-center ${cardBg}`}>
                <Wind size={28} className="mx-auto text-cyan-400" />
                <p className="mt-2.5 font-black text-slate-100 text-sm">Silêncio na sala {roomLabel}</p>
                <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
                  Diga como está o vento por aí. Quem estiver decidindo se monta o
                  kite vai agradecer.
                </p>
              </div>
            )}

            {!loading &&
              !error &&
              messages.map((m, i) => {
                const mine = m.userId === user?.id;
                const grouped = shouldGroupWithPrevious(messages[i - 1], m);
                const podeApagar = mine;

                return (
                  <div
                    key={m.id}
                    className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${
                      grouped ? 'mt-0.5' : 'mt-3'
                    }`}
                  >
                    {/* Avatar só na primeira do bloco, à esquerda dos outros. */}
                    {!mine && (
                      <div className="w-8 h-8 shrink-0">
                        {!grouped && (
                          <div className="w-8 h-8 rounded-full bg-slate-800 ring-2 ring-cyan-400/70 overflow-hidden flex items-center justify-center">
                            {m.userAvatar ? (
                              <img src={m.userAvatar} alt={m.userName} className="w-full h-full object-cover" />
                            ) : (
                              <User size={15} className="text-slate-300" />
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div className={`max-w-[78%] min-w-0 ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                      {!grouped && (
                        <span
                          className={`text-[11px] font-black mb-0.5 px-1 ${
                            mine ? 'text-cyan-300' : 'text-emerald-300'
                          }`}
                        >
                          {mine ? 'Você' : m.userName}
                        </span>
                      )}

                      <div
                        className={`px-3 py-2 rounded-2xl border shadow-md ${
                          mine
                            ? 'bg-cyan-500/20 border-cyan-500/40 text-slate-50 rounded-br-sm'
                            : `${cardBg} text-slate-100 rounded-bl-sm`
                        }`}
                      >
                        {/* Texto puro no JSX: o React escapa, e é assim que
                            conteúdo de outro velejador entra na tela em
                            segurança. Nunca dangerouslySetInnerHTML aqui. */}
                        <p className="text-sm leading-snug whitespace-pre-wrap break-words">{m.text}</p>

                        <div className="mt-1 flex items-center justify-end gap-2">
                          <span
                            className="text-[10px] text-slate-400 font-mono"
                            title={formatRelativeTime(m.createdAt, nowTick)}
                          >
                            {formatClockTime(m.createdAt)}
                          </span>
                          {podeApagar && (
                            <button
                              type="button"
                              onClick={() => handleDelete(m.id)}
                              className="min-w-11 min-h-11 -my-2.5 -mr-1.5 flex items-center justify-center text-slate-500 hover:text-rose-400 transition-colors"
                              aria-label="Apagar minha mensagem"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

            <div ref={endRef} />
          </div>

          {/* Aviso de novas mensagens: aparece só quando o velejador está lendo
              o histórico, no lugar de arrastar a tela dele. */}
          {unread > 0 && (
            <div className="shrink-0 px-3 pb-1 flex justify-center">
              <button
                type="button"
                onClick={() => scrollToEnd('smooth')}
                className="flex items-center gap-2 px-4 min-h-11 rounded-full bg-cyan-500 text-slate-950 font-black text-xs shadow-lg shadow-cyan-500/30 active:scale-95 transition-transform"
              >
                <ArrowDown size={15} className="stroke-[3]" />
                <span>
                  {unread} nova{unread > 1 ? 's' : ''} mensage{unread > 1 ? 'ns' : 'm'}
                </span>
              </button>
            </div>
          )}

          {/* Campo de envio */}
          <div className={`shrink-0 border-t border-slate-800 px-3 py-2.5 ${beachMode ? 'bg-[#020617]' : 'bg-[#0F172A]'}`}>
            {sendError && (
              <p role="alert" className="mb-2 text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-2.5 py-1.5">
                {sendError}
              </p>
            )}

            <div className="flex items-end gap-2">
              <label className="flex-1 min-w-0">
                <span className="sr-only">Escrever mensagem na sala {roomLabel}</span>
                <input
                  type="text"
                  value={draft}
                  maxLength={CHAT_TEXT_MAX}
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
                  /* text-base = 16px: abaixo disso o Safari do iPhone dá zoom no
                     foco e desmonta o layout fixo da tela. */
                  className="w-full min-h-11 px-3.5 rounded-2xl bg-[#1E293B] border border-slate-700 text-base text-white placeholder-slate-500 focus:outline-hidden focus:border-cyan-400"
                />
              </label>

              <button
                type="button"
                onClick={handleSend}
                disabled={sending || draft.trim().length === 0}
                className="min-w-11 min-h-11 px-3 rounded-2xl bg-cyan-500 text-slate-950 font-black flex items-center justify-center hover:bg-cyan-400 active:scale-95 transition-all shadow-md shadow-cyan-500/20 disabled:opacity-40 disabled:active:scale-100"
                aria-label="Enviar mensagem"
              >
                {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
              </button>
            </div>

            {/* Contador só perto do limite: barulho visual o tempo todo não ajuda. */}
            {draft.length > CHAT_TEXT_MAX - 100 && (
              <p className="mt-1 text-right text-[10px] font-mono text-slate-400">
                {draft.length}/{CHAT_TEXT_MAX}
              </p>
            )}
          </div>
        </>
      ) : (
        <OnlinePanel
          online={online}
          now={nowTick}
          cardBg={cardBg}
          atSpotId={atSpotId}
          onChangeSpot={setAtSpotId}
          spots={spots.map((s) => ({ id: s.id, name: s.name, location: s.location }))}
          onRetry={loadOnline}
        />
      )}
    </div>
  );
};

/**
 * Relógio que avança de 30 em 30s.
 *
 * "há 3 min" precisa virar "há 4 min" sozinho — sem isto, o horário congela no
 * momento em que a mensagem chegou e a conversa parece parada no tempo. 30s é o
 * passo mais grosso que ainda mantém a precisão de minuto do texto.
 */
function useNowTick(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
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
}

/** Aba "Online": quem está na água agora e onde. */
const OnlinePanel: React.FC<OnlinePanelProps> = ({
  online,
  now,
  cardBg,
  atSpotId,
  onChangeSpot,
  spots,
  onRetry,
}) => {
  // Filtramos pela janela também no cliente: a lista pode ter sido carregada há
  // um minuto, e quem saiu no meio precisa cair sem esperar o próximo fetch.
  const ativos = online.filter((o) => isPresenceOnline(o.lastSeenAt, now));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
      {/* Toggle "estou neste spot" */}
      <div className={`p-3.5 rounded-2xl border ${cardBg}`}>
        <div className="flex items-center gap-2 mb-2">
          <MapPin size={15} className="text-emerald-400" />
          <span className="text-xs font-black text-slate-100">Estou no spot</span>
        </div>
        <p className="text-[11px] text-slate-400 mb-2.5 leading-relaxed">
          Marque onde você está e quem abrir o app vê que tem gente na água aí.
        </p>
        <label className="block">
          <span className="sr-only">Escolher o spot onde você está</span>
          <select
            value={atSpotId}
            onChange={(e) => onChangeSpot(e.target.value)}
            className="w-full min-h-11 px-3 rounded-xl bg-[#0F172A] border border-slate-700 text-slate-100 font-bold focus:outline-hidden focus:border-emerald-400"
          >
            <option value="">Não estou em nenhum spot</option>
            {spots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.location}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">
          Na água agora ({ativos.length})
        </h3>
        <button
          type="button"
          onClick={onRetry}
          className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 min-h-11 px-2 flex items-center"
        >
          Atualizar
        </button>
      </div>

      {ativos.length === 0 ? (
        <div className={`p-6 rounded-2xl border text-center ${cardBg}`}>
          <Users size={28} className="mx-auto text-slate-500" />
          <p className="mt-2.5 font-black text-slate-100 text-sm">Ninguém na água agora</p>
          <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
            Abra o app na praia e você aparece aqui para os outros velejadores.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {ativos.map((o) => (
            <div key={o.userId} className={`p-3 rounded-2xl border flex items-center gap-3 ${cardBg}`}>
              <div className="relative shrink-0">
                <div className="w-11 h-11 rounded-full bg-slate-800 ring-2 ring-emerald-400/70 overflow-hidden flex items-center justify-center">
                  {o.userAvatar ? (
                    <img src={o.userAvatar} alt={o.userName} className="w-full h-full object-cover" />
                  ) : (
                    <User size={20} className="text-slate-300" />
                  )}
                </div>
                <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-400 rounded-full ring-2 ring-[#1E293B]" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-black text-sm text-white truncate">{o.userName}</span>
                  <span className="text-sm shrink-0">{o.countryFlag}</span>
                </div>
                <p className="text-[11px] text-slate-400 truncate">
                  {o.userLevel} • ID {o.userRiderId}
                </p>
                {o.atSpotName && (
                  <p className="text-[11px] font-bold text-emerald-300 flex items-center gap-1 mt-0.5 truncate">
                    <MapPin size={11} className="shrink-0" />
                    <span className="truncate">{o.atSpotName}</span>
                  </p>
                )}
              </div>

              <span className="text-[10px] font-mono text-slate-500 shrink-0">
                {formatRelativeTime(o.lastSeenAt, now)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
