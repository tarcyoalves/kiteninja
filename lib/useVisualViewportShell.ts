'use client';

import { useEffect } from 'react';

/**
 * Amarra a altura do app-shell à área visível SÓ enquanto o teclado está aberto.
 *
 * Por que não basta CSS: o shell é `position: fixed; height: 100dvh`. No iOS
 * Safari o `dvh` NÃO encolhe quando o teclado virtual abre, e
 * `interactive-widget=resizes-content` é ignorado. O shell mantém a altura
 * cheia atrás do teclado, o iOS rola a viewport de layout para revelar o campo
 * focado e a tela inteira se desloca — o campo sobe pro topo e sobra um vão.
 *
 * A correção é encolher o shell para a área visível (VisualViewport API) — mas
 * SÓ com um campo de texto focado. A lição da tentativa anterior: fixar a
 * altura o tempo todo deixava uma leitura ruim do iOS "grudada", virando uma
 * tarja no rodapé que persistia até trocando de página. Aqui o default é o
 * shell cheio (variáveis removidas); só quando há foco de campo editável é que
 * publicamos a altura reduzida. Perdeu o foco → limpa → volta a 100dvh. A
 * recuperação é garantida porque o estado sem teclado não depende de nenhuma
 * medida do iOS.
 */

function ehCampoEditavel(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function useVisualViewportShell(): void {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const root = document.documentElement;
    if (!vv) return; // sem VisualViewport: fica o fallback dvh do CSS

    let raf = 0;

    const limpar = () => {
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--app-offset-top');
    };

    const atualizar = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // Só encolhe o shell se um campo de texto está focado (teclado aberto).
        // Sem foco, remove as variáveis e o shell volta a 100dvh cheio — assim
        // nunca sobra tarja quando o teclado fecha.
        if (!ehCampoEditavel(document.activeElement)) {
          limpar();
          return;
        }
        root.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
        root.style.setProperty('--app-offset-top', `${Math.round(vv.offsetTop)}px`);
      });
    };

    // No iOS, focar um input dentro de um elemento `position: fixed` faz o
    // Safari ROLAR a viewport de layout inteira para cima para revelar o campo.
    // Ao fechar o teclado ele nem sempre desfaz essa rolagem: o shell fixo fica
    // deslocado e sobra a tarja embaixo — que o usuário "conserta" puxando a
    // tela para baixo. Forçar o scroll de volta ao topo desfaz isso por nós.
    const recolocarNoTopo = () => {
      if (window.scrollY !== 0 || window.pageYOffset !== 0) {
        window.scrollTo(0, 0);
      }
    };

    // Ao perder o foco o teclado fecha: limpa imediatamente e reconfere depois
    // que a animação do iOS assenta (ele às vezes para de emitir eventos no
    // meio, mas como o default é "cheio", basta garantir que ficou limpo).
    const escalonados: number[] = [];
    const onFocusOut = () => {
      limpar();
      recolocarNoTopo();
      escalonados.forEach(clearTimeout);
      escalonados.length = 0;
      for (const ms of [120, 320, 520]) {
        escalonados.push(
          window.setTimeout(() => {
            atualizar();
            recolocarNoTopo();
          }, ms)
        );
      }
    };

    vv.addEventListener('resize', atualizar);
    vv.addEventListener('scroll', atualizar);
    window.addEventListener('orientationchange', atualizar);
    document.addEventListener('focusin', atualizar);
    document.addEventListener('focusout', onFocusOut);

    return () => {
      cancelAnimationFrame(raf);
      escalonados.forEach(clearTimeout);
      vv.removeEventListener('resize', atualizar);
      vv.removeEventListener('scroll', atualizar);
      window.removeEventListener('orientationchange', atualizar);
      document.removeEventListener('focusin', atualizar);
      document.removeEventListener('focusout', onFocusOut);
      limpar();
    };
  }, []);
}
