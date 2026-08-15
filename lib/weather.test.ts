import { describe, expect, it } from 'vitest';
import { degToCompass, describeWeather, getSpotWeather, weatherIcon } from './weather';

describe('degToCompass', () => {
  it('mapeia os pontos cardeais', () => {
    expect(degToCompass(0)).toBe('N');
    expect(degToCompass(90)).toBe('E');
    expect(degToCompass(180)).toBe('S');
    expect(degToCompass(270)).toBe('W');
  });

  it('arredonda para o setor de 22,5°', () => {
    expect(degToCompass(45)).toBe('NE');
    expect(degToCompass(141)).toBe('SE');
    expect(degToCompass(112.5)).toBe('ESE');
  });

  it('trata 360 e negativos como N', () => {
    expect(degToCompass(360)).toBe('N');
    expect(degToCompass(-90)).toBe('W');
  });
});

describe('describeWeather', () => {
  it('traduz os códigos WMO usados na tela', () => {
    expect(describeWeather(0)).toBe('Céu limpo');
    expect(describeWeather(3)).toBe('Nublado');
    expect(describeWeather(63)).toBe('Chuva');
    expect(describeWeather(95)).toBe('Tempestade');
  });
});

describe('weatherIcon', () => {
  it('distingue dia e noite quando faz diferença', () => {
    expect(weatherIcon(0, true)).toBe('sun');
    expect(weatherIcon(0, false)).toBe('moon');
    expect(weatherIcon(2, true)).toBe('cloud-sun');
    expect(weatherIcon(2, false)).toBe('cloud-moon');
  });

  it('chuva e céu encoberto não dependem da hora', () => {
    expect(weatherIcon(3, true)).toBe('cloud');
    expect(weatherIcon(3, false)).toBe('cloud');
    expect(weatherIcon(80, true)).toBe('rain');
    expect(weatherIcon(80, false)).toBe('rain');
  });
});

// Bate na Open-Meteo de verdade: é o que garante que os nomes dos campos ainda
// existem. Sem rede, o módulo devolve null e o teste é ignorado.
describe('getSpotWeather (rede real)', () => {
  it('traz previsão coerente para Ponta do Mel', async () => {
    const w = await getSpotWeather(-4.9572, -36.8833, 2);
    if (!w) {
      console.warn('Open-Meteo inacessível, teste de rede ignorado.');
      return;
    }

    expect(w.daysForecast.length).toBeGreaterThanOrEqual(1);
    expect(w.daysForecast[0].shortDate).toMatch(/^Hoje,/);
    expect(w.daysForecast[0].hours.length).toBeGreaterThan(0);

    // A grade tem que ser horária e completa no primeiro dia inteiro.
    const hours = w.daysForecast[0].hours;
    expect(hours[0].hour).toMatch(/^\d{2}h$/);

    for (const h of hours) {
      expect(h.knots).toBeGreaterThanOrEqual(0);
      expect(h.knots).toBeLessThan(150);
      expect(h.gustKnots).toBeGreaterThanOrEqual(0);
      expect(h.directionDeg).toBeGreaterThanOrEqual(0);
      expect(h.directionDeg).toBeLessThanOrEqual(360);
      expect(h.directionText).toMatch(/^[NSEW]{1,3}$/);
      expect(h.temperature).toBeGreaterThan(-20);
      expect(h.temperature).toBeLessThan(60);
      expect(h.pressureHpa).toBeGreaterThan(800);
      expect(['up', 'down', 'peak_high', 'peak_low']).toContain(h.tideTrend);
    }

    expect(['subindo', 'descendo', 'estável']).toContain(w.currentTideTrend);
    expect(w.maxKnots).toBeGreaterThanOrEqual(w.currentKnots > 0 ? 1 : 0);
    expect(w.lastUpdated).toMatch(/^\d{2}:\d{2}$/);
    // Vento nunca é aleatório: dois pedidos seguidos dão o mesmo número (cache).
    const again = await getSpotWeather(-4.9572, -36.8833, 2);
    expect(again?.currentKnots).toBe(w.currentKnots);
  }, 30000);

  it('coordenada em terra firme ainda devolve vento, sem onda', async () => {
    // Brasília: a API marinha não cobre, a atmosférica sim.
    const w = await getSpotWeather(-15.7939, -47.8828, 1);
    if (!w) return;
    expect(w.currentKnots).toBeGreaterThanOrEqual(0);
    expect(w.waveHeightM).toBe(0);
    expect(w.nextTideInfo).toBe('Sem dado de maré');
  }, 30000);
});
