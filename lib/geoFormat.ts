/**
 * Utilitários de formatação geográfica para geolocalização do usuário.
 * Separado do geo.ts para facilitar testes unitários.
 */

export interface UserPosition {
  lat: number;
  lng: number;
  accuracy: number; // metros
}

/**
 * Classificação da qualidade do GPS baseada na precisão em metros.
 * GPS de smartphone em área aberta tipicamente: 3-15m (excelente)
 * GPS travado ou localização por IP: >1000m (péssimo)
 */
export type GpsQuality = 'excellent' | 'good' | 'fair' | 'poor';

export function classifyGpsQuality(accuracyMeters: number): GpsQuality {
  if (accuracyMeters <= 50) return 'excellent';
  if (accuracyMeters <= 150) return 'good';
  if (accuracyMeters <= 1000) return 'fair';
  return 'poor';
}

/**
 * Formata distância em metros ou quilômetros, de forma legível.
 * Usa singular/plural correto e arredonda para valores inteiros.
 */
export function formatDistance(distanceKm: number): string {
  if (distanceKm < 1) {
    // Converter para metros
    const meters = Math.round(distanceKm * 1000);
    return meters === 1 ? '1 m' : `${meters} m`;
  }

  // A partir de 1 km, mostrar com 1 casa decimal se < 10 km, ou inteiro se >= 10 km
  if (distanceKm < 10) {
    const formatted = distanceKm.toFixed(1).replace('.', ',');
    return `${formatted} km`;
  }

  const km = Math.round(distanceKm);
  return km === 1 ? '1 km' : `${km} km`;
}

/**
 * Formata a precisão do GPS para exibição, incluindo a classificação.
 * Exemplo: "Precisão: 15 m (excelente)" ou "Precisão: 1,2 km (aproximada)"
 */
export function formatAccuracyWithQuality(accuracyMeters: number): string {
  const quality = classifyGpsQuality(accuracyMeters);

  const qualityLabels: Record<GpsQuality, string> = {
    excellent: 'excelente',
    good: 'boa',
    fair: 'razoável',
    poor: 'aproximada',
  };

  const accuracyStr = accuracyMeters >= 1000
    ? `${(accuracyMeters / 1000).toFixed(1).replace('.', ',')} km`
    : `${Math.round(accuracyMeters)} m`;

  return `Precisão: ${accuracyStr} (${qualityLabels[quality]})`;
}
