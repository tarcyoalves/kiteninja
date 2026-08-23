/**
 * Regras puras da folha de busca de velejadores (components/BuscarVelejadores.tsx,
 * seção 4.3 do plano). Extraídas do componente pelo mesmo motivo de
 * lib/pullToRefresh.ts: a decisão "isto dispara uma ida ao servidor?" precisa
 * ser testável sem `fetch`, sem debounce de verdade e sem DOM.
 */

/** Mesmo limiar de app/api/riders/search/route.ts (MIN_CHARS) — abaixo disso
 * a rota já devolve `{ riders: [] }`, então nem vale gastar a viagem de rede. */
export const MIN_CHARS_BUSCA = 2;

/** Debounce da busca: não dispara uma requisição por tecla digitada. */
export const DEBOUNCE_BUSCA_MS = 300;

/**
 * Decide se o texto digitado já justifica consultar a API. `trim()` porque
 * espaços em branco no início/fim não contam como caractere de busca — " a "
 * tem 1 caractere de conteúdo, não 3.
 */
export function deveBuscarVelejadores(q: string): boolean {
  return q.trim().length >= MIN_CHARS_BUSCA;
}
