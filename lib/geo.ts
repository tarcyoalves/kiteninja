/**
 * Utilitários geográficos usados pelo mapa: distância entre dois pontos
 * (fórmula de Haversine) e busca do spot mais próximo de uma coordenada —
 * usado pelo botão "Localizar" do MapView.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Distância em quilômetros entre duas coordenadas geográficas, pela fórmula
 * de Haversine (assume Terra esférica — erro desprezível para distâncias de
 * uso em kitesurf, na ordem de metros a milhares de km).
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));

  return EARTH_RADIUS_KM * c;
}

/**
 * Encontra, dentro de uma lista de spots, o mais próximo da coordenada dada.
 * Retorna null se a lista estiver vazia.
 */
export function nearestSpot<T extends LatLng>(
  lat: number,
  lng: number,
  spots: T[]
): { spot: T; distanceKm: number } | null {
  if (spots.length === 0) return null;

  let closest = spots[0];
  let closestDistance = haversineKm({ lat, lng }, closest);

  for (let i = 1; i < spots.length; i++) {
    const distance = haversineKm({ lat, lng }, spots[i]);
    if (distance < closestDistance) {
      closest = spots[i];
      closestDistance = distance;
    }
  }

  return { spot: closest, distanceKm: closestDistance };
}
