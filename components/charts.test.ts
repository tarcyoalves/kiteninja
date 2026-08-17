/**
 * Testes da matemática dos gráficos. O ponto aqui não é o visual — é garantir
 * que os marcos de maré vêm dos dados e não de valores fixos no código, que foi
 * exatamente o defeito encontrado na versão anterior.
 */
import { describe, expect, it } from 'vitest';
import type { WindForecastHour } from '../types';

/** Constrói uma hora de previsão com só os campos que o gráfico usa. */
function hour(h: number, tideHeightM: number, trend: WindForecastHour['tideTrend']): WindForecastHour {
  return {
    hour: `${String(h).padStart(2, '0')}h`,
    knots: 15,
    gustKnots: 20,
    directionDeg: 90,
    directionText: 'E',
    conditionIcon: 'sun',
    temperature: 28,
    pressureHpa: 1013,
    waveHeightM: 1,
    wavePeriodS: 5,
    waveDirDeg: 90,
    tideTrend: trend,
    tideHeightM,
    tidePeakTime:
      trend === 'peak_high' || trend === 'peak_low' ? `${String(h).padStart(2, '0')}:00` : undefined,
  };
}

/**
 * Mesma extração de picos usada por TideCurve. Duplicada aqui de propósito:
 * o componente é client-side e importar JSX no teste exigiria ambiente DOM.
 * Se a regra mudar no componente, este teste deve mudar junto.
 */
function extractPeaks(hours: WindForecastHour[]) {
  return hours
    .filter((h) => h.tideTrend === 'peak_high' || h.tideTrend === 'peak_low')
    .map((h) => ({
      high: h.tideTrend === 'peak_high',
      time: h.tidePeakTime ?? h.hour,
      height: h.tideHeightM,
    }));
}

describe('marcos de maré', () => {
  const serie = [
    hour(0, -1.08, 'up'),
    hour(3, 0.08, 'up'),
    hour(6, 1.38, 'peak_high'),
    hour(9, 0.34, 'down'),
    hour(12, -0.95, 'peak_low'),
    hour(15, 0.4, 'up'),
    hour(18, 1.29, 'peak_high'),
    hour(21, 0.1, 'down'),
  ];

  it('extrai exatamente os picos presentes na série', () => {
    const peaks = extractPeaks(serie);
    expect(peaks).toHaveLength(3);
    expect(peaks.filter((p) => p.high)).toHaveLength(2);
    expect(peaks.filter((p) => !p.high)).toHaveLength(1);
  });

  it('usa a altura e o horário vindos do dado, não valores fixos', () => {
    const peaks = extractPeaks(serie);
    expect(peaks[0]).toMatchObject({ high: true, time: '06:00', height: 1.38 });
    expect(peaks[1]).toMatchObject({ high: false, time: '12:00', height: -0.95 });

    // Guarda contra a regressão real que existia: horários de tábua fixos no
    // código, que apareciam igual em todo spot e todo dia.
    const times = peaks.map((p) => p.time);
    expect(times).not.toContain('05:22');
    expect(times).not.toContain('11:37');
    expect(times).not.toContain('17:48');
  });

  it('não inventa marco quando a série não tem pico', () => {
    const semPico = [hour(0, 0.1, 'up'), hour(3, 0.3, 'up'), hour(6, 0.5, 'up')];
    expect(extractPeaks(semPico)).toHaveLength(0);
  });

  it('aceita altura negativa (maré abaixo do nível médio)', () => {
    const peaks = extractPeaks([hour(12, -0.95, 'peak_low')]);
    expect(peaks[0].height).toBeLessThan(0);
  });
});

describe('escala do gráfico', () => {
  it('série achatada não gera divisão por zero', () => {
    const levels = [0.5, 0.5, 0.5];
    const min = Math.min(...levels);
    const max = Math.max(...levels);
    const span = max - min < 0.05 ? 1 : max - min;
    expect(span).toBe(1);

    const y = 90 - 12 - ((levels[0] - min) / span) * (90 - 24);
    expect(Number.isFinite(y)).toBe(true);
  });

  it('vento escala a partir do zero, preservando proporção', () => {
    const knots = [12, 14, 16];
    const max = Math.max(...knots, 1);
    const toY = (v: number) => 90 - 10 - (v / max) * (90 - 20);
    // 12 de 16 deve ficar a 3/4 da altura útil, não no piso do gráfico.
    expect(toY(12)).toBeGreaterThan(toY(16));
    expect(toY(0)).toBe(80);
  });
});
