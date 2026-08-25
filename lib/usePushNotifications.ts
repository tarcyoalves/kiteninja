'use client';

import { useEffect, useState, useCallback, useRef, useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';

// Tipo genérico para o módulo Capacitor - lazy-loaded para evitar erros em browser/pwa
interface PushNotificationsPlugin {
  register: () => Promise<void>;
  unregister: () => Promise<void>;
  checkPermissions: () => Promise<{ receive: string }>;
  requestPermissions: () => Promise<{ receive: string }>;
  addListener: (event: string, callback: (event: unknown) => void) => Promise<{ remove: () => void }>;
  removeAllListeners: () => Promise<void>;
  createChannel: (channel: {
    id: string;
    name: string;
    description?: string;
    importance?: number;
    visibility?: number;
  }) => Promise<void>;
}

/**
 * Precisa bater com o channelId usado em lib/push.ts (sendFcmToUser) — se
 * divergir, o Android cai no canal fallback padrão do Firebase em vez do
 * canal de alta importância que garante que o SOS soe mesmo com o telefone
 * silenciado.
 */
const ALERTS_CHANNEL_ID = 'kiteninja_alerts';
/** Token do aparelho atual; usado para desvinculá-lo da conta no logout. */
export const FCM_TOKEN_STORAGE_KEY = 'kiteninja_fcm_token';

/**
 * Hook para gerenciar push notifications nativas no app Capacitor/Android.
 *
 * Detecta se está rodando em app nativo (Capacitor), solicita permissão,
 * obtém o token FCM e registra no backend.
 *
 * Uso:
 *   const { isSupported, isEnabled, error } = usePushNotifications();
 *
 * O hook registra o token automaticamente ao ser autorizado.
 *
 * `onOpenUrl` é chamado com o campo `data.url` (mesmo formato usado pelo Web
 * Push — ex.: "/?tab=mapa&sos=123") quando o velejador toca numa notificação
 * com o app em background/fechado. Deixa a navegação real (setActiveTab,
 * refetch de SOS etc.) para quem chama o hook, já que este arquivo não tem
 * acesso ao KiteDataContext.
 */
export function usePushNotifications(
  enabled: boolean = true,
  onOpenUrl?: (url: string) => void,
) {
  const [isSupported, setIsSupported] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const pushPluginRef = useRef<PushNotificationsPlugin | null>(null);

  // Ref em vez de dependência do efeito: `onOpenUrl` costuma ser uma closure
  // nova a cada render de quem chama o hook (ex.: fecha sobre setActiveTab do
  // contexto), e não queremos reinicializar registro/listeners do push só
  // porque essa closure mudou de identidade.
  const onOpenUrlRef = useRef(onOpenUrl);
  useEffect(() => {
    onOpenUrlRef.current = onOpenUrl;
  }, [onOpenUrl]);

  // O mesmo resultado no servidor e no primeiro render do cliente evita
  // hydration mismatch; após hidratar, o snapshot real identifica Capacitor.
  const isNativeApp = useIsNativeApp();

  // Registra o token no backend
  const registerToken = useCallback(async (token: string) => {
    try {
      const res = await fetch('/api/push/fcm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const data = await res.json();
        console.error('[push] Erro ao registrar token:', data.error);
        setError(data.error || 'Erro ao registrar token');
        return false;
      }
      console.log('[push] Token FCM registrado com sucesso');
      localStorage.setItem(FCM_TOKEN_STORAGE_KEY, token);
      setIsRegistered(true);
      return true;
    } catch (err) {
      console.error('[push] Erro de rede ao registrar token:', err);
      setError('Erro de conexão');
      return false;
    }
  }, []);

  // Remove o token do backend
  const unregisterToken = useCallback(async (token: string) => {
    try {
      await fetch('/api/push/fcm', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      setIsRegistered(false);
    } catch (err) {
      console.error('[push] Erro ao remover token:', err);
    }
  }, []);

  // Inicializa o push notifications
  useEffect(() => {
    // `enabled` gate no login: POST /api/push/fcm exige requireUser(). Sem
    // isto, o app pediria permissão e tentaria registrar o token antes do
    // velejador logar, e a chamada morreria em 401 (mesmo padrão de
    // usePositionBeacon(isAuthenticated) em context/KiteDataContext.tsx).
    if (!isNativeApp || !enabled) {
      return;
    }

    let token: string | null = null;

    const init = async () => {
      try {
        // Lazy-load do plugin para evitar erros em browser/pwa
        const { PushNotifications: Plugin } = await import('@capacitor/push-notifications');
        pushPluginRef.current = Plugin as unknown as PushNotificationsPlugin;

        // Cria o canal de notificação de alta importância ANTES de registrar.
        // Sem isso, o Android 8+ usa o canal fallback do Firebase (importância
        // padrão) para os pushes com channelId: 'kiteninja_alerts' enviados
        // por lib/push.ts — e um SOS pode não soar/vibrar com o telefone no
        // modo silencioso. createChannel é idempotente (id repetido não duplica).
        try {
          await Plugin.createChannel({
            id: ALERTS_CHANNEL_ID,
            name: 'Alertas KiteNinja',
            description: 'SOS e alertas urgentes de velejadores',
            importance: 5, // IMPORTANCE_HIGH
            visibility: 1, // VISIBILITY_PUBLIC
          });
        } catch (channelErr) {
          console.error('[push] Erro ao criar canal de notificação:', channelErr);
        }

        // Verifica e, se necessário, solicita a permissão. Mantemos o estado
        // retornado pelo request: usar o snapshot anterior (`prompt`) faria a
        // UI continuar dizendo que push está desativado mesmo após o usuário
        // tocar em "Permitir".
        let permStatus = await Plugin.checkPermissions();
        if (permStatus.receive === 'prompt') {
          permStatus = await Plugin.requestPermissions();
        }
        if (permStatus.receive !== 'granted') {
          console.log('[push] Permissão negada');
          setIsEnabled(false);
          setIsLoading(false);
          return;
        }
        setIsEnabled(true);

        // Os listeners precisam existir ANTES de register(): alguns aparelhos
        // devolvem o token imediatamente e o evento seria perdido se o registro
        // viesse primeiro.
        await Plugin.addListener('registration', (event: unknown) => {
          const e = event as { token: string };
          token = e.token;
          console.log('[push] Token FCM recebido');
          void registerToken(token);
        });

        await Plugin.addListener('registrationError', (event: unknown) => {
          const e = event as { error: string };
          console.error('[push] Erro ao registrar push:', e.error);
          setError(e.error);
        });

        await Plugin.addListener('pushNotificationReceived', (notification: unknown) => {
          console.log('[push] Notificação recebida:', notification);
        });

        await Plugin.addListener('pushNotificationActionPerformed', (event: unknown) => {
          const e = event as { notification?: { data?: { url?: string } } };
          const url = e?.notification?.data?.url;
          console.log('[push] Ação em notificação');
          if (url && onOpenUrlRef.current) {
            onOpenUrlRef.current(url);
          }
        });

        await Plugin.register();

        setIsSupported(true);
        setIsLoading(false);
      } catch (err) {
        console.error('[push] Erro ao inicializar push:', err);
        setError(err instanceof Error ? err.message : 'Erro desconhecido');
        setIsSupported(false);
        setIsLoading(false);
      }
    };

    init();

    // Cleanup
    return () => {
      if (pushPluginRef.current) {
        pushPluginRef.current.removeAllListeners?.();
      }
    };
  }, [isNativeApp, enabled, registerToken]);

  return {
    /** true se Capacitor + plugin disponível */
    isSupported: enabled && isNativeApp && isSupported,
    /** true se permissão concedida */
    isEnabled: enabled && isEnabled,
    /** true se token registrado no backend */
    isRegistered: enabled && isRegistered,
    isLoading: enabled && isNativeApp && isLoading,
    error,
    unregisterToken,
  };
}

/**
 * Hook simplificado para verificar se o app é nativo (Capacitor).
 * Útil para decisões de UI (mostrar instruções de PWA vs app nativo).
 */
export function useIsNativeApp(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => Capacitor.isNativePlatform(),
    () => false,
  );
}
