import { describe, it, expect } from 'vitest';
import {
  encontrarEstacaoMaregraficaMaisProxima,
  calibrarNivelMareHarmonica,
} from './tideHarmonics';

describe('tideHarmonics', () => {
  it('encontra Termisa / Areia Branca para as coordenadas de Ponta do Mel (-4.95, -36.88)', () => {
    const estacao = encontrarEstacaoMaregraficaMaisProxima(-4.95, -36.88);
    expect(estacao.id).toBe('termisa-areia-branca');
    expect(estacao.uf).toBe('RN');
  });

  it('encontra Macau / Galinhos para as coordenadas de Galinhos (-5.09, -36.27)', () => {
    const estacao = encontrarEstacaoMaregraficaMaisProxima(-5.09, -36.27);
    expect(estacao.id).toBe('macau-galinhos');
  });

  it('encontra Mucuripe para as coordenadas de Cumbuco (-3.62, -38.73)', () => {
    const estacao = encontrarEstacaoMaregraficaMaisProxima(-3.62, -38.73);
    expect(estacao.id).toBe('mucuripe-fortaleza');
    expect(estacao.uf).toBe('CE');
  });

  it('calibra a maré náutica em relação ao Zero Hidrográfico', () => {
    // Para Ponta do Mel com anomalia zero (nível médio puro)
    const res = calibrarNivelMareHarmonica(0, -4.95, -36.88);
    expect(res.nivelNauticoM).toBe(1.85);
    expect(res.estacao.id).toBe('termisa-areia-branca');
  });

  it('retorna null se o valor do MSL for indefinido ou nulo', () => {
    const res = calibrarNivelMareHarmonica(null, -4.95, -36.88);
    expect(res.nivelNauticoM).toBeNull();
  });
});
