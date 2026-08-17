import { describe, it, expect } from 'vitest';
import { vetorVento, corPorForca } from './windVector';

/**
 * A convenção meteorológica é a fonte de erro aqui: o grau indica de ONDE o
 * vento vem, não para onde vai. Trocar o sinal deixaria a animação inteira no
 * sentido contrário ao real — um bug que "parece funcionar" e engana o velejador
 * sobre a direção da rajada. Estes testes fixam a convenção.
 *
 * Lembrando que em tela o eixo y cresce PARA BAIXO.
 */
describe('vetorVento', () => {
  it('vento de norte (0°) empurra para o sul, ou seja, para baixo na tela', () => {
    const { vx, vy } = vetorVento(0);
    expect(vx).toBeCloseTo(0, 6);
    expect(vy).toBeCloseTo(1, 6); // y positivo = desce na tela = vai ao sul
  });

  it('vento de sul (180°) empurra para o norte, para cima na tela', () => {
    const { vx, vy } = vetorVento(180);
    expect(vx).toBeCloseTo(0, 6);
    expect(vy).toBeCloseTo(-1, 6);
  });

  it('vento de leste (90°) empurra para oeste, para a esquerda', () => {
    const { vx, vy } = vetorVento(90);
    expect(vx).toBeCloseTo(-1, 6); // negativo = esquerda da tela = oeste
    expect(vy).toBeCloseTo(0, 6);
  });

  it('vento de oeste (270°) empurra para leste, para a direita', () => {
    const { vx, vy } = vetorVento(270);
    expect(vx).toBeCloseTo(1, 6);
    expect(vy).toBeCloseTo(0, 6);
  });

  it('ESE (115°), o caso do print, aponta para oeste-noroeste', () => {
    const { vx, vy } = vetorVento(115);
    // Vindo de ESE, sopra para WNW: esquerda (vx<0) e para cima (vy<0).
    expect(vx).toBeLessThan(0);
    expect(vy).toBeLessThan(0);
  });

  it('é sempre unitário, para a velocidade vir só da intensidade', () => {
    for (const g of [0, 37, 90, 115, 180, 233, 270, 359]) {
      const { vx, vy } = vetorVento(g);
      expect(Math.hypot(vx, vy)).toBeCloseTo(1, 6);
    }
  });

  it('trata grau acima de 360 e negativo sem quebrar', () => {
    const a = vetorVento(370);
    const b = vetorVento(10);
    expect(a.vx).toBeCloseTo(b.vx, 6);
    expect(a.vy).toBeCloseTo(b.vy, 6);

    const c = vetorVento(-90);
    const d = vetorVento(270);
    expect(c.vx).toBeCloseTo(d.vx, 6);
    expect(c.vy).toBeCloseTo(d.vy, 6);
  });
});

describe('corPorForca', () => {
  it('segue a mesma escala do resto do app', () => {
    expect(corPorForca(8)).toContain('34,211,238'); // ciano: fraco
    expect(corPorForca(16)).toContain('52,211,153'); // esmeralda: ideal
    expect(corPorForca(24)).toContain('251,191,36'); // âmbar: forte
    expect(corPorForca(35)).toContain('244,114,182'); // rosa: perigoso
  });

  it('não deixa faixa sem cor, inclusive em zero e valores extremos', () => {
    for (const k of [0, 11.9, 12, 19.9, 20, 27.9, 28, 60]) {
      expect(corPorForca(k)).toMatch(/^rgba\(/);
    }
  });
});
