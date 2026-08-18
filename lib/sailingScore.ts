import type { SailingScore, WindSafety, TideStatus } from '@/types';

export interface SailingScoreParams {
  knots: number;
  gustKnots: number;
  windSafety: WindSafety;
  tideStatus?: TideStatus | null;
  waterCondition?: string;
  waveHeightM?: number | null;
}

/**
 * Motor de Avaliação Náutica (Kite Score de 0 a 100).
 *
 * Avalia cientificamente o potencial e a segurança da sessão de velejo combinando:
 * 1. Intensidade e faixa de vento (0 a 35 pts)
 * 2. Constância e fator de rajada / vento liso vs rajado (0 a 20 pts)
 * 3. Ângulo em relação à costa e segurança do velejador (0 a 25 pts)
 * 4. Maré e estado do mar (0 a 20 pts)
 */
export function calcularSailingScore(params: SailingScoreParams): SailingScore {
  const { knots, gustKnots, windSafety, waveHeightM } = params;

  // 1. Pontuação de Intensidade de Vento (máx 35 pts)
  let windSpeedScore = 0;
  if (knots < 7) {
    windSpeedScore = 3;
  } else if (knots < 11) {
    windSpeedScore = 14; // Fraco, apenas foil/pipe grande
  } else if (knots < 15) {
    windSpeedScore = 26; // Bom para pipa 12m-14m
  } else if (knots <= 24) {
    windSpeedScore = 35; // Faixa de ouro do Kitesurf (15-24 nós)
  } else if (knots <= 30) {
    windSpeedScore = 31; // Vento forte, ideal para Big Air
  } else if (knots <= 36) {
    windSpeedScore = 20; // Vento muito forte, exige nível avançado
  } else {
    windSpeedScore = 8; // Tempestuoso / perigoso
  }

  // 2. Qualidade do Vento / Fator de Rajada (máx 20 pts)
  let gustQualityScore = 18;
  const baseKnots = Math.max(1, knots);
  const effectiveGust = Math.max(gustKnots, knots);
  const gustRatio = effectiveGust / baseKnots;

  if (knots < 8) {
    gustQualityScore = 5;
  } else if (gustRatio <= 1.2) {
    gustQualityScore = 20; // Vento liso perfeito
  } else if (gustRatio <= 1.35) {
    gustQualityScore = 17; // Vento constante normal
  } else if (gustRatio <= 1.5) {
    gustQualityScore = 12; // Rajadas moderadas
  } else if (gustRatio <= 1.7) {
    gustQualityScore = 6; // Vento rajado/socado
  } else {
    gustQualityScore = 2; // Rajadas bruscas perigosas
  }

  // 3. Segurança da Direção do Vento em Relação à Costa (máx 25 pts)
  let directionSafetyScore = 25;
  if (windSafety === 'Side-Onshore') {
    directionSafetyScore = 25; // Segurança máxima + retorno fácil à praia
  } else if (windSafety === 'Side-Shore') {
    directionSafetyScore = 22; // Excelente para downwinds e navegação paralela
  } else if (windSafety === 'Onshore') {
    directionSafetyScore = 15; // Marola na praia, dificulta entrada no mar
  } else if (windSafety === 'Side-Offshore') {
    directionSafetyScore = 6; // Perigoso, exige barco de apoio
  } else if (windSafety === 'Offshore') {
    directionSafetyScore = 0; // CRÍTICO: vento terral empurra para alto-mar
  }

  // 4. Maré e Estado do Mar (máx 20 pts)
  let tideWaterScore = 18;
  if (typeof waveHeightM === 'number' && Number.isFinite(waveHeightM)) {
    if (waveHeightM <= 0.8) {
      tideWaterScore = 20; // Água lisa ou marola leve
    } else if (waveHeightM <= 1.5) {
      tideWaterScore = 17; // Ondas moderadas, bom para strapless wave
    } else if (waveHeightM <= 2.5) {
      tideWaterScore = 12; // Ondas grandes, exige técnica
    } else {
      tideWaterScore = 6; // Ressaca pesada
    }
  }

  let totalScore = Math.min(
    100,
    Math.max(0, windSpeedScore + gustQualityScore + directionSafetyScore + tideWaterScore)
  );

  // Sem vento mínimo (< 8 nós), não há sustentação ou planeio possível: limita score total
  if (knots < 8) {
    totalScore = Math.min(30, totalScore);
  } else if (knots < 11) {
    totalScore = Math.min(48, totalScore);
  }

  // Penalidade de Segurança Inviolável: Vento Offshore nunca pode ter score alto
  if (windSafety === 'Offshore') {
    totalScore = Math.min(25, totalScore);
  } else if (windSafety === 'Side-Offshore') {
    totalScore = Math.min(55, totalScore);
  }

  // Classificação e badge
  let classification: SailingScore['classification'] = 'Bom';
  let badgeColor = '#eab308';
  let summary = '';

  if (totalScore >= 85) {
    classification = 'Épico';
    badgeColor = '#10b981';
    summary = `Condição épica! ${knots} nós de vento liso ${windSafety}, perfeito para velejar.`;
  } else if (totalScore >= 70) {
    classification = 'Muito Bom';
    badgeColor = '#06b6d4';
    summary = `Ótimo dia para velejo (${knots} nós ${windSafety}).`;
  } else if (totalScore >= 55) {
    classification = 'Bom';
    badgeColor = '#eab308';
    summary = `Condições velejáveis (${knots} nós). Fique atento à maré e rajadas.`;
  } else if (totalScore >= 40) {
    classification = 'Regular';
    badgeColor = '#f97316';
    summary = `Velejo exigente (${knots} nós, ${windSafety}). Recomendado para intermediários/avançados.`;
  } else {
    classification = 'Ruim';
    badgeColor = '#ef4444';
    summary =
      windSafety === 'Offshore'
        ? 'PERIGO: Vento Terral (Offshore). Não entre na água sem resgate dedicado.'
        : `Condições desfavoráveis (${knots} nós). Pouco vento ou vento muito instável.`;
  }

  return {
    totalScore,
    classification,
    badgeColor,
    summary,
    breakdown: {
      windSpeedScore,
      gustQualityScore,
      directionSafetyScore,
      tideWaterScore,
    },
  };
}
