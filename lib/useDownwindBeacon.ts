'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Envia a posição do velejador para `POST /api/downwind/[id]/posicoes`.
 *
 * Casca fina no mesmo espírito de lib/usePositionBeacon.ts, com duas
 * diferenças deliberadas: cadência de 45s (não 90s — é segurança de
 * travessia, não presença geral) e SÓ pausa com `document.hidden`, nunca por
 * qualquer outro motivo. Enquanto o velejador está navegando, o envio de
 * posição não pode parar por causa de UI (chat aberto, Modo Navegação
 * ativo) — só a aba/app sair de primeiro plano é motivo válido.
 */

const INTERVALO_MS = 45_000;
const MAX_IDADE_FIX_MS = 60_000;

export function lerPosicaoAlta(): Promise<{ lat: number; lng: number; accuracyM: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: MAX_IDADE_FIX_MS }
    );
  });
}

export interface DownwindBeaconState {
  /** Instante do último POST CONFIRMADO pelo servidor (2xx), não da tentativa. */
  ultimaPosicaoEm: Date | null;
}

export function useDownwindBeacon(downwindId: string | null, ativo: boolean): DownwindBeaconState {
  const emVoo = useRef(false);
  const [ultimaPosicaoEm, setUltimaPosicaoEm] = useState<Date | null>(null);

  useEffect(() => {
    if (!ativo || !downwindId) return;
    let cancelado = false;

    const enviar = async () => {
      if (emVoo.current || document.hidden) return;
      emVoo.current = true;
      try {
        const pos = await lerPosicaoAlta();
        if (cancelado || !pos) return;
        const resp = await fetch(`/api/downwind/${downwindId}/posicoes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: pos.lat, lng: pos.lng, accuracyM: pos.accuracyM }),
        });
        // fetch só rejeita em falha de rede: 4xx/5xx resolve normalmente. Sem
        // checar `ok`, um erro do servidor contaria como posição entregue e o
        // indicador de sinal mentiria para quem acompanha em terra.
        if (!cancelado && resp.ok) setUltimaPosicaoEm(new Date());
      } catch {
        // Best-effort: nunca deve estourar na UI de quem está na água.
      } finally {
        emVoo.current = false;
      }
    };

    enviar();
    const id = setInterval(enviar, INTERVALO_MS);

    const onVisibility = () => {
      if (!document.hidden) enviar();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelado = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ativo, downwindId]);

  return { ultimaPosicaoEm };
}
