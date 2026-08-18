'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Spot, SessionLog, CommunityPost, SafetyOccurrence, KiteEvent, WindUnit, Discipline } from '../types';
import { useAuth } from './AuthContext';
import { INITIAL_SPOTS } from '../data/mockSpots';

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
  addSession: (session: Omit<SessionLog, 'id' | 'createdAt' | 'likesCount' | 'commentsCount'>) => void;
  deleteSession: (sessionId: string) => void;

  // Community Feed
  posts: CommunityPost[];
  addPost: (post: Omit<CommunityPost, 'id' | 'likes' | 'comments' | 'shares'>) => void;
  toggleLikePost: (postId: string) => void;
  // userName não é usado: o autor do comentário vem da sessão no servidor.
  addComment: (postId: string, text: string, userName: string) => void;

  // Safety & Events
  safetyAlerts: SafetyOccurrence[];
  addSafetyAlert: (alert: Omit<SafetyOccurrence, 'id' | 'timestamp' | 'status'>) => void;
  events: KiteEvent[];
  toggleEventRegistration: (eventId: string) => void;

  // UI States
  windUnit: WindUnit;
  setWindUnit: (unit: WindUnit) => void;
  convertWind: (knots: number) => { value: number; unitStr: string };
  beachMode: boolean; // Modo alto-contraste para sol forte na praia
  setBeachMode: (enabled: boolean | ((prev: boolean) => boolean)) => void;

  // Modals & Drawers
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  isLoggerOpen: boolean;
  setIsLoggerOpen: (open: boolean) => void;
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
}

const KiteDataContext = createContext<KiteDataContextType | undefined>(undefined);

const TAB_INICIAL: ActiveTab = 'favoritos';

const UUID_RE = /^[0-9a-f-]{36}$/i;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
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
  const { isAuthenticated } = useAuth();

  const [spots, setSpots] = useState<Spot[]>(INITIAL_SPOTS);
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStateFilter, setSelectedStateFilter] = useState('ALL');

  const [sessions, setSessions] = useState<SessionLog[]>([]);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [safetyAlerts, setSafetyAlerts] = useState<SafetyOccurrence[]>([]);
  const [events, setEvents] = useState<KiteEvent[]>([]);
  const [windUnit, setWindUnit] = useState<WindUnit>('nós');
  const [beachMode, setBeachMode] = useState<boolean>(false);

  // Modais e navegação
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoggerOpen, setIsLoggerOpen] = useState(false);
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [isNewPostOpen, setIsNewPostOpen] = useState(false);
  const [isNewAlertOpen, setIsNewAlertOpen] = useState(false);
  const [isNewListingOpen, setIsNewListingOpen] = useState(false);
  const [listingsVersion, setListingsVersion] = useState(0);
  const [activeTab, setActiveTab] = useState<ActiveTab>(TAB_INICIAL);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  const loadSpots = useCallback(async (forceRefresh = false) => {
    try {
      const url = forceRefresh ? `/api/spots?refresh=1&_t=${Date.now()}` : '/api/spots';
      const data = await api<{ spots: Spot[] }>(url, forceRefresh ? { cache: 'no-store' } : undefined);
      if (Array.isArray(data?.spots) && data.spots.length > 0) {
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
                multiModel: old.multiModel,
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

  const loadFeedAndEvents = useCallback(async () => {
    const [postsR, eventsR, alertsR] = await Promise.allSettled([
      api<{ posts: CommunityPost[] }>('/api/posts'),
      api<{ events: KiteEvent[] }>('/api/events'),
      api<{ alerts: SafetyOccurrence[] }>('/api/alerts'),
    ]);
    if (postsR.status === 'fulfilled') setPosts(postsR.value.posts);
    if (eventsR.status === 'fulfilled') setEvents(eventsR.value.events);
    if (alertsR.status === 'fulfilled') setSafetyAlerts(alertsR.value.alerts);
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

  const toggleFavorite = (spotId: string) => {
    // Otimista: a tela reage no toque e desfaz se o servidor recusar.
    const wasFavorite = spots.find((sp) => sp.id === spotId)?.isFavorite ?? false;
    setSpots((prev) => prev.map((sp) => (sp.id === spotId ? { ...sp, isFavorite: !sp.isFavorite } : sp)));
    if (selectedSpot?.id === spotId) {
      setSelectedSpot((prev) => (prev ? { ...prev, isFavorite: !prev.isFavorite } : null));
    }

    api<{ isFavorite: boolean }>('/api/favorites', {
      method: 'POST',
      body: JSON.stringify({ spotId }),
    })
      .then((res) => {
        setSpots((prev) => prev.map((sp) => (sp.id === spotId ? { ...sp, isFavorite: res.isFavorite } : sp)));
      })
      .catch(() => {
        setSpots((prev) => prev.map((sp) => (sp.id === spotId ? { ...sp, isFavorite: wasFavorite } : sp)));
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

  const addSession = (sessionData: Omit<SessionLog, 'id' | 'createdAt' | 'likesCount' | 'commentsCount'>) => {
    // spotId só é aceito pela rota se for o UUID real do banco; "outro"/vazio
    // vira null e a sessão fica com nome/local livres.
    const spotId = sessionData.spotId && UUID_RE.test(sessionData.spotId) ? sessionData.spotId : null;

    api<SessionLog>('/api/sessions', {
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
      }),
    })
      .then((created) => {
        setSessions((prev) => [{ ...created, likesCount: 0, commentsCount: 0 } as SessionLog, ...prev]);
        if (sessionData.isPublic) loadFeedAndEvents();
      })
      .catch(() => {
        // A UI já fechou o modal ao chamar addSession; sem toast de erro aqui
        // ainda, o próximo refresh reflete o estado real do servidor.
      });
  };

  const deleteSession = (sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    api(`/api/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {
      loadSessions();
    });
  };

  const addPost = (postData: Omit<CommunityPost, 'id' | 'likes' | 'comments' | 'shares'>) => {
    api<{ id: string }>('/api/posts', {
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
    })
      .then(() => loadFeedAndEvents())
      .catch(() => {});
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
        windUnit,
        setWindUnit,
        convertWind,
        beachMode,
        setBeachMode,
        isSidebarOpen,
        setIsSidebarOpen,
        isLoggerOpen,
        setIsLoggerOpen,
        isCalculatorOpen,
        setIsCalculatorOpen,
        isNewPostOpen,
        setIsNewPostOpen,
        isNewAlertOpen,
        setIsNewAlertOpen,
        isNewListingOpen,
        setIsNewListingOpen,
        listingsVersion,
        refreshListings,
        activeTab,
        setActiveTab,
        refreshWindData,
        isRefreshing,
        isHydrated,
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
