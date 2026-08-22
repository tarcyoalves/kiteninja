import { describe, expect, it } from 'vitest';
import {
  pontosParaAtributoSvg,
  projetarTrilhaSvg,
  TRILHA_SVG_ALTURA,
  TRILHA_SVG_LARGURA,
} from './trilhaMiniatura';

describe('projetarTrilhaSvg', () => {
  it('trilha vazia devolve array vazio (componente não desenha polyline nenhuma)', () => {
    expect(projetarTrilhaSvg([])).toEqual([]);
  });

  it('trilha com 1 ponto devolve 1 ponto centralizado no viewBox', () => {
    const pontos = projetarTrilhaSvg([[-4.95, -36.88, 1_000]], 400, 300);
    expect(pontos).toEqual([{ x: 200, y: 150 }]);
  });

  it('trilha com N pontos devolve N pontos projetados, na mesma ordem', () => {
    const trilha: Array<[number, number, number]> = [
      [-4.95, -36.88, 1_000],
      [-4.951, -36.881, 2_000],
      [-4.952, -36.882, 3_000],
      [-4.953, -36.883, 4_000],
    ];
    const pontos = projetarTrilhaSvg(trilha);
    expect(pontos).toHaveLength(4);
    for (const p of pontos) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('usa o viewBox padrão quando largura/altura não são passadas', () => {
    const pontos = projetarTrilhaSvg([[-4.95, -36.88, 1_000]]);
    expect(pontos).toEqual([{ x: TRILHA_SVG_LARGURA / 2, y: TRILHA_SVG_ALTURA / 2 }]);
  });

  it('lat maior (mais ao norte) projeta em y menor (mais para cima na tela)', () => {
    const trilha: Array<[number, number, number]> = [
      [-4.90, -36.88, 1_000], // mais ao norte (lat maior, menos negativa)
      [-4.95, -36.88, 2_000], // mais ao sul
    ];
    const [norte, sul] = projetarTrilhaSvg(trilha, 400, 300);
    expect(norte.y).toBeLessThan(sul.y);
  });

  it('trilha parada num único ponto repetido não gera NaN/Infinity (divisão por zero evitada)', () => {
    const trilha: Array<[number, number, number]> = [
      [-4.95, -36.88, 1_000],
      [-4.95, -36.88, 2_000],
      [-4.95, -36.88, 3_000],
    ];
    const pontos = projetarTrilhaSvg(trilha, 400, 300);
    for (const p of pontos) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('preserva a proporção real da trilha (escala única, não uma por eixo)', () => {
    // Construída para que, já compensando a longitude pelo cosseno da
    // latitude média, a amplitude de longitude projetada seja o DOBRO da
    // amplitude de latitude — uma trilha 2x mais larga (mundo real) do que
    // alta. Com viewBox QUADRADO (mesma largura e altura), se a escala fosse
    // uma por eixo (esticando cada eixo para preencher o quadrado
    // igualmente), a proporção 2:1 se perderia e viraria 1:1. Com escala
    // única, o retângulo ocupado pela trilha projetada continua 2:1.
    const latBase = -4.95;
    const cosLat = Math.cos((latBase * Math.PI) / 180);
    const deltaLat = 0.01;
    const deltaLngProjetado = deltaLat * 2; // amplitude de lng projetada = 2x a de lat
    const deltaLng = deltaLngProjetado / cosLat;

    const trilha: Array<[number, number, number]> = [
      [latBase, -36.88, 1_000],
      [latBase, -36.88 + deltaLng, 2_000],
      [latBase + deltaLat, -36.88, 3_000],
      [latBase + deltaLat, -36.88 + deltaLng, 4_000],
    ];

    const viewBoxQuadrado = 300;
    const pontos = projetarTrilhaSvg(trilha, viewBoxQuadrado, viewBoxQuadrado);

    const xs = pontos.map((p) => p.x);
    const ys = pontos.map((p) => p.y);
    const larguraPx = Math.max(...xs) - Math.min(...xs);
    const alturaPx = Math.max(...ys) - Math.min(...ys);

    // Tolerância generosa (não é comparação de ponto flutuante exata): o que
    // importa é a proporção 2:1 sobreviver, não bater no oitavo decimal.
    expect(larguraPx / alturaPx).toBeGreaterThan(1.9);
    expect(larguraPx / alturaPx).toBeLessThan(2.1);
  });

  it('a trilha projetada nunca ultrapassa os limites do viewBox (respeita a margem)', () => {
    const trilha: Array<[number, number, number]> = [
      [-4.90, -36.80, 1_000],
      [-4.95, -36.88, 2_000],
      [-5.00, -36.95, 3_000],
    ];
    const largura = 400;
    const altura = 300;
    const pontos = projetarTrilhaSvg(trilha, largura, altura);
    for (const p of pontos) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(largura);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(altura);
    }
  });
});

describe('pontosParaAtributoSvg', () => {
  it('array vazio vira string vazia', () => {
    expect(pontosParaAtributoSvg([])).toBe('');
  });

  it('formata "x,y" separados por espaço, na ordem dos pontos', () => {
    expect(
      pontosParaAtributoSvg([
        { x: 1, y: 2 },
        { x: 3.5, y: 4.5 },
      ])
    ).toBe('1,2 3.5,4.5');
  });
});
