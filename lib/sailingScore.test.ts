import { describe, it, expect } from 'vitest';
import { calcularSailingScore } from './sailingScore';

describe('calcularSailingScore', () => {
  it('atribui nota Épica (>85) para dia perfeito de 20 nós Side-Onshore e mar tranquilo', () => {
    const score = calcularSailingScore({
      knots: 20,
      gustKnots: 23,
      windSafety: 'Side-Onshore',
      waveHeightM: 0.6,
    });
    expect(score.totalScore).toBeGreaterThanOrEqual(85);
    expect(score.classification).toBe('Épico');
    expect(score.badgeColor).toBe('#10b981');
    expect(score.breakdown.windSpeedScore).toBe(35);
    expect(score.breakdown.directionSafetyScore).toBe(25);
  });

  it('derruba o score para <30 e emite alerta de perigo quando o vento é Offshore (terral)', () => {
    const score = calcularSailingScore({
      knots: 20,
      gustKnots: 22,
      windSafety: 'Offshore',
      waveHeightM: 0.5,
    });
    expect(score.totalScore).toBeLessThanOrEqual(25);
    expect(score.classification).toBe('Ruim');
    expect(score.summary).toContain('PERIGO');
  });

  it('penaliza ventos muito fracos abaixo de 8 nós', () => {
    const score = calcularSailingScore({
      knots: 5,
      gustKnots: 7,
      windSafety: 'Side-Onshore',
      waveHeightM: 0.5,
    });
    expect(score.totalScore).toBeLessThan(50);
    expect(score.breakdown.windSpeedScore).toBeLessThan(10);
  });

  it('penaliza rajadas excessivas (vento socado/instável)', () => {
    const scoreLiso = calcularSailingScore({
      knots: 20,
      gustKnots: 22,
      windSafety: 'Side-Shore',
    });
    const scoreRajado = calcularSailingScore({
      knots: 20,
      gustKnots: 36,
      windSafety: 'Side-Shore',
    });
    expect(scoreRajado.breakdown.gustQualityScore).toBeLessThan(
      scoreLiso.breakdown.gustQualityScore
    );
    expect(scoreRajado.totalScore).toBeLessThan(scoreLiso.totalScore);
  });
});
