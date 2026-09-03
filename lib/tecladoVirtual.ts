/**
 * Regras do teclado virtual — a parte que dá para testar sem navegador.
 *
 * O BUG QUE ISTO CORRIGE
 *
 * O botão de enviar do chat precisava de DOIS toques. Não era o botão: era o
 * layout saindo de baixo do dedo entre o toque e o clique.
 *
 * Sequência, com o teclado aberto e o campo focado:
 *
 *  1. o dedo encosta no botão de enviar;
 *  2. o campo perde o foco -> `focusout`;
 *  3. o app concluía NA HORA que o teclado fechou;
 *  4. e três coisas se mexiam no mesmo quadro: o BottomNav volta a existir
 *     (ele some com o teclado aberto), a folga do `.app-scroll` cresce, e a
 *     do compositor do chat troca `pb-2` por `pb-above-nav`;
 *  5. o botão sobe uns 100px — e o `click`, que só nasce quando o dedo
 *     levanta, cai no vazio.
 *
 * O segundo toque funcionava porque aí o teclado já estava fechado e nada
 * mais se mexia.
 *
 * O conserto tem duas metades, e as duas importam:
 *
 *  - AQUI: "perdeu o foco" deixa de significar "teclado fechado" no mesmo
 *    instante. Espera-se um momento, e o aviso é cancelado se o foco voltar
 *    para outro campo. Isso conserta TODO botão vizinho de TODO campo do app,
 *    não só o de enviar.
 *  - NO COMPOSITOR do chat: os botões nem tiram o foco do campo
 *    (`onMouseDown` com `preventDefault`), então o teclado sequer fecha — dá
 *    para mandar três mensagens seguidas sem ele piscar.
 */

/**
 * Quanto esperar antes de tratar "perdeu o foco" como "teclado fechou".
 *
 * 250 ms cobre o intervalo entre o toque e o clique num botão vizinho, e é
 * praticamente a duração da própria animação de recolhimento do teclado no
 * iOS — então o menu inferior reaparece JUNTO com o fim da animação em vez de
 * antes dela, o que por acaso ficou melhor do que era.
 *
 * Mais que isso começaria a parecer travamento ao tocar fora para fechar o
 * teclado de propósito.
 */
export const ATRASO_PARA_FECHAR_MS = 250;

/**
 * Elemento onde digitar abre o teclado virtual.
 *
 * Recebe a FORMA mínima em vez de um `HTMLElement` para poder ser testado sem
 * navegador — o Vitest deste projeto roda em `environment: 'node'`, sem DOM, e
 * uma regra que só roda no navegador é uma regra que ninguém testa.
 */
export function ehCampoEditavel(
  el: { tagName?: unknown; isContentEditable?: unknown } | null | undefined
): boolean {
  if (!el || typeof el !== 'object') return false;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  return el.isContentEditable === true;
}
