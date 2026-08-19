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

    const zerarScroll = () => {
      if (typeof window === 'undefined') return;
      if (window.scrollY !== 0 || window.pageYOffset !== 0) {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      }
      if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
      if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
    };

    const recalcular = () => {
      const vv = window.visualViewport;
      const porViewport = vv ? window.innerHeight - vv.height > DIFF_LIMIAR_PX : false;
      const aberto = focado || porViewport;
      setVisivel(aberto);
      if (!aberto) {
        zerarScroll();
      }
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
      zerarScroll();

      requestAnimationFrame(() => {
        zerarScroll();
        requestAnimationFrame(() => {
          zerarScroll();
        });
      });

      // Prazos para acompanhar as etapas da animação de recolhimento do teclado no iOS
      [100, 250, 400].forEach((ms) => {
        setTimeout(zerarScroll, ms);
      });
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    window.visualViewport?.addEventListener('resize', recalcular);
    window.visualViewport?.addEventListener('scroll', recalcular);

    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      window.visualViewport?.removeEventListener('resize', recalcular);
      window.visualViewport?.removeEventListener('scroll', recalcular);
    };
  }, []);

  return visivel;
}
