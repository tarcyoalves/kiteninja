/**
 * Regra de exibição do toast de mensagem nova (components/InAppPushToast.tsx).
 *
 * Extraída como função pura pelo mesmo motivo de `deveReadquirir` em
 * lib/useWakeLock.ts: é aqui que mora a decisão que já quebrou uma vez, e
 * testá-la não deveria exigir montar React nem jsdom.
 *
 * O bug que originou este arquivo (relatado pelo dono: "fica direto
 * aparecendo o popup, mesmo eu já tendo visto a msg"): o toast reaparecia a
 * cada troca de aba, indefinidamente, porque nada registrava que aquela
 * mensagem específica JÁ tinha sido exibida — o auto-hide escondia o toast
 * mas deixava a mensagem no contexto, e qualquer reexecução do efeito a
 * mostrava de novo.
 *
 * A regra correta em uma frase: **cada mensagem aparece uma vez só**. O que
 * identifica "a mesma mensagem" é o `id`, nunca o conteúdo — duas mensagens
 * iguais ("bora?") mandadas em sequência são dois avisos legítimos, e
 * comparar texto engoliria o segundo.
 */
export function deveExibirToastMensagem(
  mensagem: { id: string } | null,
  jaExibidaId: string | null
): boolean {
  if (!mensagem) return false;
  return mensagem.id !== jaExibidaId;
}

/**
 * Um aviso de mensagem pronto para exibição, vindo do chat geral OU de uma
 * conversa direta.
 */
export interface AvisoMensagem {
  /** Identidade estável — é o que alimenta `deveExibirToastMensagem`. */
  id: string;
  nome: string;
  texto: string;
  avatar?: string;
  /** ISO da mensagem, não do momento em que chegou ao cliente. */
  quando: string;
  ehDm: boolean;
}

/**
 * Escolhe qual aviso mostrar quando chat geral e DM têm mensagem pendente.
 *
 * Só um toast aparece por vez, na mesma posição da tela — sem esta escolha os
 * dois se sobreporiam.
 *
 * Compara `quando` (horário da MENSAGEM) e não a ordem de chegada ao cliente:
 * os dois watchers fazem poll independente, então a DM mais nova pode chegar
 * ao navegador depois de uma mensagem de chat mais velha. Ordenar por chegada
 * mostraria a errada.
 *
 * Empate fica com a DM de propósito: é a mensagem endereçada à pessoa, não a
 * uma sala com todo mundo.
 */
export function escolherAvisoMaisRecente(
  geral: AvisoMensagem | null,
  dm: AvisoMensagem | null
): AvisoMensagem | null {
  if (!geral) return dm;
  if (!dm) return geral;
  return Date.parse(dm.quando) >= Date.parse(geral.quando) ? dm : geral;
}
