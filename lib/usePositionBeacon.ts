'use client';

import { useEffect, useRef } from 'react';

/**
 * Mantém `user_presence.lat/lng` fresco em QUALQUER tela do app.
 *
 * Por que existe, mesmo com o heartbeat do ChatView já mandando coordenada:
 * aquele reenvia `lastKnownPosition`, que só é preenchido pelo `watchPosition`
 * do MapView. Ou seja, a posição só chegava ao banco se o velejador tivesse
 * aberto a aba Mapa E DEPOIS a aba Chat, na mesma sessão — as duas views montam
 * condicionalmente por `activeTab`. Quem abre o app no feed e deixa no bolso
 * (o caso comum na praia) não tinha posição nenhuma, e a seleção de candidatos
 * de um SOS (lib/sosCandidates.ts) caía no fallback do spot declarado ou
 * simplesmente não achava essa pessoa.
 *
 * O GPS aqui é deliberadamente barato, ao contrário do MapView: sem
 * `enableHighAccuracy` (não precisa desenhar pino, precisa saber o bairro) e
 * aceitando fix em cache. A ideia é não acender o rádio de GPS no meio de uma
 * sessão de kite só para manter presença.
 *
 * Falhar é normal e silencioso: permissão negada, sem sinal, timeout. Nesses
 * casos não manda nada — `touchPresence` usa COALESCE, então um heartbeat sem
 * coordenada preservaria a anterior, mas gastar requisição para isso é
 * desnecessário; o heartbeat de presença do polling de SOS já prova que a
 * pessoa está online.
 */

/**
 * Intervalo entre coletas. Confortavelmente dentro da janela de 15 min que o
 * SOS considera (JANELA_PRESENCA_MS), com folga para vários ciclos perdidos por
 * falta de sinal antes de a posição ser considerada velha.
 */
const INTERVALO_MS = 90_000;

/**
 * Idade máxima de um fix em cache. Dois minutos mantém a coordenada útil para
 * busca por raio sem forçar leitura nova do GPS a cada ciclo.
 */
const MAX_IDADE_FIX_MS = 120_000;

/**
 * Exportada para teste: é aqui que mora a regra que não pode quebrar — GPS
 * indisponível, negado ou lento resolve `null` em vez de rejeitar. Uma rejeição
 * escapando daqui derrubaria o heartbeat inteiro.
 */
export function lerPosicao(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: MAX_IDADE_FIX_MS }
    );
  });
}

export function usePositionBeacon(ativo: boolean): void {
  // Evita empilhar requisições quando o 4G da praia demora mais que o intervalo.
  const emVoo = useRef(false);

  useEffect(() => {
    if (!ativo) return;

    let cancelado = false;

    const enviar = async () => {
      if (emVoo.current || document.hidden) return;
      emVoo.current = true;
      try {
        const pos = await lerPosicao();
        if (cancelado || !pos) return;
        await fetch('/api/chat/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Sem `room` e sem `atSpotId` de propósito: este beacon diz "estou com
          // o app aberto, aqui", não "estou nesta conversa" nem "estou neste
          // spot". Mandar room aqui sobrescreveria a sala do ChatView e
          // inventaria presença numa conversa que ninguém está lendo; mandar
          // atSpotId nulo apagaria o spot que o velejador declarou à mão.
          body: JSON.stringify({ lat: pos.lat, lng: pos.lng }),
        });
      } catch {
        // Presença é best-effort: nunca deve estourar na UI.
      } finally {
        emVoo.current = false;
      }
    };

    enviar();
    const id = setInterval(enviar, INTERVALO_MS);

    // Voltar ao app depois de um tempo em background: coleta na hora, em vez de
    // esperar o próximo tick com uma posição possivelmente de outro lugar.
    const onVisibility = () => {
      if (!document.hidden) enviar();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelado = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ativo]);
}
