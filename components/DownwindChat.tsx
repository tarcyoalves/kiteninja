'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { useAuthOptional } from '../context/AuthContext';
import { CHAT_TEXT_MAX, downwindRoomName, formatClockTime } from '../lib/chat';
import type { ChatMessage } from '../types';

/**
 * Chat privado de UM downwind — a única forma de o velejador falar com o
 * grupo sem sair do mapa ao vivo (o app não navega para as outras abas
 * enquanto a travessia está em andamento; ver context/DownwindContext.tsx).
 *
 * Deliberadamente mais simples que views/ChatView.tsx: sem seletor de sala
 * (a sala é fixa, `dw:<id>`), sem aba "Online" (quem está no mapa já vê quem
 * está ativo pelos marcadores), sem presença de spot. É um painel de texto,
 * não uma segunda tela — cabe sobreposto ao mapa sem competir por espaço com
 * ele.
 */

const POLL_MS = 4000;

/** Só o que este componente de fato usa do usuário — ver `meuUsuario` abaixo. */
interface UsuarioDoChat {
  id: string;
  name: string;
  avatarUrl?: string;
  riderId: string;
}

interface DownwindChatProps {
  downwindId: string;
  /**
   * Ausente no uso embutido (apoio_terra em views/DownwindAoVivoView.tsx: o
   * chat fica sempre visível na metade de baixo da tela, sem X para fechar).
   * Presente no uso normal (painel que abre por cima do mapa) — aí sim tem
   * como fechar.
   */
  onFechar?: () => void;
  /**
   * Sobrepõe o usuário lido de `useAuth()`. Existe para
   * app/dw-motorista/[token]/ConvidadoView.tsx: a sessão de convidado do
   * link de 12h não passa por `AuthContext` (aquele contexto trata sessão de
   * convidado como "não logado" de propósito — ver GET /api/auth/me — para o
   * convidado nunca herdar o app inteiro por engano). Sem esta prop,
   * `useAuth().user` viria `null` para o convidado e o campo de envio ficaria
   * travado para sempre. Nos outros usos (ModoNavegacao, DownwindAoVivoView,
   * dentro do app normal) a prop fica de fora e o comportamento é o mesmo de
   * sempre.
   */
  meuUsuario?: UsuarioDoChat;
}

export const DownwindChat: React.FC<DownwindChatProps> = ({ downwindId, onFechar, meuUsuario }) => {
  // useAuthOptional() (não useAuth()) porque este componente também é usado
  // fora do AuthProvider — ver o comentário de `meuUsuario` acima.
  const userDoContexto = useAuthOptional()?.user ?? null;
  const user = meuUsuario ?? userDoContexto;
  const room = downwindRoomName(downwindId);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const sinceRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);


  // Carrega mensagens ao mudar sala
  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`/api/chat/messages?room=${encodeURIComponent(room)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) {
          throw new Error('Falha ao carregar mensagens.');
        }
        setMessages((body.messages ?? []) as ChatMessage[]);
        sinceRef.current = body.latestAt ?? null;
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err instanceof Error ? err.message : 'Falha de conexão.');
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [room]);

  // Poll para novas mensagens
  useEffect(() => {
    const poll = async () => {
      if (document.hidden || !sinceRef.current) return;
      try {
        const res = await fetch(
          `/api/chat/messages?room=${encodeURIComponent(room)}&since=${encodeURIComponent(sinceRef.current)}`,
          { cache: 'no-store' }
        );
        if (!res.ok) return;
        const body = await res.json().catch(() => null);
        if (!body) return;
        const novas = (body.messages ?? []) as ChatMessage[];
        if (novas.length > 0) {
          setMessages((prev) => {
            const vistos = new Set(prev.map((m) => m.id));
            return [...prev, ...novas.filter((m) => !vistos.has(m.id))];
          });
          if (body.latestAt) sinceRef.current = body.latestAt;
        }
      } catch {
        // Poll falho é silencioso — a próxima batida tenta de novo.
      }
    };
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [room]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const texto = draft.trim();
    if (!texto || sending || !user) return;
    setSending(true);
    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, text: texto }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? 'Falha ao enviar.');

      // O servidor devolve só id/userId/text/createdAt — nome, avatar e
      // riderId do PRÓPRIO autor já estão na sessão local, e buscá-los de
      // novo seria um round-trip a mais em cada envio (mesmo raciocínio do
      // comentário em app/api/chat/messages/route.ts).
      const m = body?.message as { id: string; text: string; createdAt: string } | undefined;
      if (m) {
        const completa: ChatMessage = {
          id: m.id,
          userId: user.id,
          userName: user.name,
          userAvatar: user.avatarUrl,
          userRiderId: user.riderId,
          text: m.text,
          createdAt: m.createdAt,
        };
        setDraft('');
        setMessages((prev) => [...prev, completa]);
        sinceRef.current = m.createdAt;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="absolute inset-0 z-map-ui flex flex-col bg-[#0B1220]/97 backdrop-blur-md overlay-safe-top overlay-safe-bottom">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
        <h3 className="font-black text-sm text-white">Chat do grupo</h3>
        {onFechar && (
          <button
            type="button"
            onClick={onFechar}
            className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Fechar chat"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
        {loading && <p className="text-center text-xs text-slate-500 mt-4">Carregando...</p>}
        {!loading && messages.length === 0 && (
          <p className="text-center text-xs text-slate-500 mt-4">
            Nenhuma mensagem ainda. Combine o percurso com o grupo por aqui.
          </p>
        )}
        {messages.map((m) => {
          const souEu = m.userId === user?.id;
          return (
            <div key={m.id} className={`flex flex-col ${souEu ? 'items-end' : 'items-start'}`}>
              {!souEu && (
                <span className="text-[10px] font-bold text-cyan-400 px-1">{m.userName}</span>
              )}
              <div
                className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${
                  souEu
                    ? 'bg-cyan-600 text-white rounded-br-sm'
                    : 'bg-slate-800 text-slate-100 rounded-bl-sm'
                }`}
              >
                {m.text}
              </div>
              <span className="text-[9px] text-slate-500 px-1 mt-0.5">
                {formatClockTime(m.createdAt)}
              </span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {error && (
        <p className="px-4 py-1 text-[11px] text-rose-400 shrink-0">{error}</p>
      )}

      <form onSubmit={enviar} className="flex items-center gap-2 px-3 py-2.5 border-t border-slate-800 shrink-0">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, CHAT_TEXT_MAX))}
          placeholder="Mensagem para o grupo..."
          className="flex-1 min-w-0 px-3 py-2.5 rounded-full bg-slate-800 border border-slate-700 text-white text-sm focus:outline-hidden focus:border-cyan-400"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          className="shrink-0 w-10 h-10 rounded-full bg-cyan-500 disabled:opacity-40 flex items-center justify-center text-slate-950 active:scale-95 transition-all"
          aria-label="Enviar"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
};
