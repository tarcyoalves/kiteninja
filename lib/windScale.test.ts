/**
 * Testes da escala única de vento do KiteNinja.
 *
 * A escala define as faixas de intensidade do vento para manter consistência
 * visual em todo o app: cor da barra, partículas do mapa, badges, etc.
 */
import { describe, expect, it } from 'vitest';
import {
  getWindBand,
  getWindIntensity,
  getWindRgbaColor,
  getWindTailwindColor,
  getAllWindBands,
  WindBandName,
} from './windScale';

describe('getWindBand — limites de cada faixa', () => {
  it('0 nós é sem vento', () => {
    const band = getWindBand(0);
    expect(band.name).toBe('semVento');
    expect(band.label).toBe('Sem vento');
  });

  it('valores negativos são tratados como sem vento', () => {
    expect(getWindBand(-5).name).toBe('semVento');
    expect(getWindBand(-100).name).toBe('semVento');
  });

  it('NaN é tratado como sem vento', () => {
    expect(getWindBand(NaN).name).toBe('semVento');
  });

  it('7.9 nós é sem vento (abaixo de 8)', () => {
    const band = getWindBand(7.9);
    expect(band.name).toBe('semVento');
  });

  it('8 nós é fraco (início da faixa ciano)', () => {
    const band = getWindBand(8);
    expect(band.name).toBe('fraco');
  });

  it('11.9 nós é fraco (antes de 12)', () => {
    const band = getWindBand(11.9);
    expect(band.name).toBe('fraco');
  });

  it('12 nós é bom (início da faixa verde esmeralda)', () => {
    const band = getWindBand(12);
    expect(band.name).toBe('bom');
  });

  it('21.9 nós é bom (antes de 22)', () => {
    const band = getWindBand(21.9);
    expect(band.name).toBe('bom');
  });

  it('22 nós é forte (início da faixa)', () => {
    const band = getWindBand(22);
    expect(band.name).toBe('forte');
  });

  it('29.9 nós é forte (antes de 30)', () => {
    const band = getWindBand(29.9);
    expect(band.name).toBe('forte');
  });

  it('30 nós é perigoso (início da faixa vermelha)', () => {
    const band = getWindBand(30);
    expect(band.name).toBe('perigoso');
  });

  it('valores absurdos saturam na faixa perigosa', () => {
    const band = getWindBand(99);
    expect(band.name).toBe('perigoso');
  });

  it('Infinity é perigoso', () => {
    const band = getWindBand(Infinity);
    expect(band.name).toBe('perigoso');
  });
});

describe('getWindIntensity — normalização 0..1', () => {
  it('0 nós = 0%', () => {
    expect(getWindIntensity(0)).toBe(0);
  });

  it('valores negativos retornam 0', () => {
    expect(getWindIntensity(-10)).toBe(0);
  });

  it('20 nós com teto 40 = 50%', () => {
    expect(getWindIntensity(20, 40)).toBe(0.5);
  });

  it('40 nós com teto 40 = 100%', () => {
    expect(getWindIntensity(40, 40)).toBe(1);
  });

  it('valores acima do teto saturam em 100%', () => {
    expect(getWindIntensity(50, 40)).toBe(1);
    expect(getWindIntensity(100, 40)).toBe(1);
  });

  it('teto customizável', () => {
    expect(getWindIntensity(10, 20)).toBe(0.5);
    expect(getWindIntensity(20, 20)).toBe(1);
  });
});

describe('getWindRgbaColor — cores para canvas', () => {
  it('sem vento usa cor ciano-escuro (sky)', () => {
    const color = getWindRgbaColor(5);
    expect(color).toContain('rgba');
    expect(color).toContain('233'); // rgb de sky
  });

  it('fraco usa ciano', () => {
    const color = getWindRgbaColor(10);
    expect(color).toContain('rgba');
    expect(color).toContain('182'); // cyan-500
  });

  it('bom usa esmeralda (verde)', () => {
    const color = getWindRgbaColor(15);
    expect(color).toContain('rgba');
    expect(color).toContain('129'); // emerald-500
  });

  it('forte usa âmbar (amarelo)', () => {
    const color = getWindRgbaColor(25);
    expect(color).toContain('rgba');
    expect(color).toContain('11'); // amber-500
  });

  it('perigoso usa rosa (vermelho)', () => {
    const color = getWindRgbaColor(35);
    expect(color).toContain('rgba');
    expect(color).toContain('94'); // rose-500
  });
});

describe('getWindTailwindColor — cor base Tailwind', () => {
  it('retorna o nome da cor Tailwind', () => {
    expect(getWindTailwindColor(5)).toBe('sky');
    expect(getWindTailwindColor(10)).toBe('cyan');
    expect(getWindTailwindColor(15)).toBe('emerald');
    expect(getWindTailwindColor(25)).toBe('amber');
    expect(getWindTailwindColor(35)).toBe('rose');
  });
});

describe('coerência entre faixa e nome', () => {
  it('cada faixa retornada batendo com seu nome', () => {
    // Testa pontos em cada faixa
    const testes = [
      { knots: 0, expected: 'semVento' as WindBandName },
      { knots: 5, expected: 'semVento' as WindBandName },
      { knots: 8, expected: 'fraco' as WindBandName },
      { knots: 11, expected: 'fraco' as WindBandName },
      { knots: 12, expected: 'bom' as WindBandName },
      { knots: 20, expected: 'bom' as WindBandName },
      { knots: 22, expected: 'forte' as WindBandName },
      { knots: 28, expected: 'forte' as WindBandName },
      { knots: 30, expected: 'perigoso' as WindBandName },
      { knots: 50, expected: 'perigoso' as WindBandName },
    ];

    for (const t of testes) {
      expect(getWindBand(t.knots).name).toBe(t.expected);
    }
  });
});

describe('getAllWindBands — lista completa', () => {
  it('retorna todas as 5 faixas', () => {
    const bands = getAllWindBands();
    expect(bands).toHaveLength(5);
  });

  it('as faixas estão em ordem crescente de limite', () => {
    const bands = getAllWindBands();
    let anterior = -1;
    for (const band of bands) {
      expect(band.minKnots).toBeGreaterThan(anterior);
      anterior = band.minKnots;
    }
  });
});
