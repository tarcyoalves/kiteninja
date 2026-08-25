'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Envia a posição do velejador para `POST /api/downwind/[id]/posicoes`.
 *
 * Casca fina no mesmo espírito de lib/usePositionBeacon.ts, com duas
 * diferenças deliberadas: cadência de 45s (não 90s — é segurança de
 * travessia, não presença geral) e NUNCA pausa sozinho enquanto o downwind
 * está em andamento.
 *
 * POR QUE NÃO PAUSA MAIS COM `document.hidden` (bug relatado no Android):
 * este hook pausava quando o documento ficava oculto. Só que "oculto" é
 * exatamente o estado normal de quem está velejando: o celular vai para o
 * bolso do colete e a tela apaga. O rastreamento morria no instante em que
 * passava a importar, e em terra a última posição congelava sem nenhum erro
 * na tela — o pior tipo de falha num app de segurança.
 *
 * Pausar quando oculto nunca economizou nada de verdade: se o navegador
 * decidir congelar a página em segundo plano, o `setInterval` simplesmente
 * não dispara e nada é enviado de qualquer forma. O guard só garantia que,
 * NAS janelas em que o sistema deixava a página rodar, a gente se recusasse
 * a usá-las.
 *
 * LIMITE REAL, que nenhuma mudança neste arquivo resolve: com o app FECHADO
 * (removido dos recentes) não existe JavaScript rodando — nem PWA, nem TWA.
 * Rastreio com app fechado exige um Foreground Service nativo no Android.
 * Ver docs/ANTIGRAVITY-FINDINGS.md (ANT-003) e docs/PLANO-APP-NATIVO.md.
 * A defesa possível no lado web é manter a página VIVA enquanto o downwind
 * corre — é o que o Wake Lock em context/DownwindContext.tsx faz.
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
      // Sem checar `document.hidden`: o celular no colete, com a tela
      // apagada, é o cenário-alvo deste beacon — ver o cabeçalho.
      if (emVoo.current) return;
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

    // Voltar ao primeiro plano dispara um envio imediato: se o sistema
    // congelou a página enquanto ela estava em segundo plano, este é o
    // primeiro instante em que dá para recuperar o atraso.
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
