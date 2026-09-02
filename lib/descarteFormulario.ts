/**
 * "Fechar isto joga fora trabalho meu?"
 *
 * POR QUE ISTO EXISTE
 *
 * O logbook tem 27 campos e o formulário de post tem foto e texto, e nenhum
 * dos dois guarda rascunho — fechar apaga tudo. A boa notícia é que o clique
 * no fundo escuro NÃO fecha esses modais (foi conferido): só o X fecha, e ele
 * é um alvo pequeno no canto, apertado de propósito.
 *
 * Ainda assim, um X sem pergunta apaga em silêncio o que a pessoa acabou de
 * escrever. Pedir confirmação é a correção certa aqui — mais barata e mais
 * segura que persistir rascunho, que criaria um estado novo para conflitar
 * com o preenchimento vindo do GPS.
 *
 * A REGRA: só pergunta se houver trabalho DE VERDADE. Um formulário
 * intocado, ou com apenas os valores que já vieram prontos, fecha na hora —
 * uma confirmação que aparece sempre é uma confirmação que ninguém lê.
 */

/**
 * Campos que só existem porque um humano os digitou ou escolheu.
 *
 * Ficam de fora, de propósito, os que nascem preenchidos: spot padrão,
 * disciplina, nota, tamanho de kite sugerido, e tudo que o preenchimento
 * automático do GPS traz. Perguntar por causa deles seria perguntar sempre.
 */
export function temTrabalhoNaoSalvo(campos: {
  /** Texto livre: notas do velejo, conteúdo do post. */
  textos?: (string | null | undefined)[];
  /** Foto anexada — o item mais caro de refazer: exige achar o arquivo de novo. */
  temFoto?: boolean;
}): boolean {
  if (campos.temFoto) return true;
  return (campos.textos ?? []).some((t) => typeof t === 'string' && t.trim().length > 0);
}

export const MSG_DESCARTAR_FORMULARIO =
  'Você tem coisas preenchidas aqui que ainda não foram salvas. Fechar agora descarta tudo. Quer mesmo sair?';
