/**
 * Converte a data que o formulário de evento manda numa data real.
 *
 * POR QUE ISTO EXISTE
 *
 * `events.event_date` é uma coluna TEXT que guarda a data por extenso em
 * português ("31 de agosto de 2026"), e a listagem ordenava por ela. Ordenar
 * texto é ordenar alfabeticamente:
 *
 *     01 de setembro de 2026
 *     02 de janeiro de 2027
 *     15 de dezembro de 2026
 *     31 de agosto de 2026
 *
 * Essa é a ordem que o app mostrava. A agenda aparecia embaralhada, e a
 * ordem não tinha relação nenhuma com quando as coisas acontecem.
 *
 * A correção é uma coluna `event_at TIMESTAMPTZ` para ordenar. Esta função
 * decide o que vai nela — e é onde o erro moraria, porque a entrada vem de
 * dois caminhos diferentes: o formulário de downwind manda um ISO completo, e
 * o de evento oficial manda o que a pessoa digitou.
 */

/**
 * `null` quando não dá para saber a data com segurança.
 *
 * Devolver `null` é uma resposta melhor que um chute: a listagem usa
 * `NULLS LAST` e cai em `created_at`, que é uma ordem defensável. Um evento
 * colocado na data errada é pior que um evento no fim da lista — alguém
 * apareceria na praia no dia errado.
 */
export function dataDoEvento(bruto: string | null | undefined): Date | null {
  if (!bruto) return null;
  const texto = bruto.trim();
  if (!texto) return null;

  /*
   * Só formatos NÃO ambíguos, e nesta ordem:
   *
   *  - ISO completo (o que o formulário de downwind manda);
   *  - `YYYY-MM-DD` do <input type="date">;
   *  - `DD/MM/AAAA`, o formato brasileiro digitado à mão.
   *
   * Nada de `new Date(texto)` como último recurso: o parser do JavaScript
   * aceita quase tudo e erra em silêncio. `new Date('01/02/2026')` devolve
   * 1º de FEVEREIRO nos motores que assumem o formato americano — a data
   * errada, com cara de certa.
   */
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(texto);
  if (iso) {
    const d = new Date(texto.includes('T') ? texto : `${texto}T12:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto);
  if (br) {
    const dia = Number(br[1]);
    const mes = Number(br[2]);
    const ano = Number(br[3]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    // Meio-dia UTC: uma data sem hora não deve mudar de dia por fuso.
    const d = new Date(Date.UTC(ano, mes - 1, dia, 12));
    // Rejeita 31/02: o Date rola para março e mudaria o mês em silêncio.
    if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
    return d;
  }

  return null;
}
