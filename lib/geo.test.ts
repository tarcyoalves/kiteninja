/**
 * Testes de lib/geo.ts. A distância Fortaleza→Natal (~437km em linha reta,
 * segundo referências de distância geodésica) serve de sanity check contra
 * erro de fórmula; a tolerância de 5% cobre a diferença entre Haversine
 * (esfera perfeita) e o valor de referência (elipsoide real).
 */
import { describe, expect, it } from 'vitest';
import { haversineKm, nearestSpot, LatLng } from './geo';

const FORTALEZA: LatLng = { lat: -3.7319, lng: -38.5267 };
const NATAL: LatLng = { lat: -5.7945, lng: -35.211 };

describe('haversineKm', () => {
  it('calcula a distância Fortaleza→Natal com tolerância de 5%', () => {
    const distance = haversineKm(FORTALEZA, NATAL);
    const expected = 437;
    const tolerance = expected * 0.05;
    expect(distance).toBeGreaterThanOrEqual(expected - tolerance);
    expect(distance).toBeLessThanOrEqual(expected + tolerance);
  });

  it('retorna zero para o mesmo ponto', () => {
    expect(haversineKm(FORTALEZA, FORTALEZA)).toBeCloseTo(0, 6);
  });

  it('é simétrica: distância(A,B) === distância(B,A)', () => {
    const ab = haversineKm(FORTALEZA, NATAL);
    const ba = haversineKm(NATAL, FORTALEZA);
    expect(ab).toBeCloseTo(ba, 9);
  });
});

describe('nearestSpot', () => {
  const spots = [
    { id: 'fortaleza', lat: -3.7319, lng: -38.5267 },
    { id: 'natal', lat: -5.7945, lng: -35.211 },
    { id: 'cumbuco', lat: -3.6264, lng: -38.7303 },
  ];

  it('escolhe o spot geograficamente mais próximo', () => {
    // Ponto bem próximo de Cumbuco, e mais distante de Fortaleza e Natal.
    const result = nearestSpot(-3.63, -38.73, spots);
    expect(result?.spot.id).toBe('cumbuco');
  });

  it('retorna a distância junto com o spot escolhido', () => {
    const result = nearestSpot(-3.7319, -38.5267, spots);
    expect(result?.spot.id).toBe('fortaleza');
    expect(result?.distanceKm).toBeCloseTo(0, 6);
  });

  it('retorna null para lista vazia', () => {
    expect(nearestSpot(-3.73, -38.52, [])).toBeNull();
  });
});
