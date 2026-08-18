import { describe, it, expect } from 'vitest';
import { calcularConsensoMultimodelo } from './multiModel';

describe('calcularConsensoMultimodelo', () => {
  it('calcula alta confiança quando os 3 modelos concordam perfeitamente', () => {
    const res = calcularConsensoMultimodelo(20, 20, 20);
    expect(res.consensusKnots).toBe(20);
    expect(res.spreadKnots).toBe(0);
    expect(res.confidencePercent).toBe(98);
    expect(res.confidenceLevel).toBe('Alta');
    expect(res.models.gfsKnots).toBe(20);
    expect(res.models.ecmwfKnots).toBe(20);
    expect(res.models.iconKnots).toBe(20);
  });

  it('calcula média ponderada favorecendo ECMWF e GFS', () => {
    // ECMWF=22 (45%), GFS=18 (35%), ICON=15 (20%)
    // 22*0.45 = 9.9; 18*0.35 = 6.3; 15*0.2 = 3.0 -> Total = 19.2 -> round(19)
    const res = calcularConsensoMultimodelo(18, 22, 15);
    expect(res.consensusKnots).toBe(19);
    expect(res.spreadKnots).toBe(7);
    expect(res.confidencePercent).toBeLessThan(70);
    expect(res.confidenceLevel).toBe('Baixa');
  });

  it('detecta confiança média para divergências moderadas', () => {
    const res = calcularConsensoMultimodelo(19, 21, 17.5);
    expect(res.spreadKnots).toBe(3.5);
    expect(res.confidencePercent).toBe(78);
    expect(res.confidenceLevel).toBe('Média');
  });

  it('trata valores inválidos ou NaN com robustez', () => {
    const res = calcularConsensoMultimodelo(NaN, 18, -5);
    expect(res.consensusKnots).toBeGreaterThanOrEqual(0);
    expect(res.models.gfsKnots).toBe(0);
    expect(res.models.ecmwfKnots).toBe(18);
    expect(res.models.iconKnots).toBe(0);
  });
});
