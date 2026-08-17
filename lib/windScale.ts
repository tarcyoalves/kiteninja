/**
 * Fonte única da escala de vento do KiteNinja.
 *
 * Todas as funções de cor do app derivam desta escala: getWindColorClass,
 * corPorForca, e qualquer novo componente visual de intensidade.
 *
 * A escala segue a lógica do kitesurf:
 * - 0-8: sem vento, não dá para velejar (azul/sky)
 * - 8-12: fraco/marginal (ciano/cyan) - ainda não é ideal
 * - 12-22: FAIXA BOA (verde/esmeralda) - onde o verde aparece
 * - 22-30: forte, para experientes (amarelo/âmbar)
 * - 30+: perigoso (vermelho/rosa)
 */

export type WindBandName =
  | 'semVento'
  | 'fraco'
  | 'bom'
  | 'forte'
  | 'perigoso';

export interface WindBand {
  /** Nome técnico da faixa, usado para testes e derivação */
  name: WindBandName;
  /** Nome amigável em português para exibições */
  label: string;
  /** Cor base para UI via classes Tailwind */
  tailwindColor: string;
  /** Cor rgba para canvas (partículas do mapa) */
  rgbaColor: string;
  /** Limite inferior desta faixa (nós) */
  minKnots: number;
  /** Limite superior desta faixa (nós), Infinity para a última */
  maxKnots: number;
}

/**
 * Array de faixas ordenado por limite inferior.
 * Cada faixa começa em minKnots e vai até maxKnots (exclusive no limite
 * inferior, exceto a última que é infinity).
 */
const WIND_BANDS: WindBand[] = [
  {
    name: 'semVento',
    label: 'Sem vento',
    tailwindColor: 'sky',
    rgbaColor: 'rgba(14,165,233,0.55)', // sky-500 com opacidade
    minKnots: 0,
    maxKnots: 8,
  },
  {
    name: 'fraco',
    label: 'Fraco',
    tailwindColor: 'cyan',
    rgbaColor: 'rgba(6,182,212,0.55)', // cyan-500 com opacidade
    minKnots: 8,
    maxKnots: 12,
  },
  {
    name: 'bom',
    label: 'Bom',
    tailwindColor: 'emerald',
    rgbaColor: 'rgba(16,185,129,0.62)', // emerald-500 com opacidade
    minKnots: 12,
    maxKnots: 22,
  },
  {
    name: 'forte',
    label: 'Forte',
    tailwindColor: 'amber',
    rgbaColor: 'rgba(245,158,11,0.66)', // amber-500 com opacidade
    minKnots: 22,
    maxKnots: 30,
  },
  {
    name: 'perigoso',
    label: 'Perigoso',
    tailwindColor: 'rose',
    rgbaColor: 'rgba(244,63,94,0.7)', // rose-500 com opacidade
    minKnots: 30,
    maxKnots: Infinity,
  },
];

/**
 * Obtém a faixa de vento para um valor em nós.
 * Retorna a faixa correspondente independente do valor (0, negativo, absurdamente alto).
 */
export function getWindBand(knots: number): WindBand {
  // NaN ou negativo = sem vento
  if (!Number.isFinite(knots) || knots < 0) {
    // Infinity é um valor finito segundo Number.isFinite, mas positivo infinito
    // deveria ser tratado como perigoso (vento extremo)
    if (!Number.isFinite(knots) && knots > 0) {
      return WIND_BANDS[WIND_BANDS.length - 1]; // perigoso
    }
    return WIND_BANDS[0]; // semVento
  }

  // Encontra a faixa onde o valor se encaixa
  for (const band of WIND_BANDS) {
    if (knots < band.maxKnots) {
      return band;
    }
  }

  // Fallback para valores acima do teto (não deveria acontecer com Infinity na última faixa)
  return WIND_BANDS[WIND_BANDS.length - 1];
}

/**
 * Calcula a intensidade normalizada 0..1 para barra visual.
 *
 * O teto fixo de 40 nós garante que dias diferentes sejam comparáveis:
 * se normalizássemos pelo máximo do dia, um dia fraco (max 15 nós) pareceria
 * forte (100% da barra) enquanto um dia forte (max 35 nós) mostraria só 43%.
 * Com teto fixo, 15 nós = 37.5% e 35 nós = 87.5%, preservando a relação real.
 *
 * Valores acima de 40 saturam em 100% - a barra fica cheia mas a cor indica perigo.
 */
export function getWindIntensity(knots: number, ceilingKnots = 40): number {
  if (!Number.isFinite(knots) || knots <= 0) return 0;
  return Math.min(1, knots / ceilingKnots);
}

/**
 * Retorna a cor rgba para canvas/partículas derivada da escala.
 */
export function getWindRgbaColor(knots: number): string {
  return getWindBand(knots).rgbaColor;
}

/**
 * Retorna a cor base Tailwind derivada da escala.
 * Útil para derivar as variações (bg, text, badge, etc).
 */
export function getWindTailwindColor(knots: number): string {
  return getWindBand(knots).tailwindColor;
}

/**
 * Lista de todas as faixas (exportada para testes e debugging).
 */
export function getAllWindBands(): WindBand[] {
  return [...WIND_BANDS];
}
