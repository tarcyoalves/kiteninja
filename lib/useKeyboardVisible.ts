'use client';

import { useEffect, useState } from 'react';

/**
 * Diz se o teclado virtual está (provavelmente) aberto.
 *
 * Precisa cobrir os dois modos de viewport do mobile:
 *
 * 1. `interactive-widget=resizes-content` (o que usamos): o teclado ENCOLHE a
 *    viewport, então `innerHeight - visualViewport.height` fica ~0 e não serve
 *    de sinal. Aqui o gatilho confiável é o foco num campo editável.
 * 2. Comportamento antigo / overlays-content: o teclado SOBREPÕE, e a diferença
 *    de altura da visualViewport denuncia a presença dele.
 *
 * Combinamos os dois com OR e restringimos o sinal de foco a ponteiros grossos
 * (toque), porque focar um input no desktop não abre teclado nenhum e esconder
 * a navegação ali seria um susto sem motivo.
 */

const DIFF_LIMIAR_PX = 140;

function ehCampoEditavel(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function useKeyboardVisible(): boolean {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const pointerCoarse =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;

    let focado = false;

    const recalcular = () => {
      const vv = window.visualViewport;
      const porViewport = vv ? window.innerHeight - vv.height > DIFF_LIMIAR_PX : false;
      setVisivel(focado || porViewport);
    };

    const onFocusIn = (e: FocusEvent) => {
      if (pointerCoarse && ehCampoEditavel(e.target)) {
        focado = true;
        recalcular();
      }
    };
    const onFocusOut = () => {
      focado = false;
      recalcular();
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    window.visualViewport?.addEventListener('resize', recalcular);

    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      window.visualViewport?.removeEventListener('resize', recalcular);
    };
  }, []);

  return visivel;
}
