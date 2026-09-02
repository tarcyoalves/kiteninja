/**
 * Unidade federativa de um evento — o eixo por onde a agenda vai escalar.
 *
 * POR QUE ISTO EXISTE
 *
 * Hoje a aba Eventos lista tudo, de todo mundo, sem filtro. Com cinco
 * usuários no Rio Grande do Norte isso é a decisão certa. Com kitesurfistas
 * de Cumbuco, Jericoacoara, Búzios e Barra Grande no mesmo app, uma lista
 * única é uma lista que ninguém lê: o velejador de Fortaleza rola por
 * downwinds do Rio para achar o da praia dele.
 *
 * A UF vem de `spots.state`, que já é sigla de duas letras em todos os spots
 * catalogados (`data/mockSpots.ts`) — então o evento herda a UF do spot de
 * saída na criação, sem ninguém digitar nada. Guardar em `events.uf` em vez
 * de derivar por JOIN a cada consulta é o que permite indexar o filtro; um
 * evento pode ter spot removido (`ON DELETE SET NULL`) e ainda assim precisa
 * continuar aparecendo no estado certo.
 */

/** As 26 unidades federativas mais o Distrito Federal. */
export const UFS_BRASIL: readonly string[] = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

/**
 * Aceita o que vier do banco ou da query string e devolve a sigla, ou `null`.
 *
 * `null` para desconhecido é o ponto importante: um evento internacional, um
 * spot cadastrado sem estado, ou `?uf=XX` digitado à mão não podem virar uma
 * UF plausível por aproximação — ficariam listados num estado onde ninguém
 * vai encontrá-los, o que é pior que ficar sem filtro.
 */
export function normalizarUf(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const sigla = valor.trim().toUpperCase();
  return UFS_BRASIL.includes(sigla) ? sigla : null;
}

/**
 * O evento entra na lista filtrada por `filtro`?
 *
 * Sem filtro, tudo entra. Com filtro, evento de UF desconhecida (`null`) fica
 * DE FORA — se o velejador pediu "Ceará", mostrar um evento sem estado
 * definido é responder outra pergunta.
 */
export function eventoCasaComUf(ufDoEvento: string | null, filtro: string | null): boolean {
  if (filtro === null) return true;
  return ufDoEvento === filtro;
}

/**
 * As UFs presentes numa lista de eventos, em ordem alfabética.
 *
 * A barra de filtros é montada a partir do que EXISTE, não das 27 siglas:
 * oferecer "Acre" numa agenda sem nenhum evento no Acre é dar ao usuário um
 * botão que só sabe devolver lista vazia.
 */
export function ufsPresentes(eventos: Array<{ uf: string | null }>): string[] {
  const vistas = new Set<string>();
  for (const e of eventos) {
    if (e.uf !== null) vistas.add(e.uf);
  }
  return [...vistas].sort();
}
