/**
 * Testes das funções puras de lógica do VideoTrimmer.
 * O componente é client-side e importar JSX no teste exigira ambiente DOM.
 * Estes testes validam a matemática de validação, conversão e formatação.
 */
import { describe, expect, it } from 'vitest';
import {
  posicaoParaSegundo,
  segundoParaPercentual,
  formatarSegundos,
  clampTrecho,
  validarValorInicial,
} from './VideoTrimmer';
import type { TrechoVideo } from './VideoTrimmer';

describe('posicaoParaSegundo', () => {
  it('converte posição 0 para 0 segundos', () => {
    expect(posicaoParaSegundo(0, 100, 10)).toBe(0);
  });

  it('converte posição no meio para metade da duração', () => {
    expect(posicaoParaSegundo(50, 100, 10)).toBe(5);
  });

  it('converte posição final para duração total', () => {
    expect(posicaoParaSegundo(100, 100, 10)).toBe(10);
  });

  it('limita a 0 quando posição é negativa', () => {
    expect(posicaoParaSegundo(-10, 100, 10)).toBe(0);
  });

  it('limita a duracao quando posição ultrapassa', () => {
    expect(posicaoParaSegundo(150, 100, 10)).toBe(10);
  });

  it('retorna 0 com largura zero', () => {
    expect(posicaoParaSegundo(50, 0, 10)).toBe(0);
  });

  it('retorna 0 com duração zero', () => {
    expect(posicaoParaSegundo(50, 100, 0)).toBe(0);
  });

  it('calcula corretamente com larguras não-redondas', () => {
    expect(posicaoParaSegundo(33, 100, 10)).toBeCloseTo(3.3, 5);
  });
});

describe('segundoParaPercentual', () => {
  it('converte 0 para 0%', () => {
    expect(segundoParaPercentual(0, 10)).toBe(0);
  });

  it('converte metade para 50%', () => {
    expect(segundoParaPercentual(5, 10)).toBe(0.5);
  });

  it('converte duração total para 100%', () => {
    expect(segundoParaPercentual(10, 10)).toBe(1);
  });

  it('limita a 0% quando negativo', () => {
    expect(segundoParaPercentual(-5, 10)).toBe(0);
  });

  it('limita a 100% quando ultrapassa', () => {
    expect(segundoParaPercentual(15, 10)).toBe(1);
  });

  it('retorna 0 com duração zero', () => {
    expect(segundoParaPercentual(5, 0)).toBe(0);
  });
});

describe('formatarSegundos', () => {
  it('formata zero', () => {
    expect(formatarSegundos(0)).toBe('0s');
  });

  it('formata número inteiro', () => {
    expect(formatarSegundos(5)).toBe('5s');
  });

  it('arredonda para uma casa decimal', () => {
    expect(formatarSegundos(4.23)).toBe('4,2s');
  });

  it('arredonda para cima corretamente', () => {
    expect(formatarSegundos(4.26)).toBe('4,3s');
  });

  it('arredonda para baixo corretamente', () => {
    expect(formatarSegundos(4.24)).toBe('4,2s');
  });

  it('formata números grandes', () => {
    expect(formatarSegundos(120.5)).toBe('120,5s');
  });

  it('formata números decimais pequenos', () => {
    expect(formatarSegundos(0.15)).toBe('0,2s');
  });

  it('formata exatamente 1.5 como 1,5s', () => {
    expect(formatarSegundos(1.5)).toBe('1,5s');
  });

  it('formata exatamente 12 como 12s', () => {
    expect(formatarSegundos(12)).toBe('12s');
  });
});

describe('clampTrecho', () => {
  const duracaoVideo = 30;

  it('retorna trecho válido inalterado', () => {
    const entrada = { inicioSeg: 5, fimSeg: 10 };
    const resultado = clampTrecho(entrada, duracaoVideo, 1.5, 12);
    expect(resultado).toEqual(entrada);
  });

  it('limita início ao mínimo do vídeo', () => {
    const entrada = { inicioSeg: -5, fimSeg: 10 };
    const resultado = clampTrecho(entrada, duracaoVideo, 1.5, 12);
    expect(resultado.inicioSeg).toBe(0);
  });

  it('limita fim ao máximo do vídeo', () => {
    const entrada = { inicioSeg: 20, fimSeg: 40 };
    const resultado = clampTrecho(entrada, duracaoVideo, 1.5, 12);
    expect(resultado.fimSeg).toBe(30);
  });

  it('corrige início >= fim com minSeg de distância', () => {
    const entrada = { inicioSeg: 10, fimSeg: 5 };
    const resultado = clampTrecho(entrada, duracaoVideo, 1.5, 12);
    expect(resultado.inicioSeg).toBeLessThan(resultado.fimSeg);
    expect(resultado.fimSeg - resultado.inicioSeg).toBeGreaterThanOrEqual(1.5);
  });

  it('empurra a outra alça quando excede maxSeg', () => {
    // Início fixo em 5, fim em 25 (20s > 12s maxSeg)
    const entrada = { inicioSeg: 5, fimSeg: 25 };
    const resultado = clampTrecho(entrada, duracaoVideo, 1.5, 12);
    expect(resultado.fimSeg - resultado.inicioSeg).toBeLessThanOrEqual(12);
    // O início deve continuar sendo 5
    expect(resultado.inicioSeg).toBe(5);
    expect(resultado.fimSeg).toBe(17); // 5 + 12
  });

  it('corta o fim no fim do vídeo e preserva o início quando o trecho couber', () => {
    // inicio=18, fim=35 num vídeo de 30s. O fim é limitado a 30 ANTES de medir
    // a duração, então sobram exatos 12s — dentro do máximo. Empurrar o início
    // aqui seria mover uma alça que o admin acabou de posicionar.
    const entrada = { inicioSeg: 18, fimSeg: 35 };
    const resultado = clampTrecho(entrada, duracaoVideo, 1.5, 12);
    expect(resultado.fimSeg).toBe(30); // Limita ao fim do vídeo
    expect(resultado.inicioSeg).toBe(18); // início intacto
    expect(resultado.fimSeg - resultado.inicioSeg).toBeLessThanOrEqual(12);
  });

  it('garante minSeg de distância entre as alças', () => {
    const entrada = { inicioSeg: 5, fimSeg: 6 }; // 1s < 1.5minSeg
    const resultado = clampTrecho(entrada, duracaoVideo, 1.5, 12);
    expect(resultado.fimSeg - resultado.inicioSeg).toBe(1.5);
  });

  it('funciona com vídeo curto (menor que minSeg)', () => {
    const entrada = { inicioSeg: 0, fimSeg: 1 };
    const resultado = clampTrecho(entrada, 1, 1.5, 12);
    expect(resultado.fimSeg).toBe(1);
    expect(resultado.inicioSeg).toBe(0);
  });
});

describe('validarValorInicial', () => {
  const duracaoVideo = 30;
  const minSeg = 1.5;
  const maxSeg = 12;

  it('retorna padrão quando undefined', () => {
    const resultado = validarValorInicial(undefined, duracaoVideo, minSeg, maxSeg);
    expect(resultado).toEqual({ inicioSeg: 0, fimSeg: 1.5 });
  });

  it('retorna padrão quando null', () => {
    // Cast explícito em vez de `any`: o teste existe justamente para provar
    // que a função aguenta entrada que o TIPO diz ser impossível — quem
    // chama de JS puro (ou de uma resposta de API) pode mandar null.
    const resultado = validarValorInicial(null as unknown as TrechoVideo, duracaoVideo, minSeg, maxSeg);
    expect(resultado).toEqual({ inicioSeg: 0, fimSeg: 1.5 });
  });

  it('aceita valor inicial válido', () => {
    const entrada = { inicioSeg: 5, fimSeg: 10 };
    const resultado = validarValorInicial(entrada, duracaoVideo, minSeg, maxSeg);
    expect(resultado).toEqual(entrada);
  });

  it('corrige valor inicial fora dos limites', () => {
    const entrada = { inicioSeg: -5, fimSeg: 50 };
    const resultado = validarValorInicial(entrada, duracaoVideo, minSeg, maxSeg);
    expect(resultado.inicioSeg).toBe(0);
    expect(resultado.fimSeg).toBeLessThanOrEqual(duracaoVideo);
  });

  it('corrige valor inicial com NaN', () => {
    const entrada = { inicioSeg: NaN, fimSeg: 10 };
    const resultado = validarValorInicial(entrada, duracaoVideo, minSeg, maxSeg);
    expect(resultado).toEqual({ inicioSeg: 0, fimSeg: 1.5 });
  });

  it('corrige valor inicial com undefined', () => {
    const entrada = { inicioSeg: undefined, fimSeg: 10 } as unknown as TrechoVideo;
    const resultado = validarValorInicial(entrada, duracaoVideo, minSeg, maxSeg);
    expect(resultado).toEqual({ inicioSeg: 0, fimSeg: 1.5 });
  });

  it('valida corretamente com maxSeg aplicado', () => {
    const entrada = { inicioSeg: 5, fimSeg: 25 }; // 20s > 12s
    const resultado = validarValorInicial(entrada, duracaoVideo, minSeg, maxSeg);
    expect(resultado.fimSeg - resultado.inicioSeg).toBeLessThanOrEqual(12);
  });
});

describe('casos de borda diversos', () => {
  it('duração zero não causa divisão por zero', () => {
    expect(posicaoParaSegundo(50, 100, 0)).toBe(0);
    expect(segundoParaPercentual(5, 0)).toBe(0);
  });

  it('valores extremos não quebram clampTrecho', () => {
    const resultado = clampTrecho(
      { inicioSeg: 0, fimSeg: Number.MAX_VALUE },
      30,
      1.5,
      12
    );
    expect(resultado.fimSeg - resultado.inicioSeg).toBeLessThanOrEqual(12);
  });

  it('arredondamento não produz NaN', () => {
    const formatado = formatarSegundos(0.1 * 0.1);
    expect(formatado).toBe('0s');
  });
});
