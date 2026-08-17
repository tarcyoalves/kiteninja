/**
 * Lógica de filtragem e navegação da grade de previsão.
 *
 * O pedido do usuário é mostrar só horários de 3 em 3 horas (00h, 03h, 06h...)
 * e permitir navegação entre dias por scroll. Este módulo abstrai a lógica pura
 * para ser testável independentemente da UI.
 */
import type { WindForecastHour } from '@/types';

/**
 * Extrai o valor numérico da hora a partir do campo "HHh" do dado.
 * Ex: "15h" -> 15, "03h" -> 3, "21h" -> 21
 */
function extractHourNumeric(hourStr: string): number {
  const match = hourStr.match(/^(\d+)h$/);
  if (!match) return -1;
  return parseInt(match[1], 10);
}

/**
 * Filtra as horas para mostrar apenas as de 3 em 3 horas.
 *
 * O primeiro dia pode começar em qualquer hora (depende de quando o app é aberto),
 * então filtramos por valor numérico múltiplo de 3, não por índice fixo.
 * Se o dia não tiver dados em múltiplo de 3 (ex: só 14h-23h), retorna as horas
 * que existem — não faz sentido inventar dados.
 */
export function filterHoursBy3(hours: WindForecastHour[]): WindForecastHour[] {
  if (!hours || hours.length === 0) return [];

  // Se já tem 8 ou menos horas, pode ser que já venha filtrado da API
  // ou seja um dia parcial (último dia). Mantemos como está.
  if (hours.length <= 8) return hours;

  // Primeiro encontra quais valores de hora múltiplos de 3 existem no array.
  // Isso lida com dias que começam em hora ímpar (ex: 14h).
  const availableHours = new Set(hours.map((h) => extractHourNumeric(h.hour)));
  const multiplesOf3 = [0, 3, 6, 9, 12, 15, 18, 21].filter((h) => availableHours.has(h));

  if (multiplesOf3.length === 0) {
    // Edge case: dia sem nenhuma hora múltiplo de 3 (improvável na prática,
    // mas a API pode retornar dados esparsos). Retorna tudo.
    return hours;
  }

  // Ordena e pega os disponíveis
  multiplesOf3.sort((a, b) => a - b);

  // Mapeia de volta para os objetos originais
  return multiplesOf3.map((h) => {
    const found = hours.find((row) => extractHourNumeric(row.hour) === h);
    return found!;
  });
}

/**
 * Resolve qual índice da grade de 3h contém a hora atual.
 *
 * Exemplo: se nowHour = 16 e a grade tem [12h, 15h, 18h, 21h],
 * retorna o índice de 15h (o bloco de 3h que contém 16h).
 *
 * A lógica: floor(nowHour / 3) * 3 dá o início do bloco de 3h.
 * Se nowHour = 16: floor(16/3)*3 = 5*3 = 15. Procuramos 15h.
 * Se nowHour = 15: floor(15/3)*3 = 5*3 = 15. Procuramos 15h.
 * Se nowHour = 14: floor(14/3)*3 = 4*3 = 12. Procuramos 12h.
 */
export function resolveCurrentHourBlock(
  hours: WindForecastHour[],
  nowHour: number
): number {
  if (!hours || hours.length === 0 || nowHour < 0) return -1;

  const targetBlockStart = Math.floor(nowHour / 3) * 3;

  // Procura o bloco que começa no múltiplo de 3 mais próximo
  const idx = hours.findIndex((h) => {
    const hNum = extractHourNumeric(h.hour);
    return hNum === targetBlockStart;
  });

  return idx;
}

/**
 * Verifica se o array de horas tem buracos (horas faltando na sequência).
 * Útil para validar integridade dos dados.
 */
export function hasGapsInHours(hours: WindForecastHour[]): boolean {
  if (!hours || hours.length < 2) return false;

  const hourValues = hours.map((h) => extractHourNumeric(h.hour)).filter((h) => h >= 0);
  hourValues.sort((a, b) => a - b);

  for (let i = 1; i < hourValues.length; i++) {
    if (hourValues[i] - hourValues[i - 1] > 1) return true;
  }
  return false;
}

/**
 * Retorna o array original se já tem no máximo 8 horas,
 * caso contrário aplica o filtro de 3h.
 * Útil para decidir quando filtrar vs manter o original.
 */
export function getPreparedHours(hours: WindForecastHour[] | undefined | null): WindForecastHour[] {
  if (!hours || hours.length <= 8) return hours ?? [];
  return filterHoursBy3(hours);
}
