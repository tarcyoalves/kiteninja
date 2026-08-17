/**
 * Testes do cálculo de kite. É a recomendação com maior consequência física do
 * app: kite grande demais em vento forte arranca o velejador do chão. As
 * invariantes abaixo valem mais que qualquer número exato da fórmula.
 */
import { describe, expect, it } from 'vitest';
import { calculateKiteSize, degToCompassSafe, getWindColorClass } from './windUtils';

describe('calculateKiteSize — invariantes de segurança', () => {
  it('mais vento nunca recomenda kite maior', () => {
    let anterior = Infinity;
    for (let knots = 10; knots <= 40; knots += 2) {
      const { recommendedSize } = calculateKiteSize(75, knots);
      expect(recommendedSize).toBeLessThanOrEqual(anterior);
      anterior = recommendedSize;
    }
  });

  it('mais peso nunca recomenda kite menor', () => {
    let anterior = 0;
    for (const kg of [50, 60, 70, 80, 90, 100, 110]) {
      const { recommendedSize } = calculateKiteSize(kg, 20);
      expect(recommendedSize).toBeGreaterThanOrEqual(anterior);
      anterior = recommendedSize;
    }
  });

  it('vento rajado nunca recomenda kite maior que vento limpo', () => {
    for (let knots = 10; knots <= 35; knots += 5) {
      const lagoa = calculateKiteSize(75, knots, 'Kitesurf Twintip', 'lagoa');
      const rajado = calculateKiteSize(75, knots, 'Kitesurf Twintip', 'rajado');
      expect(rajado.recommendedSize).toBeLessThanOrEqual(lagoa.recommendedSize);
    }
  });

  it('mantém o resultado dentro dos tamanhos que existem no mercado', () => {
    for (const kg of [40, 75, 130]) {
      for (let knots = 7; knots <= 50; knots += 3) {
        const r = calculateKiteSize(kg, knots);
        expect(r.recommendedSize).toBeGreaterThanOrEqual(3);
        expect(r.recommendedSize).toBeLessThanOrEqual(21);
        expect(r.minSize).toBeLessThanOrEqual(r.recommendedSize);
        expect(r.maxSize).toBeGreaterThanOrEqual(r.recommendedSize);
      }
    }
  });

  it('foil usa kite menor que twintip no mesmo vento', () => {
    const tt = calculateKiteSize(75, 15, 'Kitesurf Twintip');
    const foil = calculateKiteSize(75, 15, 'Hydrofoil');
    const wing = calculateKiteSize(75, 15, 'Wingfoil');
    expect(foil.recommendedSize).toBeLessThan(tt.recommendedSize);
    expect(wing.recommendedSize).toBeLessThan(foil.recommendedSize);
  });

  it('referência: 75kg com 20 nós fica perto de 9m²', () => {
    const { recommendedSize } = calculateKiteSize(75, 20);
    expect(recommendedSize).toBeGreaterThanOrEqual(8);
    expect(recommendedSize).toBeLessThanOrEqual(10);
  });

  it('avisa que não dá para velejar com vento fraco', () => {
    const r = calculateKiteSize(75, 5);
    expect(r.suitable).toBe(false);
    expect(r.statusMessage).toMatch(/insuficiente/i);
  });

  it('peso zero ou negativo não produz Infinity nem NaN', () => {
    for (const kg of [0, -10]) {
      const r = calculateKiteSize(kg, 20);
      expect(Number.isFinite(r.recommendedSize)).toBe(true);
      expect(r.recommendedSize).toBeGreaterThanOrEqual(3);
    }
  });

  it('vento extremo domina a mensagem, mesmo em vento rajado', () => {
    const r = calculateKiteSize(75, 32, 'Kitesurf Twintip', 'rajado');
    expect(r.statusMessage).toMatch(/extremo/i);
  });
});

describe('getWindColorClass', () => {
  it('sobe de faixa conforme o vento aumenta (novos limites: 0-8 sky, 8-12 cyan, 12-22 emerald, 22-30 amber, 30+ rose)', () => {
    expect(getWindColorClass(5).text).toContain('sky');
    expect(getWindColorClass(8).text).toContain('cyan');
    expect(getWindColorClass(12).text).toContain('emerald');
    expect(getWindColorClass(20).text).toContain('emerald');
    expect(getWindColorClass(22).text).toContain('amber');
    expect(getWindColorClass(30).text).toContain('rose');
  });

  it('sempre devolve todas as classes que a UI consome', () => {
    for (const knots of [0, 11, 16, 22, 27, 40]) {
      const c = getWindColorClass(knots);
      for (const key of ['bg', 'text', 'badge', 'gradient', 'border', 'glow'] as const) {
        expect(c[key]).toBeTruthy();
      }
    }
  });
});

describe('degToCompassSafe', () => {
  it('converte os pontos cardeais', () => {
    expect(degToCompassSafe(0)).toBe('N');
    expect(degToCompassSafe(90)).toBe('E');
    expect(degToCompassSafe(180)).toBe('S');
    expect(degToCompassSafe(270)).toBe('W');
  });

  it('normaliza ângulo fora de 0..360', () => {
    expect(degToCompassSafe(360)).toBe('N');
    expect(degToCompassSafe(450)).toBe('E');
    expect(degToCompassSafe(-90)).toBe('W');
  });
});
