import { describe, it, expect } from 'vitest';
import {
  encontrarEstacaoMaregraficaMaisProxima,
  encontrarEstacaoMareParaSpot,
  calibrarNivelMareHarmonica,
  DISTANCIA_MAX_ESTACAO_KM,
  ESTACOES_MAREGRAFICAS_CHM,
} from './tideHarmonics';
import { INITIAL_SPOTS } from '../data/mockSpots';

function distanciaKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
    expect(res.estacao?.id).toBe('termisa-areia-branca');
  });

  it('retorna null se o valor do MSL for indefinido ou nulo', () => {
    const res = calibrarNivelMareHarmonica(null, -4.95, -36.88);
    expect(res.nivelNauticoM).toBeNull();
  });
});

/**
 * O bug que estes testes existem para impedir.
 *
 * A busca por estação não tinha teto de distância. O spot Praia Seca (Lagoa de
 * Araruama, RJ) era calibrado com o Porto do Recife, a 1.833 km, e o app
 * exibia 1,48 m de maré para uma laguna hipersalina que quase não tem maré.
 *
 * Os cinco testes acima estavam verdes o tempo todo — e continuariam verdes —
 * porque todos usam spots do Nordeste, escolhidos à mão, todos perto de uma
 * estação. Por isso os testes abaixo varrem o CATÁLOGO REAL (`INITIAL_SPOTS`)
 * em vez de coordenadas escolhidas: um spot novo numa região sem estação
 * quebra o teste em vez de passar despercebido exibindo a maré de outro
 * estado.
 */
describe('tideHarmonics — teto de distância da estação', () => {
  it('recusa calibrar Praia Seca (RJ) com a estação de Recife, a 1.833 km', () => {
    const praiaSeca = { lat: -22.9231, lng: -42.2764 };

    // A estação mais próxima existe, mas está do outro lado do país.
    const maisProxima = encontrarEstacaoMaregraficaMaisProxima(praiaSeca.lat, praiaSeca.lng);
    const km = distanciaKm(praiaSeca.lat, praiaSeca.lng, maisProxima.lat, maisProxima.lng);
    expect(km).toBeGreaterThan(1000);

    // Então nenhuma estação vale para este spot, e não sai número nenhum.
    expect(encontrarEstacaoMareParaSpot(praiaSeca.lat, praiaSeca.lng)).toBeNull();

    const res = calibrarNivelMareHarmonica(0, praiaSeca.lat, praiaSeca.lng);
    expect(res.estacao).toBeNull();
    expect(res.nivelNauticoM).toBeNull();
  });

  it('nenhum spot do catálogo é calibrado por estação além do teto', () => {
    for (const spot of INITIAL_SPOTS) {
      const estacao = encontrarEstacaoMareParaSpot(spot.lat, spot.lng);
      if (estacao === null) continue;

      const km = distanciaKm(spot.lat, spot.lng, estacao.lat, estacao.lng);
      expect(
        km,
        `${spot.name} (${spot.state}) calibrado por ${estacao.nome} a ${km.toFixed(0)} km`
      ).toBeLessThanOrEqual(DISTANCIA_MAX_ESTACAO_KM);
    }
  });

  it('os spots sem cobertura de maré são exatamente os conhecidos', () => {
    // Lista fechada de propósito: incluir um spot numa região nova sem somar
    // a estação do CHM correspondente quebra aqui, em vez de sair silencioso
    // mostrando a maré de outro estado.
    const semCobertura = INITIAL_SPOTS.filter(
      (s) => encontrarEstacaoMareParaSpot(s.lat, s.lng) === null
    ).map((s) => s.id);

    expect(semCobertura).toEqual(['araruama-praia-seca']);
  });

  it('todo spot coberto produz um nível náutico acima do Zero Hidrográfico', () => {
    for (const spot of INITIAL_SPOTS) {
      const res = calibrarNivelMareHarmonica(0, spot.lat, spot.lng);
      if (res.estacao === null) {
        expect(res.nivelNauticoM).toBeNull();
        continue;
      }
      expect(res.nivelNauticoM).toBeGreaterThan(0);
    }
  });

  it('toda estação cadastrada tem amplitude e nível médio plausíveis', () => {
    // Constantes sem fonte foram a origem do problema; ao menos travamos a
    // faixa física para que um valor digitado errado não passe.
    for (const e of ESTACOES_MAREGRAFICAS_CHM) {
      expect(e.nivelMedioM, `${e.nome}: nível médio`).toBeGreaterThan(0);
      expect(e.nivelMedioM, `${e.nome}: nível médio`).toBeLessThan(5);
      expect(e.fatorAmplitude, `${e.nome}: fator`).toBeGreaterThan(0.5);
      expect(e.fatorAmplitude, `${e.nome}: fator`).toBeLessThan(2.5);
      expect(Math.abs(e.lat), `${e.nome}: latitude`).toBeLessThanOrEqual(90);
      expect(Math.abs(e.lng), `${e.nome}: longitude`).toBeLessThanOrEqual(180);
    }
  });
});
