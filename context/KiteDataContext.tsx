'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Spot, SessionLog, CommunityPost, SafetyOccurrence, KiteEvent, WindUnit, Discipline, ChatMessage, DmConversation } from '../types';
import { useAuth } from './AuthContext';
import { INITIAL_SPOTS } from '../data/mockSpots';
import { usePositionBeacon } from '../lib/usePositionBeacon';
import { PrefillLogbook } from '../lib/trilhaSessao';

/**
 * Abas do app. Antes o union estava escrito por extenso em quatro lugares e
 * adicionar uma aba exigia lembrar de todos — o nome dá um ponto único de
 * mudança e o TypeScript cobra o resto.
 */
export type ActiveTab =
  | 'favoritos'
  | 'mapa'
  | 'destaques'
  | 'sessoes'
  | 'alertas'
  | 'anuncios'
  | 'chat'
  | 'perfil'
  | 'mais';

interface KiteDataContextType {
  spots: Spot[];
  selectedSpot: Spot | null;
  setSelectedSpot: (spot: Spot | null) => void;
  toggleFavorite: (spotId: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedStateFilter: string;
  setSelectedStateFilter: (state: string) => void;
  // Sessions (Logbook)
  sessions: SessionLog[];
  addSession: (
    session: Omit<SessionLog, 'id' | 'createdAt' | 'likesCount' | 'commentsCount'>
  ) => Promise<{ ok: boolean; error?: string }>;
  deleteSession: (sessionId: string) => void;

  // Community Feed
  posts: CommunityPost[];
  addPost: (
    post: Omit<CommunityPost, 'id' | 'likes' | 'comments' | 'shares'>
  ) => Promise<{ ok: boolean; error?: string }>;
  toggleLikePost: (postId: string) => void;
  // userName não é usado: o autor do comentário vem da sessão no servidor.
  addComment: (postId: string, text: string, userName: string) => void;

  // Safety & Events
  safetyAlerts: SafetyOccurrence[];
  addSafetyAlert: (alert: Omit<SafetyOccurrence, 'id' | 'timestamp' | 'status'>) => void;
  events: KiteEvent[];
  toggleEventRegistration: (eventId: string) => void;
  deleteEvent: (eventId: string) => Promise<{ ok: boolean; error?: string }>;
  createDownwind: (data: {
    title: string;
    location: string;
    description: string;
    spotSaidaId: string;
    spotChegadaId?: string;
    previstoPara: string;
  }) => Promise<{ ok: boolean; error?: string }>;

  // UI States
  windUnit: WindUnit;
  setWindUnit: (unit: WindUnit) => void;
  convertWind: (knots: number) => { value: number; unitStr: string };
  beachMode: boolean; // Modo alto-contraste para sol forte na praia
  setBeachMode: (enabled: boolean | ((prev: boolean) => boolean)) => void;

  // Notificações e Chat Global
  unreadChatCount: number;
  setUnreadChatCount: React.Dispatch<React.SetStateAction<number>>;
  latestIncomingMessage: ChatMessage | null;
  setLatestIncomingMessage: (msg: ChatMessage | null) => void;
  clearUnreadChat: () => void;

  // Não lidas de conversa direta (DM) — contadas à parte do chat geral, porque
  // uma DM merece notificação mesmo com o usuário já dentro da aba "chat"
  // (ele pode estar no geral ou noutra DM, não necessariamente naquela).
  dmUnreadCount: number;
  latestIncomingDm: { fromUserId: string; fromUserName: string; text: string; avatarUrl?: string } | null;
  clearDmUnread: () => void;

  // SOS Emergency System
  myActiveSos: SosAlertData | null;
  incomingSosAlert: SosAlertData | null;
  allActiveSosList: SosAlertData[];
  setMyActiveSos: (sos: SosAlertData | null) => void;
  dismissIncomingSos: () => void;
  respondToSos: (sosId: string, state: 'a_caminho' | 'nao_posso') => Promise<void>;
  cancelMySos: () => Promise<void>;
  fetchActiveSos: () => Promise<void>;

  // Modals & Drawers
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  isLoggerOpen: boolean;
  setIsLoggerOpen: (open: boolean) => void;
  /**
   * Rascunho do logbook vindo de uma sessão real do Modo Navegação (mapa
   * normal, fora de um downwind em grupo) — ver `lib/trilhaSessao.ts`,
   * `paraPrefillLogbook`. `null` numa abertura manual comum do botão "+
   * Velejo" do Header.
   */
  loggerPrefill: PrefillLogbook | null;
  /** Seta o prefill e abre o modal numa chamada só — usado por
   * views/MapView.tsx ao sair do Modo Navegação com dado real de GPS. */
  abrirLoggerComResumo: (prefill: PrefillLogbook) => void;
  /** Limpa o prefill sem fechar o modal — chamado por SessionLoggerModal
   * assim que aplica os valores, para uma reabertura manual seguinte não
   * herdar dado de uma sessão de GPS antiga. */
  limparLoggerPrefill: () => void;
  isCalculatorOpen: boolean;
  setIsCalculatorOpen: (open: boolean) => void;
  isNewPostOpen: boolean;
  setIsNewPostOpen: (open: boolean) => void;
  isNewAlertOpen: boolean;
  setIsNewAlertOpen: (open: boolean) => void;
  isNewListingOpen: boolean;
  setIsNewListingOpen: (open: boolean) => void;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;

  /**
   * Busca de velejadores e perfil público (Fase 4 do plano de rede social) —
   * vivem no contexto, não em state local do FeedView, porque são abertos de
   * vários lugares diferentes: o ícone de busca e o estado vazio do feed
   * (views/FeedView.tsx), e o nome/avatar do autor em qualquer
   * `CardSessaoFeed` — inclusive dentro do próprio `RiderProfileModal`
   * (a lista de velejos do perfil reaproveita o card). Um estado só,
   * controlado por quem está montado em `app/page.tsx`, evita perfurar essa
   * função por vários componentes que não têm relação de pai/filho direta.
   */
  isBuscaVelejadoresOpen: boolean;
  setIsBuscaVelejadoresOpen: (open: boolean) => void;
  /** `null` = nenhum perfil aberto — mesmo contrato de `selectedSpot`. */
  riderIdAberto: string | null;
  setRiderIdAberto: (riderId: string | null) => void;

  /**
   * Detalhe da sessão (Fase 5 do plano de rede social) — mesmo contrato de
   * `riderIdAberto` acima: `null` = fechado, montado UMA VEZ em
   * `app/page.tsx` e aberto de qualquer card do feed ou do perfil público.
   */
  sessaoIdAberta: string | null;
  setSessaoIdAberta: (sessionId: string | null) => void;

  /**
   * Central de notificações in-app (Fase 6 do plano de rede social) — mesmo
   * contrato de `riderIdAberto`/`sessaoIdAberta`: um booleano só, controlado
   * por quem está montado em `app/page.tsx`, aberto a partir do sininho do
   * Header (`components/NotificationCenterModal.tsx`).
   */
  isNotificacoesAbertas: boolean;
  setIsNotificacoesAbertas: (open: boolean) => void;
  /** Contagem de não lidas para o badge do sininho — mesmo mecanismo de
   * polling em segundo plano de `unreadChatCount`/`dmUnreadCount` (ver os
   * `useEffect` de "Background watcher" abaixo), não um `setInterval` novo
   * inventado à parte. */
  notificacoesNaoLidas: number;
  /** Zera o contador na hora que a central abre (otimista) — o próximo
   * `GET /api/notifications` confirma o valor real. */
  zerarNotificacoesNaoLidas: () => void;

  /**
   * Central de chamados (reportar bug/melhoria) — mesmo contrato de
   * `isNotificacoesAbertas`: um booleano só, controlado por quem está
   * montado em `app/page.tsx`, aberto a partir do menu lateral
   * (`components/SidebarDrawer.tsx`).
   */
  isChamadosAbertos: boolean;
  setIsChamadosAbertos: (open: boolean) => void;

  /**
   * Marketplace. Os anúncios NÃO vivem no contexto: a lista depende de filtros e
   * paginação que só a tela conhece, e duplicar isso aqui criaria duas fontes de
   * verdade. O contexto só carrega um contador que a view observa para recarregar
   * quando um anúncio é criado ou alterado de fora dela.
   */
  listingsVersion: number;
  refreshListings: () => void;

  // Atualização das condições
  refreshWindData: () => void;
  isRefreshing: boolean;
  isHydrated: boolean;

  /**
   * Última posição de GPS conhecida, capturada pelo watchPosition do MapView.
   * Vive aqui (e não só no state local do MapView) para o heartbeat de
   * presença (ChatView) poder reenviá-la sem pedir localização de novo — a
   * seleção de candidatos de um SOS depende dela (lib/sosCandidates.ts).
   */
  lastKnownPosition: { lat: number; lng: number } | null;
  setLastKnownPosition: (pos: { lat: number; lng: number } | null) => void;
}

export interface SosResponderData {
  userId: string;
  name: string;
  state: 'notificado' | 'a_caminho' | 'no_local' | 'nao_posso';
  distanceKm: number | null;
  /**
   * Por que esta pessoa foi notificada — ver lib/sosCandidates.ts.
   * 'downwind'/'downwind_apoio' podem estar longe e ainda assim ser o socorro
   * mais rápido, então a UI precisa distinguir de um vizinho qualquer.
   */
  motivo?: 'proximidade' | 'downwind' | 'downwind_apoio';
  lat: number | null;
  lng: number | null;
}

export interface SosAlertData {
  id: string;
  userId: string;
  authorName: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  spotId: string | null;
  spotName: string | null;
  message: string | null;
  status: 'ativo' | 'em_atendimento' | 'resolvido' | 'cancelado' | 'falso_alarme';
  radiusKm: number;
  createdAt: string;
  responders: SosResponderData[];
  temCoordenada: boolean;
  distanceKm: number | null;
  /** Por que ESTE usuário foi chamado para este SOS (undefined se é o autor). */
  motivo?: 'proximidade' | 'downwind' | 'downwind_apoio';
}

const KiteDataContext = createContext<KiteDataContextType | undefined>(undefined);

const TAB_INICIAL: ActiveTab = 'favoritos';

const UUID_RE = /^[0-9a-f-]{36}$/i;
const FAVS_STORAGE_KEY = 'kiteninja_user_favorites';

function getLocalFavorites(): Set<string> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(FAVS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch {}
  return null;
}

function saveLocalFavorites(ids: string[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(FAVS_STORAGE_KEY, JSON.stringify(ids));
  } catch {}
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    // `no-store` no cliente além do header no servidor (lib/api.ts): são duas
    // camadas de cache diferentes, e o app precisa das duas. Os watchers de
    // chat e DM já passavam isso na mão — sinal de que alguém topou com cache
    // velho antes e resolveu no ponto em vez de na base. Aqui vale para TODAS
    // as chamadas de uma vez. Ver docs/BUG-SINCRONIZACAO-DADOS.md.
    cache: 'no-store',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null) || 'Falha na requisição.');
  }
  return body as T;
}

export const KiteDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useAuth();

  const [spots, setSpots] = useState<Spot[]>(() => {
    const localFavs = getLocalFavorites();
    if (localFavs) {
      return INITIAL_SPOTS.map((s) => ({
        ...s,
        isFavorite: localFavs.has(s.id),
      }));
    }
    return INITIAL_SPOTS;
  });
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStateFilter, setSelectedStateFilter] = useState('ALL');

  const [sessions, setSessions] = useState<SessionLog[]>([]);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [safetyAlerts, setSafetyAlerts] = useState<SafetyOccurrence[]>([]);
  const [events, setEvents] = useState<KiteEvent[]>([]);
  const [windUnit, setWindUnit] = useState<WindUnit>('nós');
  const [beachMode, setBeachMode] = useState<boolean>(false);

  // SOS Emergency States
  const [myActiveSos, setMyActiveSos] = useState<SosAlertData | null>(null);
  const [incomingSosAlert, setIncomingSosAlert] = useState<SosAlertData | null>(null);
  const [allActiveSosList, setAllActiveSosList] = useState<SosAlertData[]>([]);
  const dismissedSosIdsRef = useRef<Set<string>>(new Set());

  // Modais e navegação
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoggerOpen, setIsLoggerOpen] = useState(false);
  const [loggerPrefill, setLoggerPrefill] = useState<PrefillLogbook | null>(null);

  const abrirLoggerComResumo = useCallback((prefill: PrefillLogbook) => {
    setLoggerPrefill(prefill);
    setIsLoggerOpen(true);
  }, []);

  const limparLoggerPrefill = useCallback(() => {
    setLoggerPrefill(null);
  }, []);
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [isNewPostOpen, setIsNewPostOpen] = useState(false);
  const [isNewAlertOpen, setIsNewAlertOpen] = useState(false);
  const [isNewListingOpen, setIsNewListingOpen] = useState(false);
  const [isBuscaVelejadoresOpen, setIsBuscaVelejadoresOpen] = useState(false);
  const [riderIdAberto, setRiderIdAberto] = useState<string | null>(null);
  const [sessaoIdAberta, setSessaoIdAberta] = useState<string | null>(null);
  const [isNotificacoesAbertas, setIsNotificacoesAbertas] = useState(false);
  const [notificacoesNaoLidas, setNotificacoesNaoLidas] = useState(0);
  const zerarNotificacoesNaoLidas = useCallback(() => setNotificacoesNaoLidas(0), []);
  const [isChamadosAbertos, setIsChamadosAbertos] = useState(false);
  const [listingsVersion, setListingsVersion] = useState(0);
  const [activeTab, setActiveTab] = useState<ActiveTab>(TAB_INICIAL);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [lastKnownPosition, setLastKnownPosition] = useState<{ lat: number; lng: number } | null>(null);

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
    { fromUserId: string; fromUserName: string; text: string; avatarUrl?: string } | null
  >(null);
  const dmLastSeenRef = useRef<Map<string, string>>(new Map());
  const dmBaselineDoneRef = useRef(false);

  const clearDmUnread = useCallback(() => {
    setDmUnreadCount(0);
    setLatestIncomingDm(null);
  }, []);

  // Quando o usuário entra na aba chat, zera os dois contadores de não lidas
  useEffect(() => {
    if (activeTab === 'chat') {
      clearUnreadChat();
      clearDmUnread();
    }
  }, [activeTab, clearUnreadChat, clearDmUnread]);

  /*
   * Espelha o modo praia no <html> para que `--app-bg` (globals.css) valha para
   * o `body` também, e não só para o shell. O fundo precisa estar no elemento
   * raiz porque o canvas do body é o que o iOS exibe em qualquer sobra fora do
   * shell `fixed` — se só o shell mudasse de cor, a diferença apareceria como
   * uma tarja de tom diferente no rodapé.
   */
  useEffect(() => {
    const raiz = document.documentElement;
    if (beachMode) {
      raiz.setAttribute('data-modo', 'praia');
    } else {
      raiz.removeAttribute('data-modo');
    }
  }, [beachMode]);

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
            const novasDeOutros = novas.filter((m) => m.userId !== user?.id);
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
  }, [isAuthenticated, activeTab]);

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

  /**
   * Background watcher da contagem de notificações não lidas (Fase 6) —
   * MESMO mecanismo dos dois de cima (chat geral e DM): setTimeout
   * encadeado, pausa com `document.hidden`, sem depender de WebSocket. Só lê
   * a contagem (`naoLidas`), nunca a lista inteira — a central de
   * notificações (`NotificationCenterModal`) busca a lista completa só
   * quando de fato abre.
   */
  useEffect(() => {
    if (!isAuthenticated) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelado = false;

    const checkNotificacoes = async () => {
      if (document.hidden) {
        timeoutId = setTimeout(checkNotificacoes, 15000);
        return;
      }

      try {
        const res = await fetch('/api/notifications', { cache: 'no-store' });
        if (res.ok) {
          const body = await res.json().catch(() => null);
          if (typeof body?.naoLidas === 'number') setNotificacoesNaoLidas(body.naoLidas);
        }
      } catch {
        // Ignora oscilações de rede
      }

      if (!cancelado) {
        timeoutId = setTimeout(checkNotificacoes, 20000);
      }
    };

    timeoutId = setTimeout(checkNotificacoes, 4000);

    return () => {
      cancelado = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isAuthenticated]);

  const loadSpots = useCallback(async (forceRefresh = false) => {
    try {
      const url = forceRefresh ? `/api/spots?refresh=1&_t=${Date.now()}` : '/api/spots';
      const data = await api<{ spots: Spot[] }>(url, forceRefresh ? { cache: 'no-store' } : undefined);
      if (Array.isArray(data?.spots) && data.spots.length > 0) {
        const favIds = data.spots.filter((s) => s.isFavorite).map((s) => s.id);
        if (favIds.length > 0) {
          saveLocalFavorites(favIds);
        }
        setSpots((prev) => {
          if (!prev.length) return data.spots;
          const prevMap = new Map(prev.map((p) => [p.id, p]));
          return data.spots.map((curr) => {
            const old = prevMap.get(curr.id);
            // Se o novo spot veio zerado por oscilação momentânea da API externa, mantém os dados anteriores
            if (
              curr.currentKnots === 0 &&
              (!curr.daysForecast || curr.daysForecast.length === 0) &&
              old &&
              old.currentKnots > 0
            ) {
              return {
                ...curr,
                currentKnots: old.currentKnots,
                avgKnots: old.avgKnots,
                maxKnots: old.maxKnots,
                gustKnots: old.gustKnots,
                windDirectionDeg: old.windDirectionDeg,
                windDirectionText: old.windDirectionText,
                temperature: old.temperature,
                weatherDescription: old.weatherDescription,
                weatherIcon: old.weatherIcon,
                currentTideHeightM: old.currentTideHeightM,
                currentTideTrend: old.currentTideTrend,
                nextTideInfo: old.nextTideInfo,
                waveHeightM: old.waveHeightM,
                wavePeriodS: old.wavePeriodS,
                swellHeightM: old.swellHeightM,
                windWaveHeightM: old.windWaveHeightM,
                sailingScore: old.sailingScore,
                daysForecast: old.daysForecast,
                isLiveObservation: old.isLiveObservation,
                lastUpdated: old.lastUpdated,
              };
            }
            return curr;
          });
        });
      }
    } catch {
      // Sem rede: mantém o que já estava na tela em vez de esvaziar o mapa.
    }
  }, []);

  /** Quando feed/eventos/alertas foram carregados pela última vez. */
  const ultimoLoadFeedRef = useRef(0);

  const loadFeedAndEvents = useCallback(async () => {
    const [postsR, eventsR, alertsR] = await Promise.allSettled([
      api<{ posts: CommunityPost[] }>('/api/posts'),
      api<{ events: KiteEvent[] }>('/api/events'),
      api<{ alerts: SafetyOccurrence[] }>('/api/alerts'),
    ]);
    if (postsR.status === 'fulfilled') setPosts(postsR.value.posts);
    if (eventsR.status === 'fulfilled') setEvents(eventsR.value.events);
    if (alertsR.status === 'fulfilled') setSafetyAlerts(alertsR.value.alerts);
    ultimoLoadFeedRef.current = Date.now();
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const data = await api<{ sessions: SessionLog[] }>('/api/sessions');
      setSessions(data.sessions);
    } catch {
      // Sem sessão de usuário ou sem rede: histórico fica vazio, sem travar a UI.
    }
  }, []);

  // Carrega o que é público (spots com clima) sempre; feed/eventos precisam de
  // login porque as rotas exigem requireUser().
  useEffect(() => {
    let mounted = true;
    (async () => {
      await loadSpots();
      if (mounted) setIsHydrated(true);
    })();
    return () => {
      mounted = false;
    };
  }, [loadSpots]);

  useEffect(() => {
    if (!isAuthenticated) {
      setSessions([]);
      return;
    }
    loadFeedAndEvents();
    loadSessions();
  }, [isAuthenticated, loadFeedAndEvents, loadSessions]);

  /*
   * Revalida feed/eventos/alertas quando o app volta ao primeiro plano.
   *
   * O BUG QUE ISTO CORRIGE: até aqui, `loadFeedAndEvents` só rodava (a) ao
   * logar/montar e (b) logo depois de uma ação do PRÓPRIO usuário. Não havia
   * NADA que reagisse a mudança feita por OUTRA pessoa — nem poll, nem
   * revalidação ao retomar o app. Quem estivesse com o app aberto ficava
   * congelado no snapshot de quando carregou, indefinidamente.
   *
   * Sintoma relatado: o dono apagou dois downwinds e criou um novo; o outro
   * usuário continuou vendo só os dois antigos. Não era "versão diferente do
   * app" — era o mesmo app com estado velho em memória, sem nada para
   * invalidá-lo.
   *
   * Por que atinge MAIS o app nativo que a PWA: no Android o processo do app
   * fica vivo em memória por dias entre um uso e outro, então o estado velho
   * sobrevive muito mais tempo. Na aba do navegador é mais comum recarregar a
   * página em algum momento e "consertar" sozinho por acidente.
   *
   * Retomada em vez de poll de propósito: o `visibilitychange` cobre o caso
   * real (abrir o app e ver o que mudou) sem somar requisição de fundo a cada
   * X segundos — este projeto já paga polling de chat, SOS e downwind, e
   * `docs/ANTIGRAVITY-AUDIT-2026.md` aponta compute do Neon como principal
   * custo. A janela mínima evita rajada quando o usuário alterna de app
   * várias vezes seguidas.
   */
  useEffect(() => {
    if (!isAuthenticated) return;

    const IDADE_MINIMA_MS = 30_000;

    const revalidarSeVelho = () => {
      if (document.hidden) return;
      if (Date.now() - ultimoLoadFeedRef.current < IDADE_MINIMA_MS) return;
      loadFeedAndEvents();
      loadSessions();
    };

    document.addEventListener('visibilitychange', revalidarSeVelho);
    // `focus` cobre o caso em que a aba já estava visível mas o sistema
    // devolveu o foco ao app (alt-tab no desktop, split-screen no Android),
    // quando `visibilitychange` não chega a disparar.
    window.addEventListener('focus', revalidarSeVelho);

    return () => {
      document.removeEventListener('visibilitychange', revalidarSeVelho);
      window.removeEventListener('focus', revalidarSeVelho);
    };
  }, [isAuthenticated, loadFeedAndEvents, loadSessions]);

  const toggleFavorite = (spotId: string) => {
    // Otimista: a tela reage no toque e desfaz se o servidor recusar.
    const wasFavorite = spots.find((sp) => sp.id === spotId)?.isFavorite ?? false;
    setSpots((prev) => {
      const next = prev.map((sp) => (sp.id === spotId ? { ...sp, isFavorite: !sp.isFavorite } : sp));
      saveLocalFavorites(next.filter((s) => s.isFavorite).map((s) => s.id));
      return next;
    });
    if (selectedSpot?.id === spotId) {
      setSelectedSpot((prev) => (prev ? { ...prev, isFavorite: !prev.isFavorite } : null));
    }

    api<{ isFavorite: boolean }>('/api/favorites', {
      method: 'POST',
      body: JSON.stringify({ spotId }),
    })
      .then((res) => {
        setSpots((prev) => {
          const next = prev.map((sp) => (sp.id === spotId ? { ...sp, isFavorite: res.isFavorite } : sp));
          saveLocalFavorites(next.filter((s) => s.isFavorite).map((s) => s.id));
          return next;
        });
      })
      .catch(() => {
        setSpots((prev) => {
          const next = prev.map((sp) => (sp.id === spotId ? { ...sp, isFavorite: wasFavorite } : sp));
          saveLocalFavorites(next.filter((s) => s.isFavorite).map((s) => s.id));
          return next;
        });
      });
  };

  const convertWind = (knots: number) => {
    if (windUnit === 'km/h') {
      return { value: Math.round(knots * 1.852), unitStr: 'km/h' };
    }
    if (windUnit === 'mph') {
      return { value: Math.round(knots * 1.15078), unitStr: 'mph' };
    }
    return { value: Math.round(knots), unitStr: 'nós' };
  };

  const addSession = async (
    sessionData: Omit<SessionLog, 'id' | 'createdAt' | 'likesCount' | 'commentsCount'>
  ): Promise<{ ok: boolean; error?: string }> => {
    // spotId só é aceito pela rota se for o UUID real do banco; "outro"/vazio
    // vira null e a sessão fica com nome/local livres.
    const spotId = sessionData.spotId && UUID_RE.test(sessionData.spotId) ? sessionData.spotId : null;

    try {
      const created = await api<SessionLog>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          spotId,
          spotName: sessionData.spotName,
          spotLocation: sessionData.spotLocation,
          date: sessionData.date,
          startTime: sessionData.startTime,
          durationMinutes: sessionData.durationMinutes,
          discipline: sessionData.discipline,
          kiteSizeM2: sessionData.kiteSizeM2,
          boardModel: sessionData.boardModel,
          avgWindKnots: sessionData.avgWindKnots,
          maxGustKnots: sessionData.maxGustKnots,
          windDirection: sessionData.windDirection,
          tideCondition: sessionData.tideCondition,
          waterCondition: sessionData.waterCondition,
          rating: sessionData.rating,
          distanceKm: sessionData.distanceKm,
          maxSpeedKnots: sessionData.maxSpeedKnots,
          highestJumpM: sessionData.highestJumpM,
          notes: sessionData.notes,
          photoUrl: sessionData.photoUrl,
          isPublic: sessionData.isPublic,
          trilhaReduzida: sessionData.trilhaReduzida,
        }),
      });
      setSessions((prev) => [{ ...created, likesCount: 0, commentsCount: 0 } as SessionLog, ...prev]);
      if (sessionData.isPublic) loadFeedAndEvents();
      return { ok: true };
    } catch (err) {
      // Não feche o formulário nem apague o que foi digitado. Em conexão ruim
      // no spot, dizer "salvo" sem confirmação do servidor perde a sessão em
      // silêncio e destrói a confiança no Logbook.
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Não foi possível salvar o velejo.',
      };
    }
  };

  const deleteSession = (sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    api(`/api/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {
      loadSessions();
    });
  };

  const addPost = async (
    postData: Omit<CommunityPost, 'id' | 'likes' | 'comments' | 'shares'>
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      await api<{ id: string }>('/api/posts', {
        method: 'POST',
        body: JSON.stringify({
          title: postData.title,
          content: postData.content,
          spotName: postData.spotName,
          spotLocation: postData.spotLocation,
          photoUrl: postData.photoUrl,
          windKnots: postData.windReport?.knots,
          windKiteUsed: postData.windReport?.kiteUsed,
          windCondition: postData.windReport?.condition,
          tag: postData.tag,
        }),
      });
      await loadFeedAndEvents();
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Não foi possível publicar o relato.',
      };
    }
  };

  const toggleLikePost = (postId: string) => {
    // Otimista, igual ao favorito: o toque muda a tela e o servidor confirma.
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        const isLiked = !p.isLiked;
        return { ...p, isLiked, likes: isLiked ? p.likes + 1 : Math.max(0, p.likes - 1) };
      })
    );

    api<{ isLiked: boolean; count: number }>(`/api/posts/${postId}/like`, { method: 'POST' })
      .then((res) => {
        setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, isLiked: res.isLiked, likes: res.count } : p)));
      })
      .catch(() => loadFeedAndEvents());
  };

  const addComment = (postId: string, text: string) => {
    api<{ id: string }>(`/api/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
      .then(() => loadFeedAndEvents())
      .catch(() => {});
  };

  const addSafetyAlert = (alertData: Omit<SafetyOccurrence, 'id' | 'timestamp' | 'status'>) => {
    api<{ id: string }>('/api/alerts', {
      method: 'POST',
      body: JSON.stringify({
        title: alertData.title,
        spotName: alertData.spotName,
        severity: alertData.severity,
        description: alertData.description,
      }),
    })
      .then(() => loadFeedAndEvents())
      .catch(() => {});
  };

  const toggleEventRegistration = (eventId: string) => {
    setEvents((prev) =>
      prev.map((ev) => {
        if (ev.id !== eventId) return ev;
        const isReg = !ev.isRegistered;
        return { ...ev, isRegistered: isReg, participantsCount: isReg ? ev.participantsCount + 1 : Math.max(0, ev.participantsCount - 1) };
      })
    );

    api<{ isRegistered: boolean; participantsCount: number }>(`/api/events/${eventId}/register`, { method: 'POST' })
      .then((res) => {
        setEvents((prev) =>
          prev.map((ev) => (ev.id === eventId ? { ...ev, isRegistered: res.isRegistered, participantsCount: res.participantsCount } : ev))
        );
      })
      .catch(() => loadFeedAndEvents());
  };

  const deleteEvent = async (eventId: string): Promise<{ ok: boolean; error?: string }> => {
    const anterior = events;
    // Otimista: some da lista na hora. Reverte se o servidor recusar (ex.:
    // downwind em_andamento, ou permissão perdida entre o clique e a resposta).
    setEvents((prev) => prev.filter((ev) => ev.id !== eventId));
    try {
      await api(`/api/events/${eventId}`, { method: 'DELETE' });
      return { ok: true };
    } catch (err) {
      setEvents(anterior);
      return { ok: false, error: err instanceof Error ? err.message : 'Não foi possível apagar o evento.' };
    }
  };

  const createDownwind = async (data: {
    title: string;
    location: string;
    description: string;
    spotSaidaId: string;
    spotChegadaId?: string;
    previstoPara: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    try {
      await api<{ id: string; downwindId: string }>('/api/events', {
        method: 'POST',
        body: JSON.stringify({ type: 'Downwind', ...data }),
      });
      await loadFeedAndEvents();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Não foi possível criar o downwind.' };
    }
  };

  // --- Funções do Sistema SOS ---
  const fetchActiveSos = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const data = await api<{ alerts: SosAlertData[] }>('/api/sos/active', { cache: 'no-store' });
      const list = data?.alerts || [];
      setAllActiveSosList(list);

      // SOS ativo emitido pelo próprio usuário
      const mySos = list.find(
        (a) => a.userId === user?.id && (a.status === 'ativo' || a.status === 'em_atendimento')
      );
      setMyActiveSos(mySos || null);

      // SOS recebido de outro velejador (ainda não dispensado pelo usuário)
      const incoming = list.find(
        (a) =>
          a.userId !== user?.id &&
          (a.status === 'ativo' || a.status === 'em_atendimento') &&
          !dismissedSosIdsRef.current.has(a.id)
      );
      setIncomingSosAlert(incoming || null);
    } catch {
      // Falha temporária de rede
    }
  }, [isAuthenticated, user?.id]);

  const dismissIncomingSos = useCallback(() => {
    if (incomingSosAlert) {
      dismissedSosIdsRef.current.add(incomingSosAlert.id);
    }
    setIncomingSosAlert(null);
  }, [incomingSosAlert]);

  const respondToSos = useCallback(
    async (sosId: string, state: 'a_caminho' | 'nao_posso') => {
      try {
        await api(`/api/sos/${sosId}/respond`, {
          method: 'POST',
          body: JSON.stringify({ state }),
        });
        await fetchActiveSos();
      } catch (err) {
        console.error('[sos] Erro ao responder SOS:', err);
      }
    },
    [fetchActiveSos]
  );

  const cancelMySos = useCallback(async () => {
    if (!myActiveSos) return;
    try {
      await api(`/api/sos/${myActiveSos.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelado', resolutionNote: 'Cancelado pelo autor' }),
      });
      setMyActiveSos(null);
      await fetchActiveSos();
    } catch (err) {
      console.error('[sos] Erro ao cancelar SOS:', err);
    }
  }, [myActiveSos, fetchActiveSos]);

  // Polling regular de SOS a cada 12 segundos quando logado
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchActiveSos();
    const interval = setInterval(fetchActiveSos, 12000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchActiveSos]);

  // Reporta a posição em qualquer tela, não só no Mapa: é o que permite um SOS
  // de outro velejador encontrar quem está por perto para socorrer.
  usePositionBeacon(isAuthenticated);

  const refreshWindData = () => {
    setIsRefreshing(true);
    loadSpots(true).finally(() => setIsRefreshing(false));
  };

  const refreshListings = useCallback(() => {
    setListingsVersion((v) => v + 1);
  }, []);

  return (
    <KiteDataContext.Provider
      value={{
        spots,
        selectedSpot,
        setSelectedSpot,
        toggleFavorite,
        searchQuery,
        setSearchQuery,
        selectedStateFilter,
        setSelectedStateFilter,
        sessions,
        addSession,
        deleteSession,
        posts,
        addPost,
        toggleLikePost,
        addComment,
        safetyAlerts,
        addSafetyAlert,
        events,
        toggleEventRegistration,
        deleteEvent,
        createDownwind,
        windUnit,
        setWindUnit,
        convertWind,
        beachMode,
        setBeachMode,
        unreadChatCount,
        setUnreadChatCount,
        latestIncomingMessage,
        setLatestIncomingMessage,
        clearUnreadChat,
        dmUnreadCount,
        latestIncomingDm,
        clearDmUnread,
        myActiveSos,
        incomingSosAlert,
        allActiveSosList,
        setMyActiveSos,
        dismissIncomingSos,
        respondToSos,
        cancelMySos,
        fetchActiveSos,
        isSidebarOpen,
        setIsSidebarOpen,
        isLoggerOpen,
        setIsLoggerOpen,
        loggerPrefill,
        abrirLoggerComResumo,
        limparLoggerPrefill,
        isCalculatorOpen,
        setIsCalculatorOpen,
        isNewPostOpen,
        setIsNewPostOpen,
        isNewAlertOpen,
        setIsNewAlertOpen,
        isNewListingOpen,
        setIsNewListingOpen,
        isBuscaVelejadoresOpen,
        setIsBuscaVelejadoresOpen,
        riderIdAberto,
        setRiderIdAberto,
        sessaoIdAberta,
        setSessaoIdAberta,
        isNotificacoesAbertas,
        setIsNotificacoesAbertas,
        notificacoesNaoLidas,
        zerarNotificacoesNaoLidas,
        isChamadosAbertos,
        setIsChamadosAbertos,
        listingsVersion,
        refreshListings,
        activeTab,
        setActiveTab,
        refreshWindData,
        isRefreshing,
        isHydrated,
        lastKnownPosition,
        setLastKnownPosition,
      }}
    >
      {children}
    </KiteDataContext.Provider>
  );
};

export const useKiteData = () => {
  const context = useContext(KiteDataContext);
  if (!context) {
    throw new Error('useKiteData must be used within a KiteDataProvider');
  }
  return context;
};
