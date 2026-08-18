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

  it('calcula média ponderada favorecendo GFS costeiro de alta resolução', () => {
    // GFS=20 (70%), ECMWF=15 (15%), ICON=15 (15%)
    // 20*0.7 = 14; 15*0.15 = 2.25; 15*0.15 = 2.25 -> Total = 18.5 -> round(19)
    const res = calcularConsensoMultimodelo(20, 15, 15);
    expect(res.consensusKnots).toBe(19);
    expect(res.spreadKnots).toBe(5);
    expect(res.confidencePercent).toBe(65);
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
