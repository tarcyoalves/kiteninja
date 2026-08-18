/**
 * Testes da lógica de grade de previsão.
 *
 * Cobertura: dia completo de 24h, dia que começa à tarde, buracos de dados,
 * e resolução do bloco da hora atual.
 */
import { describe, expect, it } from 'vitest';
import {
  filterHoursBy3,
  resolveCurrentHourBlock,
  hasGapsInHours,
  getPreparedHours,
} from './forecastGrid';
import type { WindForecastHour } from '@/types';

const hourRow = (hour: string): WindForecastHour => ({
  hour,
  knots: 15,
  gustKnots: 18,
  directionDeg: 90,
  directionText: 'E',
  conditionIcon: 'sun',
  temperature: 25,
  pressureHpa: 1013,
  waveHeightM: 0.5,
  wavePeriodS: 8,
  waveDirDeg: 90,
  tideTrend: 'up',
  tideHeightM: 2.0,
});

describe('filterHoursBy3', () => {
  it('dia completo de 24h reduz para 8 linhas (múltiplos de 3)', () => {
    const fullDay: WindForecastHour[] = Array.from({ length: 24 }, (_, i) =>
      hourRow(`${String(i).padStart(2, '0')}h`)
    );

    const filtered = filterHoursBy3(fullDay);

    expect(filtered.length).toBe(8);
    expect(filtered.map((h) => h.hour)).toEqual([
      '00h', '03h', '06h', '09h', '12h', '15h', '18h', '21h',
    ]);
  });

  it('dia que começa às 14h (velejador abre à tarde) filtra corretamente', () => {
    // Simula um dia que começa em 14h: 14h, 15h, ..., 23h
    const afternoonDay: WindForecastHour[] = Array.from({ length: 10 }, (_, i) =>
      hourRow(`${String(14 + i).padStart(2, '0')}h`)
    );

    const filtered = filterHoursBy3(afternoonDay);

    // O dia tem 14h-23h, múltiplos de 3 nesse rango: 15h, 18h, 21h
    expect(filtered.map((h) => h.hour)).toEqual(['15h', '18h', '21h']);
  });

  it('dia com buraco de dados (falta 12h) pula o buraco', () => {
    const dayWithGap: WindForecastHour[] = [
      hourRow('00h'),
      hourRow('03h'),
      hourRow('06h'),
      hourRow('09h'),
      // buraco: 12h não existe
      hourRow('15h'),
      hourRow('18h'),
      hourRow('21h'),
    ];

    const filtered = filterHoursBy3(dayWithGap);

    // Deve ter 00h, 03h, 06h, 09h, 15h, 18h, 21h (7 linhas, 12h pulado)
    expect(filtered.length).toBe(7);
    expect(filtered.find((h) => h.hour === '12h')).toBeUndefined();
  });

  it('array vazio retorna vazio', () => {
    expect(filterHoursBy3([])).toEqual([]);
    expect(filterHoursBy3(null as unknown as WindForecastHour[])).toEqual([]);
  });

  it('herda pico de maré que ocorre dentro da janela de 3 horas', () => {
    const dayWithPeak: WindForecastHour[] = Array.from({ length: 24 }, (_, i) =>
      hourRow(`${String(i).padStart(2, '0')}h`)
    );

    // Às 01h houve uma maré baixa às 01:09 com 0.5m
    dayWithPeak[1] = {
      ...dayWithPeak[1],
      tideTrend: 'peak_low',
      tidePeakTime: '01:09',
      tidePeakHeight: '0.5m',
      tideHeightM: 0.5,
    };

    const filtered = filterHoursBy3(dayWithPeak);
    const block00 = filtered.find((h) => h.hour === '00h');

    expect(block00).toBeDefined();
    expect(block00?.tideTrend).toBe('peak_low');
    expect(block00?.tidePeakTime).toBe('01:09');
    expect(block00?.tidePeakHeight).toBe('0.5m');
  });

  it('herda a rajada máxima que ocorre na janela de 3 horas', () => {
    const dayWithGust: WindForecastHour[] = Array.from({ length: 24 }, (_, i) =>
      hourRow(`${String(i).padStart(2, '0')}h`)
    );

    dayWithGust[0].gustKnots = 20;
    dayWithGust[1].gustKnots = 31; // pico de rajada na hora 01h
    dayWithGust[2].gustKnots = 25;

    const filtered = filterHoursBy3(dayWithGust);
    const block00 = filtered.find((h) => h.hour === '00h');

    expect(block00?.gustKnots).toBe(31);
  });
});

describe('resolveCurrentHourBlock', () => {
  const gridHours: WindForecastHour[] = [
    hourRow('00h'),
    hourRow('03h'),
    hourRow('06h'),
    hourRow('09h'),
    hourRow('12h'),
    hourRow('15h'),
    hourRow('18h'),
    hourRow('21h'),
  ];

  it('16h cai no bloco 15h', () => {
    expect(resolveCurrentHourBlock(gridHours, 16)).toBe(5); // ��ndice de 15h
  });

  it('15h cai no bloco 15h (exato)', () => {
    expect(resolveCurrentHourBlock(gridHours, 15)).toBe(5);
  });

  it('14h cai no bloco 12h (primeiro horário menor)', () => {
    expect(resolveCurrentHourBlock(gridHours, 14)).toBe(4); // índice de 12h
  });

  it('00h cai no bloco 00h', () => {
    expect(resolveCurrentHourBlock(gridHours, 0)).toBe(0);
  });

  it('23h cai no bloco 21h', () => {
    expect(resolveCurrentHourBlock(gridHours, 23)).toBe(7); // índice de 21h
  });

  it('hora inválida (-1) retorna -1', () => {
    expect(resolveCurrentHourBlock(gridHours, -1)).toBe(-1);
  });

  it('array vazio retorna -1', () => {
    expect(resolveCurrentHourBlock([], 12)).toBe(-1);
  });
});

describe('hasGapsInHours', () => {
  it('detecta buraco entre 09h e 15h', () => {
    const withGap = [
      hourRow('00h'),
      hourRow('03h'),
      hourRow('06h'),
      hourRow('09h'),
      // buraco: 10, 11, 12, 13, 14
      hourRow('15h'),
    ];
    expect(hasGapsInHours(withGap)).toBe(true);
  });

  it('sequência contínua não tem buraco', () => {
    const continuous = [hourRow('00h'), hourRow('01h'), hourRow('02h'), hourRow('03h')];
    expect(hasGapsInHours(continuous)).toBe(false);
  });

  it('array vazio ou unitário não tem buraco', () => {
    expect(hasGapsInHours([])).toBe(false);
    expect(hasGapsInHours([hourRow('12h')])).toBe(false);
  });
});

describe('getPreparedHours', () => {
  it('menos de 8 horas retorna original', () => {
    const short = [hourRow('00h'), hourRow('03h')];
    expect(getPreparedHours(short)).toEqual(short);
  });

  it('mais de 8 horas aplica filtro', () => {
    const full = Array.from({ length: 24 }, (_, i) =>
      hourRow(`${String(i).padStart(2, '0')}h`)
    );
    const prepared = getPreparedHours(full);
    expect(prepared.length).toBe(8);
  });

  it('undefined/null retorna array vazio', () => {
    expect(getPreparedHours(undefined as unknown as WindForecastHour[])).toEqual([]);
    expect(getPreparedHours(null as unknown as WindForecastHour[])).toEqual([]);
  });
});
