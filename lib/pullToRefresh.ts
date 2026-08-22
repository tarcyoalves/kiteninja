/**
 * Regra pura de "puxar para atualizar" do feed (seção 3.6 do plano de rede
 * social: a lista atualiza ao abrir a aba, em pull-to-refresh e ao voltar do
 * background — nunca por um `setInterval` novo, ver seção 3 "Fluidez").
 *
 * Extraída de `views/FeedView.tsx` para o gesto de arrasto (que precisa de
 * `touchstart`/`touchmove`/`touchend`, sem equivalente em Node) ter a decisão
 * "isto conta como puxar?" testável sem DOM nenhum.
 */

/** Distância mínima de arrasto, em px, para soltar o dedo disparar o refresh. */
export const LIMIAR_PULL_PX = 64;

/**
 * Decide se soltar o dedo agora deve disparar a atualização.
 *
 * Só conta como "puxar para atualizar" quando as DUAS condições valem: o
 * scroll já estava no topo quando o gesto começou (senão é rolagem normal da
 * lista, não um pull) E o arrasto para baixo passou do limiar. Arrastar para
 * CIMA (delta negativo) nunca dispara — é só o usuário rolando a lista.
 */
export function devePuxarAtualizar(scrollTopNoInicio: number, deltaYPx: number): boolean {
  return scrollTopNoInicio <= 0 && deltaYPx >= LIMIAR_PULL_PX;
}

/**
 * Progresso visual do puxão, de 0 a 1, para animar um indicador ("solte para
 * atualizar") proporcionalmente ao quanto falta para cruzar o limiar —
 * `Math.min` trava em 1 para o indicador não crescer sem fim se o dedo
 * arrastar bem além do necessário.
 */
export function progressoPull(deltaYPx: number): number {
  if (deltaYPx <= 0) return 0;
  return Math.min(1, deltaYPx / LIMIAR_PULL_PX);
}
