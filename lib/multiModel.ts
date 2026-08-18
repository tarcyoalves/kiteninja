import type { MultiModelForecast } from '@/types';

/**
 * Motor de Consenso Multimodelo Meteorológico.
 *
 * Combina os 3 principais modelos globais de alta resolução:
 * 1. ECMWF (IFS 0.25° - Centro Europeu de Previsões): Padrão ouro para ventos marítimos e costa.
 * 2. GFS (NOAA Seamless - Estados Unidos): Excelente detecção de gradientes térmicos e vento sinótico.
 * 3. ICON (DWD - Serviço Alemão): Ótima física de microescala e convecção costeira.
 *
 * A combinação ponderada reduz o viés de modelos individuais e gera um índice
 * de confiança matemático sobre a previsibilidade do dia.
 */
export function calcularConsensoMultimodelo(
  gfsRaw: number,
  ecmwfRaw: number,
  iconRaw: number
): MultiModelForecast {
  const gfs = Number.isFinite(gfsRaw) ? Math.max(0, gfsRaw) : 0;
  const ecmwf = Number.isFinite(ecmwfRaw) ? Math.max(0, ecmwfRaw) : gfs;
  const icon = Number.isFinite(iconRaw) ? Math.max(0, iconRaw) : gfs;

  // Pesos calibrados: ECMWF 45%, GFS 35%, ICON 20%
  const consenso = Math.round(ecmwf * 0.45 + gfs * 0.35 + icon * 0.2);
  const min = Math.min(gfs, ecmwf, icon);
  const max = Math.max(gfs, ecmwf, icon);
  const spread = Math.round((max - min) * 10) / 10;

  let confidencePercent = 90;
  if (spread <= 1.0) {
    confidencePercent = 98;
  } else if (spread <= 2.0) {
    confidencePercent = 94;
  } else if (spread <= 3.0) {
    confidencePercent = 88;
  } else if (spread <= 4.5) {
    confidencePercent = 78;
  } else if (spread <= 6.0) {
    confidencePercent = 65;
  } else {
    confidencePercent = Math.max(35, Math.round(65 - (spread - 6) * 5));
  }

  let confidenceLevel: 'Alta' | 'Média' | 'Baixa' = 'Alta';
  let confidenceText = '';

  if (confidencePercent >= 85) {
    confidenceLevel = 'Alta';
    confidenceText =
      spread <= 1.5
        ? 'Altíssima concordância entre ECMWF, GFS e ICON'
        : `Forte consenso entre modelos (variação de apenas ${spread.toFixed(1).replace('.', ',')} nós)`;
  } else if (confidencePercent >= 70) {
    confidenceLevel = 'Média';
    confidenceText = `Concordância moderada (${spread.toFixed(1).replace('.', ',')} nós de diferença entre modelos)`;
  } else {
    confidenceLevel = 'Baixa';
    confidenceText = `Modelos divergem (${spread.toFixed(1).replace('.', ',')} nós de variação). Condições podem oscilar.`;
  }

  return {
    consensusKnots: consenso,
    spreadKnots: spread,
    confidencePercent,
    confidenceLevel,
    confidenceText,
    models: {
      gfsKnots: Math.round(gfs),
      ecmwfKnots: Math.round(ecmwf),
      iconKnots: Math.round(icon),
    },
  };
}
