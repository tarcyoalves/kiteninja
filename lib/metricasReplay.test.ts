import { describe, expect, it } from 'vitest';
import { metricasDaTrilhaReplay, type PontoReplay } from './metricasReplay';

const T0 = Date.parse('2026-08-31T12:00:00.000Z');
const trilha: PontoReplay[] = [
  [-4.975, -37.042, 0, T0],
  [-4.985, -37.042, 12.5, T0 + 60_000],
  [-4.995, -37.042, 19.9, T0 + 120_000],
];

describe('metricasDaTrilhaReplay', () => {
  it('deriva horário, máxima e distância quando o resumo persistido está vazio', () => {
    const metricas = metricasDaTrilhaReplay(trilha);

    expect(metricas.ultimoRegistroMs).toBe(T0 + 120_000);
    expect(metricas.velocidadeMaxNos).toBe(19.9);
    expect(metricas.distanciaKm).toBeGreaterThan(2.1);
    expect(metricas.distanciaKm).toBeLessThan(2.3);
  });

  it('considera somente os pontos já alcançados pelo replay', () => {
    const metricas = metricasDaTrilhaReplay(trilha, T0 + 60_000);

    expect(metricas.ultimoRegistroMs).toBe(T0 + 60_000);
    expect(metricas.velocidadeMaxNos).toBe(12.5);
    expect(metricas.distanciaKm).toBeGreaterThan(1);
    expect(metricas.distanciaKm).toBeLessThan(1.2);
  });

  it('sem posição não inventa registro nem métricas', () => {
    expect(metricasDaTrilhaReplay([])).toEqual({
      distanciaKm: 0,
      velocidadeMaxNos: 0,
      ultimoRegistroMs: null,
    });
  });
});
