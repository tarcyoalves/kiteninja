'use client';

import { useCallback, useRef, useState } from 'react';
import { clampAlturaMapaSplitApoio } from './downwind';

/**
 * Divisor arrastável entre mapa e chat da tela do motorista (apoio em
 * terra) — tanto na versão com conta (views/DownwindAoVivoView.tsx) quanto
 * na do link de convidado sem conta (app/dw-motorista/[token]/ConvidadoView.tsx).
 * Extraído num hook só porque as duas telas precisam do MESMO gesto — duas
 * cópias da lógica de arrasto divergindo é o tipo de bug que só aparece numa
 * das duas depois.
 *
 * A posição é calculada relativa ao CONTAINER (não ao próprio elemento da
 * alça): com `setPointerCapture` no pointerdown, o navegador continua
 * entregando `pointermove` para este elemento mesmo que o dedo saia da faixa
 * fina da alça durante o arrasto — sem isso, um arrasto rápido "perde" o
 * gesto assim que o dedo sai da hitbox de poucos pixels da alça.
 */
export function useSplitArrastavel(inicialPct = 50) {
  const [alturaMapaPct, setAlturaMapaPct] = useState(() => clampAlturaMapaSplitApoio(inicialPct));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const arrastando = useRef(false);

  const aplicarPosicao = useCallback((clientY: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return;
    const pct = ((clientY - rect.top) / rect.height) * 100;
    setAlturaMapaPct(clampAlturaMapaSplitApoio(pct));
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      arrastando.current = true;
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch {
        // Navegador sem suporte a pointer capture: o arrasto ainda funciona
        // enquanto o dedo ficar sobre a alça, só perde o "seguir fora dela".
      }
      aplicarPosicao(e.clientY);
    },
    [aplicarPosicao]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!arrastando.current) return;
      aplicarPosicao(e.clientY);
    },
    [aplicarPosicao]
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    arrastando.current = false;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      // Já liberado ou nunca capturado — nada a fazer.
    }
  }, []);

  return {
    /** No container do split (mapa + alça + chat), não na alça em si. */
    containerRef,
    alturaMapaPct,
    setAlturaMapaPct,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
