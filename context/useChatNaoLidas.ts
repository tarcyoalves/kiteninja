'use client';

/**
 * Não lidas do chat geral e das conversas diretas — segunda fatia da T17.
 *
 * Saiu de `KiteDataContext.tsx` SEM mudar comportamento: o corpo é o mesmo,
 * linha a linha, e o contexto continua expondo os mesmos campos. São os dois
 * vigias em segundo plano (chat geral a cada 8 s, DMs a cada 10 s, ambos
 * pausados com a aba oculta) e os contadores que alimentam o selo do menu.
 *
 * `activeTab` entra por parâmetro porque os dois vigias só contam mensagem
 * como não lida quando a pessoa NÃO está na aba chat.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, DmConversation } from '../types';
import { useAoMudar } from '../lib/useAoMudar';

export function useChatNaoLidas(args: {
  isAuthenticated: boolean;
  userId: string | undefined;
  activeTab: string;
}) {
  const { isAuthenticated, userId, activeTab } = args;
  // Chat Notifications & Unread Counters
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [latestIncomingMessage, setLatestIncomingMessage] = useState<ChatMessage | null>(null);
  const lastChatCheckRef = useRef<string>(new Date().toISOString());

  const clearUnreadChat = useCallback(() => {
    setUnreadChatCount(0);
    setLatestIncomingMessage(null);
  }, []);

  // Não lidas de DM — contador e "linha d'água" (por conversa) separados do
  // chat geral acima: ver comentário na interface sobre por quê.
  const [dmUnreadCount, setDmUnreadCount] = useState(0);
  const [latestIncomingDm, setLatestIncomingDm] = useState<
    {
      fromUserId: string;
      fromUserName: string;
      text: string;
      avatarUrl?: string;
      createdAt: string;
    } | null
  >(null);
  const dmLastSeenRef = useRef<Map<string, string>>(new Map());
  const dmBaselineDoneRef = useRef(false);

  const clearDmUnread = useCallback(() => {
    setDmUnreadCount(0);
    setLatestIncomingDm(null);
  }, []);

  // Quando o usuário entra na aba chat, zera os dois contadores de não lidas.
  // No render, não em efeito: com useEffect o badge ainda pintava um quadro
  // com a contagem antiga depois de a aba já ter trocado. Ver lib/useAoMudar.ts.
  useAoMudar(activeTab, () => {
    if (activeTab === 'chat') {
      clearUnreadChat();
      clearDmUnread();
    }
  });

  // Background watcher para novas mensagens no chat geral
  useEffect(() => {
    if (!isAuthenticated) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelado = false;

    const checkBackgroundMessages = async () => {
      if (document.hidden) {
        timeoutId = setTimeout(checkBackgroundMessages, 15000);
        return;
      }

      try {
        const since = lastChatCheckRef.current;
        const res = await fetch(
          `/api/chat/messages?room=geral&since=${encodeURIComponent(since)}`,
          { cache: 'no-store' }
        );
        if (res.ok) {
          const body = await res.json().catch(() => null);
          const novas = (body?.messages ?? []) as ChatMessage[];
          if (novas.length > 0) {
            // Avança o cursor pelo lote INTEIRO (inclusive mensagens próprias),
            // senão a própria mensagem nunca sai da janela "since" e volta a
            // aparecer como "nova" no próximo poll.
            lastChatCheckRef.current = body.latestAt || new Date().toISOString();
            // Mas só conta como "notificação" quem NÃO fui eu: sem este filtro,
            // mandar uma mensagem e sair da aba do chat fazia o próximo poll
            // background achar a própria mensagem e notificar o remetente dela
            // mesmo — quem devia ser avisado é quem recebeu, não quem mandou.
            const novasDeOutros = novas.filter((m) => m.userId !== userId);
            // Se o usuário não está na aba chat, notifica
            if (activeTab !== 'chat' && novasDeOutros.length > 0) {
              setUnreadChatCount((c) => c + novasDeOutros.length);
              const ultima = novasDeOutros[novasDeOutros.length - 1];
              setLatestIncomingMessage(ultima);

              // Dispara notificação push do navegador se autorizado
              if (
                typeof window !== 'undefined' &&
                'Notification' in window &&
                Notification.permission === 'granted'
              ) {
                try {
                  new Notification(`KiteNinja • ${ultima.userName}`, {
                    body: ultima.text,
                    icon: ultima.userAvatar || '/brand/logo.png',
                  });
                } catch {
                  // Fallback silencioso
                }
              }
            }
          }
        }
      } catch {
        // Ignora oscilações de rede
      }

      if (!cancelado) {
        timeoutId = setTimeout(checkBackgroundMessages, 8000);
      }
    };

    timeoutId = setTimeout(checkBackgroundMessages, 6000);

    return () => {
      cancelado = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isAuthenticated, activeTab, userId]);

  /**
   * Background watcher para conversas diretas (DM). Diferente do geral acima,
   * não existe um único `since`: cada conversa (`userId` do outro lado) tem
   * sua própria "linha d'água" em `dmLastSeenRef`, porque `/api/chat/dms`
   * devolve só a ÚLTIMA mensagem de cada sala (inbox), não um feed incremental.
   */
  useEffect(() => {
    if (!isAuthenticated) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelado = false;

    const checkBackgroundDms = async () => {
      if (document.hidden) {
        timeoutId = setTimeout(checkBackgroundDms, 15000);
        return;
      }

      try {
        const res = await fetch('/api/chat/dms', { cache: 'no-store' });
        if (res.ok) {
          const body = await res.json().catch(() => null);
          const conversas = (body?.conversas ?? []) as DmConversation[];

          if (!dmBaselineDoneRef.current) {
            // Primeira leitura desde que o app abriu: só grava a linha d'água
            // de cada conversa, sem notificar — senão toda DM antiga vira
            // "mensagem nova" no instante em que o app carrega.
            for (const c of conversas) dmLastSeenRef.current.set(c.userId, c.lastMessage.createdAt);
            dmBaselineDoneRef.current = true;
          } else {
            for (const c of conversas) {
              if (c.lastMessage.fromMe) continue;
              const visto = dmLastSeenRef.current.get(c.userId);
              if (visto && c.lastMessage.createdAt <= visto) continue;

              dmLastSeenRef.current.set(c.userId, c.lastMessage.createdAt);
              if (activeTab === 'chat') continue;

              setDmUnreadCount((n) => n + 1);
              setLatestIncomingDm({
                fromUserId: c.userId,
                fromUserName: c.userName,
                text: c.lastMessage.text,
                avatarUrl: c.userAvatar,
                createdAt: c.lastMessage.createdAt,
              });

              if (
                typeof window !== 'undefined' &&
                'Notification' in window &&
                Notification.permission === 'granted'
              ) {
                try {
                  new Notification(`KiteNinja • ${c.userName}`, {
                    body: c.lastMessage.text,
                    icon: c.userAvatar || '/brand/logo.png',
                  });
                } catch {
                  // Fallback silencioso
                }
              }
            }
          }
        }
      } catch {
        // Ignora oscilações de rede
      }

      if (!cancelado) {
        timeoutId = setTimeout(checkBackgroundDms, 10000);
      }
    };

    timeoutId = setTimeout(checkBackgroundDms, 6000);

    return () => {
      cancelado = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isAuthenticated, activeTab]);

  return {
    unreadChatCount,
    latestIncomingMessage,
    setLatestIncomingMessage,
    clearUnreadChat,
    dmUnreadCount,
    latestIncomingDm,
    clearDmUnread,
  };
}
