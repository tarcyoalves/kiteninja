'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ESTADO_INICIAL_TRILHA,
  EstadoTrilha,
  marcarIndisponivel,
  processarAmostra,
} from './trilhaSessao';
import type { PontoTrilha } from './trilhaDownwind';

/**
 * Casca fina sobre `watchPosition`: toda decisão (aceitar/rejeitar amostra,
 * acumular distância, calcular velocidade) mora em `lib/trilhaSessao.ts`,
 * que é testável em Node puro. Este hook só liga o evento do navegador à
 * função pura `processarAmostra`.
 *
 * `enableHighAccuracy: true` aqui, ao contrário de `usePositionBeacon.ts`
 * (que usa `false` de propósito para poupar bateria, pois só precisa saber
 * a região para o SOS e roda o tempo todo). Aqui a conta é diferente:
 * velocidade e distância exigem precisão, e este hook só liga
 * `watchPosition` de alta precisão enquanto `ativo` é true — ou seja,
 * enquanto o Modo Navegação está de fato na tela. Isso é exatamente quando
 * a tela já está ligada por causa do Wake Lock (ver `useWakeLock.ts`) e o
 * velejador pediu para ver esses números: não há bateria extra sendo gasta
 * "de graça", o custo de `enableHighAccuracy` já está coberto pelo consumo
 * que a própria tela acesa da feature já implica.
 */
export interface TrilhaSessao {
  /** Distância acumulada em km desde o início da sessão. */
  distanciaKm: number;
  /** Velocidade atual em nós. `null` quando ainda não há leitura confiável. */
  velocidadeNos: number | null;
  /** Maior velocidade em nós observada na sessão. 0 se nenhuma ainda. */
  velocidadeMaxNos: number;
  /** Instante da última posição aceita. `null` se nenhuma ainda. */
  ultimaPosicaoEm: Date | null;
  /** true se o GPS não está disponível ou a permissão foi negada. */
  indisponivel: boolean;
  /**
   * Geometria da trilha (pontos aceitos, na ordem em que chegaram) — ver
   * `EstadoTrilha.pontos` em `lib/trilhaSessao.ts`. É o que `ModoNavegacao`
   * repassa em `ResumoNavegacao.trilha` ao sair, para o registro no logbook
   * (`paraPrefillLogbook`) ter uma geometria para reduzir e enviar.
   */
  pontos: PontoTrilha[];
}

function paraTrilhaSessao(estado: EstadoTrilha): TrilhaSessao {
  const { distanciaKm, velocidadeNos, velocidadeMaxNos, ultimaPosicaoEm, indisponivel, pontos } = estado;
  return { distanciaKm, velocidadeNos, velocidadeMaxNos, ultimaPosicaoEm, indisponivel, pontos };
}

export function useTrilhaSessao(ativo: boolean): TrilhaSessao {
  const [estado, setEstado] = useState<EstadoTrilha>(ESTADO_INICIAL_TRILHA);
  // Guarda o estado bruto (com `ultimaReferencia`, que não faz parte do
  // retorno público) fora do React state para não expor esse campo interno
  // via `paraTrilhaSessao` a cada leitura, mantendo a interface pública
  // exatamente como especificada.
  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  useEffect(() => {
    if (!ativo) return;

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setEstado((atual) => marcarIndisponivel(atual));
      return;
    }

    // Reinicia a trilha a cada vez que o Modo Navegação é reaberto: uma
    // sessão nova de navegação não deve herdar distância/velocidade máxima
    // de uma sessão anterior que ficou fechada no meio do caminho.
    setEstado(ESTADO_INICIAL_TRILHA);

    const watchId = navigator.geolocation.watchPosition(
      (posicao) => {
        const novoEstado = processarAmostra(estadoRef.current, {
          lat: posicao.coords.latitude,
          lng: posicao.coords.longitude,
          accuracy: posicao.coords.accuracy,
          speedMps: posicao.coords.speed,
          timestampMs: posicao.timestamp,
        });
        estadoRef.current = novoEstado;
        setEstado(novoEstado);
      },
      () => {
        // Permissão negada, sinal perdido de forma persistente, timeout: sinaliza
        // indisponibilidade sem apagar a distância já acumulada (ver
        // `marcarIndisponivel`).
        const novoEstado = marcarIndisponivel(estadoRef.current);
        estadoRef.current = novoEstado;
        setEstado(novoEstado);
      },
      // Sem `maximumAge`: aceitar fix em cache aqui reintroduziria o mesmo
      // problema que este hook existe para evitar (posições velhas
      // maquiadas de novas, inflando ou zerando velocidade). `timeout`
      // generoso porque um GPS de alta precisão em mar aberto pode demorar
      // mais para fechar um fix do que em terra.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [ativo]);

  return paraTrilhaSessao(estado);
}
