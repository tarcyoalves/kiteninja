import { describe, expect, it } from 'vitest';
import {
  degToCompass,
  describeWeather,
  getMarineCoordinates,
  getSpotWeather,
  interpolateTidePeak,
  tideTrendAt,
  weatherIcon,
} from './weather';

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

describe('getMarineCoordinates', () => {
  it('desloca coordenadas do litoral do Nordeste para mar aberto ao norte', () => {
    // Barra de Pernambuquinho (-4.975, -37.042)
    const marine = getMarineCoordinates(-4.975, -37.042);
    expect(marine.lat).toBeGreaterThan(-4.975); // Mais ao norte = valor menos negativo
    expect(marine.lat).toBeCloseTo(-4.895, 2);
  });

  it('desloca coordenadas do litoral Sudeste para mar aberto ao sul', () => {
    // Araruama / RJ (-22.9231, -42.2764)
    const marine = getMarineCoordinates(-22.9231, -42.2764);
    expect(marine.lat).toBeLessThan(-22.9231); // Mais ao sul = valor mais negativo
    expect(marine.lat).toBeCloseTo(-23.0031, 2);
  });
});

describe('tideTrendAt e interpolateTidePeak', () => {
  const times = [
    '2026-08-14T03:00',
    '2026-08-14T04:00',
    '2026-08-14T05:00',
    '2026-08-14T06:00',
    '2026-08-14T07:00',
  ];
  const levels = [1.2, 2.5, 3.4, 2.9, 1.5];

  it('detecta pico de maré alta corretamente', () => {
    // No índice 2 (05:00), 3.4 é maior que 2.5 e 2.9
    expect(tideTrendAt(levels, 2)).toBe('peak_high');
  });

  it('interpola o minuto e altura do pico por parábola nos 3 pontos', () => {
    const peak = interpolateTidePeak(times, levels, 2);
    // Como 2.9 (posterior) é maior que 2.5 (anterior), o pico ocorreu ligeiramente antes de 05:00 (entre 04h e 05h) ou após 05:00?
    // y0=2.5, y1=3.4, y2=2.9 => (2.5 - 2.9) / 2(2.5 - 6.8 + 2.9) = -0.4 / 2(-1.4) = +0.14h => ~8 minutos após 05:00 => 05:09
    expect(peak.peakTime).toMatch(/^05:\d{2}$/);
    expect(peak.peakHeightM).toBeGreaterThanOrEqual(3.4);
  });

  it('detecta pico de maré baixa corretamente e interpola', () => {
    const lowLevels = [2.0, 1.0, 0.2, 0.8, 1.9];
    expect(tideTrendAt(lowLevels, 2)).toBe('peak_low');
    const peak = interpolateTidePeak(times, lowLevels, 2);
    expect(peak.peakTime).toMatch(/^05:\d{2}$/);
    expect(peak.peakHeightM).toBeLessThanOrEqual(0.3);
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

  it('coordenada em terra firme devolve vento e marca onda/maré como ausentes', async () => {
    // Brasília: a API marinha não cobre, a atmosférica sim. O contrato é
    // devolver null, não 0 — 0.0m é mar liso e 0.00m é maré real, então usar
    // zero como "sem dado" fazia a tela afirmar condição que ninguém mediu.
    const w = await getSpotWeather(-15.7939, -47.8828, 1);
    if (!w) return;
    expect(w.currentKnots).toBeGreaterThanOrEqual(0);
    expect(w.waveHeightM).toBeNull();
    expect(w.wavePeriodS).toBeNull();
    expect(w.currentTideHeightM).toBeNull();
    expect(w.currentTideTrend).toBeNull();
    expect(w.nextTideInfo).toBe('Sem dado de maré');

    // E as horas da previsão seguem a mesma regra, não só o bloco "agora".
    const horas = w.daysForecast[0]?.hours ?? [];
    expect(horas.length).toBeGreaterThan(0);
    expect(horas.every((h) => h.tideHeightM === null)).toBe(true);
    expect(horas.every((h) => h.waveHeightM === null)).toBe(true);
    expect(horas.every((h) => h.tideTrend === null)).toBe(true);
    // O vento, que é a razão da tela existir, continua presente.
    expect(horas.every((h) => typeof h.knots === 'number')).toBe(true);
  }, 30000);

  it('spot de praia real traz maré e onda preenchidas', async () => {
    // Contraprova do teste acima: se null virasse o padrão em todo lugar, o
    // bug ficaria escondido atrás de um teste que só aceita ausência.
    const w = await getSpotWeather(-4.9572, -36.8833, 1);
    if (!w) return;
    const horas = w.daysForecast[0]?.hours ?? [];
    const comMare = horas.filter((h) => typeof h.tideHeightM === 'number');
    expect(comMare.length).toBeGreaterThan(0);
  }, 30000);
});
