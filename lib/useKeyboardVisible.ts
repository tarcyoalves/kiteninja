'use client';

import { useEffect, useState } from 'react';
import { ATRASO_PARA_FECHAR_MS, ehCampoEditavel } from './tecladoVirtual';

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

export function useKeyboardVisible(): boolean {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const pointerCoarse =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;

    let focado = false;
    /*
     * Timer do fechamento adiado. Ver lib/tecladoVirtual.ts para o porquê: sem
     * ele, tocar num botão vizinho do campo movia o layout inteiro ANTES de o
     * clique acontecer, e o toque se perdia.
     */
    let fecharEm: ReturnType<typeof setTimeout> | null = null;
    const cancelarFechamento = () => {
      if (fecharEm !== null) {
        clearTimeout(fecharEm);
        fecharEm = null;
      }
    };

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
      if (pointerCoarse && ehCampoEditavel(e.target as HTMLElement | null)) {
        // Voltou para um campo: o fechamento agendado não vale mais. É o caso
        // de sair de um input e cair em outro, e o de o foco voltar sozinho.
        cancelarFechamento();
        focado = true;
        recalcular();
      }
    };

    const onFocusOut = () => {
      /*
       * O foco saiu — mas ainda NÃO se conclui que o teclado fechou.
       *
       * Entre o dedo encostar num botão vizinho e o `click` nascer, o foco já
       * saiu do campo. Concluir aqui fazia o menu inferior reaparecer e as
       * folgas crescerem no mesmo quadro, empurrando o botão para longe do
       * dedo — o clique caía no vazio e o usuário tocava de novo. Era o bug
       * do botão de enviar do chat.
       *
       * A correção de scroll continua imediata: ela é sobre a deriva do iOS,
       * não sobre a altura da tela, e adiá-la só deixaria a página torta por
       * mais tempo.
       */
      cancelarFechamento();
      fecharEm = setTimeout(() => {
        fecharEm = null;
        focado = false;
        recalcular();
      }, ATRASO_PARA_FECHAR_MS);

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
      cancelarFechamento();
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      window.visualViewport?.removeEventListener('resize', recalcular);
      window.visualViewport?.removeEventListener('scroll', recalcular);
    };
  }, []);

  return visivel;
}
