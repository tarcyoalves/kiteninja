'use client';

import { useEffect } from 'react';

/**
 * Amarra a altura do app-shell à área REALMENTE visível da tela.
 *
 * Por que não basta CSS: o shell é `position: fixed; height: 100dvh`. No iOS
 * Safari o `dvh` NÃO encolhe quando o teclado virtual abre, e
 * `interactive-widget=resizes-content` é ignorado. Resultado: o shell mantém a
 * altura cheia atrás do teclado, o iOS rola a viewport de layout para revelar o
 * campo focado e a tela inteira se desloca — o campo de texto sobe pro topo e
 * sobra um vão embaixo. Nenhum ajuste de padding conserta isso, porque a origem
 * é o shell não saber que a área visível encolheu.
 *
 * A VisualViewport API sabe: `height` é a área visível (já sem o teclado) e
 * `offsetTop` é o quanto o layout rolou. Publicamos os dois em variáveis CSS e
 * o shell passa a ocupar exatamente a janela visível, colada nela. O flexbox
 * então posiciona header/lista/composer sem hack algum.
 */
export function useVisualViewportShell(): void {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const root = document.documentElement;

    if (!vv) {
      // Sem VisualViewport (navegadores muito antigos): mantém o fallback dvh
      // definido no CSS. Nada a fazer.
      return;
    }

    let raf = 0;
    const escalonados: number[] = [];

    const medir = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        root.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
        // offsetTop > 0 quando o iOS rola o layout para cima ao focar o input.
        // Reposicionar o shell por ele cancela o deslocamento da página.
        root.style.setProperty('--app-offset-top', `${Math.round(vv.offsetTop)}px`);
      });
    };

    // Ao FECHAR o teclado, o iOS anima o deslize e às vezes para de emitir
    // eventos de viewport no meio do caminho: --app-height congela num valor
    // menor que a tela e sobra um vão embaixo. Remedir em rajada, depois que a
    // animação assenta, corrige sem depender de um evento final (que o iOS nem
    // sempre manda). Barato: só relê vv.height e escreve a variável.
    const aplicar = () => {
      medir();
      escalonados.forEach(clearTimeout);
      escalonados.length = 0;
      for (const ms of [60, 160, 320, 520]) {
        escalonados.push(window.setTimeout(medir, ms));
      }
    };

    // Perder o foco de um campo editável é o gatilho mais confiável de "teclado
    // fechando" no iOS — dispara a rajada de remedição mesmo que o viewport
    // ainda não tenha mexido.
    const onFocusOut = () => aplicar();

    aplicar();
    vv.addEventListener('resize', aplicar);
    vv.addEventListener('scroll', aplicar);
    window.addEventListener('orientationchange', aplicar);
    document.addEventListener('focusout', onFocusOut);

    return () => {
      cancelAnimationFrame(raf);
      escalonados.forEach(clearTimeout);
      vv.removeEventListener('resize', aplicar);
      vv.removeEventListener('scroll', aplicar);
      window.removeEventListener('orientationchange', aplicar);
      document.removeEventListener('focusout', onFocusOut);
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--app-offset-top');
    };
  }, []);
}
