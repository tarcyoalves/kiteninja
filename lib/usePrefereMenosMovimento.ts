'use client';

import { useSyncExternalStore } from 'react';

/**
 * `prefers-reduced-motion: reduce` — a preferência de sistema de quem sente
 * náusea, tontura ou enxaqueca com animação.
 *
 * POR QUE `useSyncExternalStore` E NÃO UM `useEffect`
 *
 * O padrão antigo era `useState(false)` + um efeito que lia o `matchMedia` e
 * chamava `setState`. Isso tem dois problemas: o React 19 acusa o setState
 * síncrono dentro do efeito (`react-hooks/set-state-in-effect`), e, mais
 * concreto, o primeiro quadro SEMPRE saía com `false` — quem pediu menos
 * movimento via a animação começar e ser cortada, que é pior do que não ter
 * animação nenhuma.
 *
 * `useSyncExternalStore` é a API que o React dá exatamente para isto: um
 * valor que vive fora do React, tem snapshot diferente no servidor e no
 * cliente, e muda por evento.
 *
 * No servidor a resposta é `false` — não há sistema operacional para
 * perguntar, e é o mesmo valor que a hidratação usaria; devolver `true` ali
 * daria erro de hidratação em todo mundo que NÃO pediu menos movimento, que
 * é a maioria.
 */
const CONSULTA = '(prefers-reduced-motion: reduce)';

function assinar(aoMudar: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const media = window.matchMedia(CONSULTA);
  media.addEventListener('change', aoMudar);
  return () => media.removeEventListener('change', aoMudar);
}

function lerNoCliente(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(CONSULTA).matches;
}

function lerNoServidor(): boolean {
  return false;
}

export function usePrefereMenosMovimento(): boolean {
  return useSyncExternalStore(assinar, lerNoCliente, lerNoServidor);
}
