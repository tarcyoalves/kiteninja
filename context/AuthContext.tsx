'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Discipline, RiderLevel, UserProfile } from '../types';
import { FCM_TOKEN_STORAGE_KEY } from '../lib/usePushNotifications';

interface AuthContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  /** admin/moderator/instructor pelo role, ou rider com a liberação pontual. */
  canOrganizeDownwind: boolean;
  /** admin ou moderator — espelha lib/authz.ts `canModerate`. Usado para
   * mostrar ações de moderação (ex.: apagar qualquer evento) na UI; a rota
   * sempre reautoriza no servidor, isto só evita mostrar um botão que
   * daria 403. */
  canModerateEvents: boolean;
  /** null enquanto a sessão está sendo verificada no primeiro carregamento. */
  isLoading: boolean;
  mustChangePassword: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  changePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<{ ok: boolean; error?: string }>;
  updateProfile: (data: Partial<UserProfile>) => Promise<{ ok: boolean; error?: string }>;
  refresh: () => Promise<void>;
  isAuthModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  /**
   * Mantido por compatibilidade com componentes existentes. Não há mais
   * auto-cadastro: contas só nascem de um link de convite do admin.
   */
  authMode: 'login';
  setAuthMode: (mode: 'login') => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canOrganizeDownwind, setCanOrganizeDownwind] = useState(false);
  const [canModerateEvents, setCanModerateEvents] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  /** Busca a sessão no servidor. O cookie é httpOnly: o JS nunca o lê. */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!res.ok) {
        setUser(null);
        setIsAdmin(false);
        setCanOrganizeDownwind(false);
        setCanModerateEvents(false);
        return;
      }

      const data = await res.json();
      if (!data.user) {
        setUser(null);
        setIsAdmin(false);
        setCanOrganizeDownwind(false);
        setCanModerateEvents(false);
        setMustChangePassword(false);
        return;
      }

      const { role, mustChangePassword: mustChange, canOrganizeDownwind: canOrganize, ...profile } = data.user;
      setUser(profile as UserProfile);
      setIsAdmin(role === 'admin');
      setCanOrganizeDownwind(Boolean(canOrganize));
      setCanModerateEvents(role === 'admin' || role === 'moderator');
      setMustChangePassword(Boolean(mustChange));
    } catch {
      // Offline: mantemos o estado anterior em vez de deslogar o velejador que
      // está na praia sem sinal.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    /*
     * FALSO POSITIVO, verificado à mão: `refresh` é `async` e todo `setState`
     * dela acontece depois do `await fetch('/api/auth/me')`. O React Compiler
     * não enxerga através da fronteira `async` e assume o pior.
     *
     * O QUE TORNARIA ISTO UM ERRO DE VERDADE: um `setState` acrescentado em
     * `refresh` ANTES do primeiro `await` — um `setIsLoading(true)` no topo,
     * por exemplo. Se isso acontecer, este comentário passa a mentir.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver acima
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();

        if (!res.ok) return { ok: false, error: data.error ?? 'Não foi possível entrar.' };

        await refresh();
        setIsAuthModalOpen(false);
        return { ok: true };
      } catch {
        return { ok: false, error: 'Falha de conexão. Verifique a internet.' };
      }
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    // Desvincula somente ESTE aparelho da conta enquanto o cookie de sessão
    // ainda existe. Não chama Plugin.unregister(): o mesmo aparelho pode entrar
    // em outra conta e reutilizar seu token FCM normalmente.
    const fcmToken = localStorage.getItem(FCM_TOKEN_STORAGE_KEY);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fcmToken }),
      });
      localStorage.removeItem(FCM_TOKEN_STORAGE_KEY);
    } finally {
      setUser(null);
      setIsAdmin(false);
      setCanOrganizeDownwind(false);
      setCanModerateEvents(false);
      setMustChangePassword(false);
    }
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      try {
        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        const data = await res.json();

        if (!res.ok) return { ok: false, error: data.error ?? 'Não foi possível trocar a senha.' };

        // A troca mantém a sessão atual viva (só as outras são encerradas no
        // servidor), então basta atualizar o estado a partir do /me para o
        // bloqueio de "precisa trocar a senha" sumir sem pedir novo login.
        await refresh();
        return { ok: true };
      } catch {
        return { ok: false, error: 'Falha de conexão.' };
      }
    },
    [refresh]
  );

  const updateProfile = useCallback(
    async (data: Partial<UserProfile>) => {
      // Atualização otimista: a UI responde na hora, e o servidor confirma.
      const previous = user;
      setUser((prev) => (prev ? { ...prev, ...data } : prev));

      try {
        const res = await fetch('/api/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        if (!res.ok) {
          setUser(previous);
          const body = await res.json();
          return { ok: false, error: body.error ?? 'Não foi possível salvar o perfil.' };
        }

        await refresh();
        return { ok: true };
      } catch {
        setUser(previous);
        return { ok: false, error: 'Falha de conexão.' };
      }
    },
    [refresh, user]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: Boolean(user),
        isAdmin,
        canOrganizeDownwind,
        canModerateEvents,
        isLoading,
        mustChangePassword,
        login,
        logout,
        changePassword,
        updateProfile,
        refresh,
        isAuthModalOpen,
        openAuthModal: () => setIsAuthModalOpen(true),
        closeAuthModal: () => setIsAuthModalOpen(false),
        authMode: 'login',
        setAuthMode: () => {},
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth precisa estar dentro de AuthProvider');
  return context;
};

/**
 * Igual a `useAuth()`, mas devolve `undefined` em vez de lançar quando não há
 * `AuthProvider` na árvore — para componentes reaproveitados FORA do app
 * principal, como components/DownwindChat.tsx a partir de
 * app/dw-motorista/[token]/ConvidadoView.tsx (a página do link de convidado
 * não monta AuthProvider de propósito — a sessão de convidado não deve
 * herdar o app inteiro por engano). Preferido a um `try/catch` em volta de
 * `useAuth()`: hook dentro de try/catch é sinalizado pelo eslint-plugin-
 * react-hooks e quebra a garantia de que hooks são sempre chamados na mesma
 * ordem.
 */
export const useAuthOptional = () => useContext(AuthContext);
