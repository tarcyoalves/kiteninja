/**
 * Altura do teclado virtual a partir do visualViewport.
 *
 * Vive fora do componente porque errar esta conta deixa um vão embaixo do chat
 * ou o menu sobre o campo de texto — e nenhum dos dois aparece em teste de
 * componente sem um teclado real.
 */

/**
 * Abaixo disso não é teclado: é a barra de endereço do Safari recolhendo, um
 * banner do navegador ou o arredondamento do próprio viewport. Reagir a esses
 * ruídos faria o campo de texto pular durante a rolagem.
 */
export const LIMIAR_TECLADO_PX = 130;

/**
 * O iOS fecha o teclado deslizando, e às vezes para de emitir eventos de
 * viewport no meio da animação. Sem uma remedição depois que tudo assentou, a
 * folga congela no valor intermediário e sobra um vão embaixo da conversa.
 */
export const REMEDIR_APOS_MS = 350;

export interface MedidaViewport {
  /** `window.innerHeight` */
  innerHeight: number;
  /** `document.documentElement.clientHeight` */
  clientHeight: number;
  /** `window.visualViewport.height` */
  viewportHeight: number;
}

/**
 * Quanto do viewport o teclado está ocupando, em px. Zero significa fechado.
 *
 * Usa o maior entre `innerHeight` e `clientHeight` como referência porque
 * algumas versões do iOS encolhem `innerHeight` junto com o teclado: tomar só
 * ele daria diferença ~0 justamente quando o teclado está aberto.
 */
export function alturaDoTeclado(m: MedidaViewport): number {
  const alturaTotal = Math.max(m.innerHeight, m.clientHeight);

  // Viewport ainda não mediu (aba oculta, pré-layout). Sem referência confiável
  // o certo é dizer "fechado" em vez de inventar uma folga.
  if (!Number.isFinite(alturaTotal) || alturaTotal <= 0) return 0;
  if (!Number.isFinite(m.viewportHeight) || m.viewportHeight <= 0) return 0;

  const diferenca = alturaTotal - m.viewportHeight;
  if (!(diferenca > LIMIAR_TECLADO_PX)) return 0;

  // Nenhum teclado ocupa mais de 3/4 da tela — o do iOS em retrato fica perto
  // de 40%. Passar disso é leitura suja (viewport a meio caminho de um layout,
  // ou medida vinda de aba oculta), e aceitar viraria um vão gigante no chat.
  if (diferenca > alturaTotal * 0.75) return 0;

  return Math.round(diferenca);
}

/** Lê as medidas do navegador. Devolve null fora do browser. */
export function medirViewport(): MedidaViewport | null {
  if (typeof window === 'undefined' || !window.visualViewport) return null;
  return {
    innerHeight: window.innerHeight,
    clientHeight: document.documentElement.clientHeight,
    viewportHeight: window.visualViewport.height,
  };
}
