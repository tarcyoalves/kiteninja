/**
 * Testes de lib/geoFormat.ts: formatação de distância e classificação
 * de qualidade GPS.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyGpsQuality,
  formatDistance,
  formatAccuracyWithQuality,
  GpsQuality,
} from './geoFormat';

describe('classifyGpsQuality', () => {
  const tests: Array<{ input: number; expected: GpsQuality }> = [
    { input: 5, expected: 'excellent' },
    { input: 15, expected: 'excellent' },
    { input: 50, expected: 'excellent' },
    { input: 51, expected: 'good' },
    { input: 100, expected: 'good' },
    { input: 150, expected: 'good' },
    { input: 151, expected: 'fair' },
    { input: 500, expected: 'fair' },
    { input: 1000, expected: 'fair' },
    { input: 1001, expected: 'poor' },
    { input: 5000, expected: 'poor' },
    { input: 50000, expected: 'poor' },
  ];

  tests.forEach(({ input, expected }) => {
    it(`classifica ${input}m como ${expected}`, () => {
      expect(classifyGpsQuality(input)).toBe(expected);
    });
  });
});

describe('formatDistance', () => {
  it('mostra metros para distâncias menores que 1 km', () => {
    expect(formatDistance(0.1)).toBe('100 m');
    expect(formatDistance(0.5)).toBe('500 m');
    expect(formatDistance(0.85)).toBe('850 m');
    expect(formatDistance(0.001)).toBe('1 m');
  });

  it('trata singular corretamente para 1 m', () => {
    expect(formatDistance(0.001)).toBe('1 m');
  });

  it('mostra quilômetros com 1 casa decimal para < 10 km', () => {
    expect(formatDistance(1)).toBe('1,0 km');
    expect(formatDistance(1.5)).toBe('1,5 km');
    expect(formatDistance(9.9)).toBe('9,9 km');
  });

  it('mostra quilômetros inteiros a partir de 10 km', () => {
    expect(formatDistance(10)).toBe('10 km');
    expect(formatDistance(15.7)).toBe('16 km');
    expect(formatDistance(100)).toBe('100 km');
  });

  it('trata singular corretamente para 1 km', () => {
    expect(formatDistance(1)).toBe('1,0 km');
  });
});

describe('formatAccuracyWithQuality', () => {
  it('formata precisão em metros com classificação', () => {
    expect(formatAccuracyWithQuality(15)).toBe('Precisão: 15 m (excelente)');
    expect(formatAccuracyWithQuality(100)).toBe('Precisão: 100 m (boa)');
    expect(formatAccuracyWithQuality(500)).toBe('Precisão: 500 m (razoável)');
  });

  it('formata precisão em quilômetros quando > 1000m', () => {
    expect(formatAccuracyWithQuality(1500)).toBe('Precisão: 1,5 km (aproximada)');
    expect(formatAccuracyWithQuality(5000)).toBe('Precisão: 5,0 km (aproximada)');
  });
});
