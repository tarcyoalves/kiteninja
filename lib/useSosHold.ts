'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { TEXTO_FALHA_REDE } from './emergencia';

/**
 * Lógica de disparo do SOS por press-and-hold, extraída para ser reaproveitada
 * onde quer que o gatilho de socorro apareça (hoje: dentro do menu do avatar).
 *
 * REGRA FUNDAMENTAL: este gatilho será apertado por alguém dentro da água,
 * possivelmente se afogando. Nada pode bloquear o disparo.
 *
 * Press-and-hold de 800ms com anel de progresso previne toque acidental
 * (bolso, mochila, respingo), mas NÃO adiciona confirmação de dois passos
 * que poderia custar segundos em emergência real.
 *
 * Se a geolocalização demorar, o SOS sai sem coordenada.
 * Se a rede falhar, expõe `error` para a UI mostrar 193/185 para discagem direta.
 */

const HOLD_DURATION_MS = 800;
const GEO_TIMEOUT_MS = 3000;

interface UseSosHoldArgs {
  /** Chamado após o POST /api/sos retornar ok. */
  onSosTriggered: (data: {
    lat: number | null;
    lng: number | null;
    accuracyM: number | null;
  }) => void;
  /** Se já há SOS ativo, o hold não dispara nada. */
  hasActiveSos: boolean;
}

export interface SosHoldState {
  holdProgress: number;
  sending: boolean;
  error: string | null;
  setError: (v: string | null) => void;
  startHold: () => void;
  cancelHold: () => void;
}

export function useSosHold({ onSosTriggered, hasActiveSos }: UseSosHoldArgs): SosHoldState {
  const [holdProgress, setHoldProgress] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStart = useRef<number>(0);
  const triggered = useRef(false);

  // Limpa timers ao desmontar — evita setState em componente desmontado
  useEffect(() => {
    return () => {
      if (holdTimer.current) clearInterval(holdTimer.current);
    };
  }, []);

  const dispatchSos = useCallback(async () => {
    setSending(true);

    // Tenta obter geolocalização com prazo curto — se não conseguir,
    // o SOS sai sem coordenada. Melhor um SOS sem posição que nenhum SOS.
    let lat: number | null = null;
    let lng: number | null = null;
    let accuracyM: number | null = null;

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('sem GPS'));
          return;
        }
        const timeoutId = setTimeout(() => reject(new Error('timeout')), GEO_TIMEOUT_MS);
        navigator.geolocation.getCurrentPosition(
          (p) => { clearTimeout(timeoutId); resolve(p); },
          (e) => { clearTimeout(timeoutId); reject(e); },
          { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 60000 }
        );
      });
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
      accuracyM = pos.coords.accuracy;
    } catch {
      // Sem GPS é ok — o SOS sai de todo jeito
    }

    try {
      const res = await fetch('/api/sos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, accuracyM }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Falha ao enviar SOS');
        return;
      }

      onSosTriggered({ lat, lng, accuracyM });
    } catch {
      // Rede falhou — a UI mostra os botões de discagem junto deste texto.
      setError(TEXTO_FALHA_REDE);
    } finally {
      setSending(false);
      setHoldProgress(0);
    }
  }, [onSosTriggered]);

  const startHold = useCallback(() => {
    if (sending || hasActiveSos) return;
    triggered.current = false;
    holdStart.current = Date.now();
    setHoldProgress(0);
    setError(null);

    holdTimer.current = setInterval(() => {
      const elapsed = Date.now() - holdStart.current;
      const progress = Math.min(elapsed / HOLD_DURATION_MS, 1);
      setHoldProgress(progress);

      if (progress >= 1 && !triggered.current) {
        triggered.current = true;
        if (holdTimer.current) clearInterval(holdTimer.current);

        // Vibração de confirmação: o velejador sente que disparou
        try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignora */ }

        dispatchSos();
      }
    }, 16); // ~60fps para o anel de progresso ser fluido
  }, [sending, hasActiveSos, dispatchSos]);

  const cancelHold = useCallback(() => {
    if (holdTimer.current) {
      clearInterval(holdTimer.current);
      holdTimer.current = null;
    }
    if (!triggered.current) {
      setHoldProgress(0);
    }
  }, []);

  return { holdProgress, sending, error, setError, startHold, cancelHold };
}
