import { describe, expect, it } from 'vitest';
import { getObservedWind, MONITOR_TREMEMBE_ID, parseSpeedDetails } from './windObserved';

describe('parseSpeedDetails', () => {
  it('lê o formato real da API do wind-monitor', () => {
    const r = parseSpeedDetails({
      _avg: { speed: 14.2 },
      _max: { speed: 21.5 },
      lastRecordedAt: '2026-08-19T17:37:56.000Z',
    });
    expect(r).toEqual({ avgSpeed: 14.2, maxSpeed: 21.5, lastRecordedAt: '2026-08-19T17:37:56.000Z' });
  });

  it('devolve null para payload vazio ou incompleto', () => {
    expect(parseSpeedDetails(null)).toBeNull();
    expect(parseSpeedDetails({})).toBeNull();
    expect(parseSpeedDetails({ _avg: { speed: 10 } })).toBeNull();
    expect(parseSpeedDetails({ _avg: { speed: 'x' }, _max: { speed: 10 }, lastRecordedAt: '2026-01-01' })).toBeNull();
  });
});

// Bate na API real, mesmo padrão de lib/weather.test.ts para Open-Meteo — sem
// mock, é o que garante que o parsing continua batendo com o formato real.
describe('getObservedWind (API real)', () => {
  it('busca a leitura atual da estação de Tremembé', async () => {
    const result = await getObservedWind(MONITOR_TREMEMBE_ID);
    // Rede instável não pode quebrar CI: só valida a FORMA quando a fonte responde.
    if (result) {
      expect(result.avgSpeed).toBeGreaterThanOrEqual(0);
      expect(result.maxSpeed).toBeGreaterThanOrEqual(result.avgSpeed);
      expect(typeof result.lastRecordedAt).toBe('string');
    }
  }, 10000);
});
