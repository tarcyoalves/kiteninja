/**
 * Detecta as janelas de vento forte do dia.
 *
 * O velejador não lê 8 linhas de tabela na praia: ele quer saber "a que
 * horas vai ventar de verdade". Este módulo responde isso a partir da
 * previsão já preparada, e vive fora do componente para ser testável — a
 * lógica de pico decide o que é destacado na tela e não pode depender de
 * inspeção visual para se provar correta.
 */
import type { WindForecastHour } from '@/types';
import { getWindBand } from './windScale';

/** Onde começa "Forte" na escala do app (nós). Espelha WIND_BANDS. */
export const LIMIAR_FORTE = 22;

export interface JanelaPico {
  /** Índices, na lista recebida, que compõem a janela. */
  indices: number[];
  /** Rótulo pronto: "12h–15h" ou "15h" quando é uma hora só. */
  faixaHoraria: string;
  /** Maior valor de vento sustentado dentro da janela. */
  picoKnots: number;
  /** Hora em que o pico acontece. */
  horaPico: string;
  /** Faixa da escala no pico ("Forte", "Perigoso"). */
  faixa: string;
}

/** Extrai a parte da hora de "14:00" ou "14h" → "14h". */
function rotuloHora(hora: string): string {
  const m = String(hora).match(/^(\d{1,2})/);
  return m ? `${m[1].padStart(2, '0')}h` : String(hora);
}

/**
 * Marca cada hora como pico ou não. Usa o vento sustentado, não a rajada:
 * rajada isolada não define a sessão, e destacar por rajada acenderia quase
 * toda a tabela num dia instável.
 */
export function ehPico(hora: WindForecastHour, limiar = LIMIAR_FORTE): boolean {
  const knots = Number(hora?.knots);
  return Number.isFinite(knots) && knots >= limiar;
}

/**
 * Agrupa horas fortes consecutivas em janelas. Consecutivas na LISTA, não no
 * relógio: a lista já vem no passo escolhido (3h), então duas posições
 * seguidas são contíguas para quem lê a tabela.
 */
export function encontrarJanelasDePico(
  hours: WindForecastHour[] | undefined | null,
  limiar = LIMIAR_FORTE
): JanelaPico[] {
  if (!Array.isArray(hours) || hours.length === 0) return [];

  const janelas: JanelaPico[] = [];
  let atual: number[] = [];

  const fechar = () => {
    if (atual.length === 0) return;

    let picoKnots = -Infinity;
    let horaPico = '';
    for (const i of atual) {
      const k = Number(hours[i].knots);
      if (k > picoKnots) {
        picoKnots = k;
        horaPico = String(hours[i].hour);
      }
    }

    const primeira = rotuloHora(String(hours[atual[0]].hour));
    const ultima = rotuloHora(String(hours[atual[atual.length - 1]].hour));

    janelas.push({
      indices: [...atual],
      faixaHoraria: primeira === ultima ? primeira : `${primeira}–${ultima}`,
      picoKnots,
      horaPico: rotuloHora(horaPico),
      faixa: getWindBand(picoKnots).label,
    });
    atual = [];
  };

  hours.forEach((h, i) => {
    if (ehPico(h, limiar)) atual.push(i);
    else fechar();
  });
  fechar();

  return janelas;
}

/**
 * A melhor janela do dia: a de maior pico. Em empate, a mais longa; se ainda
 * empatar, a mais cedo — dá mais margem para o velejador se organizar.
 */
export function melhorJanela(
  hours: WindForecastHour[] | undefined | null,
  limiar = LIMIAR_FORTE
): JanelaPico | null {
  const janelas = encontrarJanelasDePico(hours, limiar);
  if (janelas.length === 0) return null;

  return janelas.reduce((melhor, j) => {
    if (j.picoKnots !== melhor.picoKnots) return j.picoKnots > melhor.picoKnots ? j : melhor;
    if (j.indices.length !== melhor.indices.length) {
      return j.indices.length > melhor.indices.length ? j : melhor;
    }
    return j.indices[0] < melhor.indices[0] ? j : melhor;
  });
}

/** Índice da hora de maior vento do dia, para destacar a linha do pico. */
export function indiceDoPicoMaximo(hours: WindForecastHour[] | undefined | null): number {
  if (!Array.isArray(hours) || hours.length === 0) return -1;

  let idx = -1;
  let max = -Infinity;
  hours.forEach((h, i) => {
    const k = Number(h?.knots);
    if (Number.isFinite(k) && k > max) {
      max = k;
      idx = i;
    }
  });
  return idx;
}

/** Resumo curto para o topo do modal. Null quando não há vento forte. */
export function resumoDePico(
  hours: WindForecastHour[] | undefined | null,
  limiar = LIMIAR_FORTE
): string | null {
  const j = melhorJanela(hours, limiar);
  if (!j) return null;
  return `${j.faixaHoraria} · pico ${Math.round(j.picoKnots)} nós`;
}
