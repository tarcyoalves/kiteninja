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
