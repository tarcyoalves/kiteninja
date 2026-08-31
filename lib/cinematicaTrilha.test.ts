import { describe, expect, it } from 'vitest';
import {
  derivarCinematica,
  MAX_NOS_PLAUSIVEL,
  MIN_DELTA_MS,
  resumirTrilha,
  rumoGraus,
  type PontoBruto,
} from './cinematicaTrilha';

const T0 = 1_700_000_000_000;

/** ~1,111 km por 0,01° de latitude — o bastante para contas legíveis. */
const ponto = (lat: number, lng: number, segundos: number): PontoBruto => ({
  lat,
  lng,
  tsMs: T0 + segundos * 1000,
});

describe('rumoGraus', () => {
  it('norte, sul, leste e oeste', () => {
    const origem = { lat: 0, lng: 0 };
    expect(rumoGraus(origem, { lat: 1, lng: 0 })).toBeCloseTo(0, 5);
    expect(rumoGraus(origem, { lat: 0, lng: 1 })).toBeCloseTo(90, 5);
    expect(rumoGraus(origem, { lat: -1, lng: 0 })).toBeCloseTo(180, 5);
    expect(rumoGraus(origem, { lat: 0, lng: -1 })).toBeCloseTo(270, 5);
  });

  it('devolve sempre 0..360, nunca negativo', () => {
    const r = rumoGraus({ lat: 0, lng: 0 }, { lat: -1, lng: -1 });
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(360);
  });
});

describe('derivarCinematica', () => {
  it('preserva comprimento e ordem da trilha', () => {
    const trilha = [ponto(-4.9, -37, 0), ponto(-4.91, -37, 60), ponto(-4.92, -37, 120)];
    expect(derivarCinematica(trilha)).toHaveLength(3);
  });

  it('o primeiro ponto não tem de onde derivar: 0 nós e rumo nulo', () => {
    const r = derivarCinematica([ponto(-4.9, -37, 0), ponto(-4.91, -37, 60)]);
    expect(r[0]).toEqual({ velocidadeNos: 0, rumoGraus: null });
  });

  it('deriva a velocidade de dois pontos consecutivos', () => {
    // 0,01° de latitude ~= 1,111 km, em 60 s -> ~66,7 km/h -> ~36 nós.
    const r = derivarCinematica([ponto(-4.9, -37, 0), ponto(-4.91, -37, 60)]);
    expect(r[1].velocidadeNos).toBeGreaterThan(34);
    expect(r[1].velocidadeNos).toBeLessThan(38);
  });

  it('trilha vazia ou de um ponto só não quebra', () => {
    expect(derivarCinematica([])).toEqual([]);
    expect(derivarCinematica([ponto(-4.9, -37, 0)])).toHaveLength(1);
  });

  /**
   * O motivo do piso de tempo. Dois fixes a 1 s de distância com o erro
   * normal do GPS dariam dezenas de nós com o celular parado na areia — e
   * esse pico viraria a "velocidade máxima" da travessia no resumo.
   */
  it('não inventa velocidade quando os pontos estão perto demais no tempo', () => {
    const trilha = [
      ponto(-4.9, -37, 0),
      ponto(-4.9001, -37, 1), // 1 s: abaixo do piso
    ];
    expect(MIN_DELTA_MS).toBeGreaterThan(1000);
    expect(derivarCinematica(trilha)[1].velocidadeNos).toBe(0);
  });

  it('herda a última velocidade conhecida em vez de zerar num intervalo curto', () => {
    const trilha = [
      ponto(-4.9, -37, 0),
      ponto(-4.91, -37, 60), // velocidade real
      ponto(-4.9101, -37, 61), // 1 s depois: mantém a anterior
    ];
    const r = derivarCinematica(trilha);
    expect(r[2].velocidadeNos).toBe(r[1].velocidadeNos);
  });

  /**
   * Salto de GPS (fix perdido e recuperado longe). Sem o teto, UM ponto ruim
   * marcaria a travessia inteira com uma velocidade máxima absurda.
   */
  it('descarta salto de GPS acima do teto de plausibilidade', () => {
    const trilha = [
      ponto(-4.9, -37, 0),
      ponto(-4.91, -37, 60),
      ponto(-3.0, -37, 70), // ~200 km em 10 s
    ];
    const r = derivarCinematica(trilha);
    expect(r[2].velocidadeNos).toBeLessThanOrEqual(MAX_NOS_PLAUSIVEL);
    expect(r[2].velocidadeNos).toBe(r[1].velocidadeNos);
  });

  it('relógio andando para trás não produz velocidade negativa', () => {
    const trilha = [ponto(-4.9, -37, 60), ponto(-4.91, -37, 0)];
    expect(derivarCinematica(trilha)[1].velocidadeNos).toBeGreaterThanOrEqual(0);
  });

  it('rumo acompanha a direção do movimento', () => {
    const r = derivarCinematica([ponto(0, 0, 0), ponto(0, 0.01, 60)]);
    expect(r[1].rumoGraus).toBeCloseTo(90, 3);
  });
});

describe('resumirTrilha', () => {
  it('trilha curta demais não tem distância nem velocidade', () => {
    expect(resumirTrilha([])).toEqual({ distanciaKm: 0, velocidadeMaxNos: 0 });
    expect(resumirTrilha([ponto(-4.9, -37, 0)])).toEqual({ distanciaKm: 0, velocidadeMaxNos: 0 });
  });

  it('soma os trechos consecutivos', () => {
    const trilha = [ponto(-4.9, -37, 0), ponto(-4.91, -37, 60), ponto(-4.92, -37, 120)];
    // Dois trechos de ~1,111 km.
    expect(resumirTrilha(trilha).distanciaKm).toBeGreaterThan(2.1);
    expect(resumirTrilha(trilha).distanciaKm).toBeLessThan(2.3);
  });

  /**
   * A distância soma TODOS os trechos, inclusive os curtos demais para virar
   * velocidade: ignorá-los subestimaria a travessia, e a soma não sofre com o
   * ruído do jeito que a divisão por um `dt` minúsculo sofre.
   */
  it('conta trechos curtos na distância mesmo sem contá-los na velocidade', () => {
    const trilha = [ponto(-4.9, -37, 0), ponto(-4.91, -37, 1)];
    expect(resumirTrilha(trilha).distanciaKm).toBeGreaterThan(1);
    expect(resumirTrilha(trilha).velocidadeMaxNos).toBe(0);
  });

  it('a velocidade máxima ignora o salto de GPS', () => {
    const trilha = [ponto(-4.9, -37, 0), ponto(-4.91, -37, 60), ponto(-3.0, -37, 70)];
    expect(resumirTrilha(trilha).velocidadeMaxNos).toBeLessThanOrEqual(MAX_NOS_PLAUSIVEL);
  });
});
