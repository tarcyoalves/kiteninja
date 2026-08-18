import { describe, it, expect } from 'vitest';
import { vetorVento, corPorForca, campoDeVento } from './windVector';

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
  it('segue a mesma escala do resto do app (novos limites: 0-8 sky, 8-12 cyan, 12-22 emerald, 22-30 amber, 30+ rose)', () => {
    // 5 nós = sky (sem vento)
    expect(corPorForca(5)).toContain('233'); // rgb de sky
    // 10 nós = cyan (fraco)
    expect(corPorForca(10)).toContain('182'); // cyan-500
    // 16 nós = emerald (bom)
    expect(corPorForca(16)).toContain('129'); // emerald-500
    // 25 nós = amber (forte)
    expect(corPorForca(25)).toContain('11'); // amber-500
    // 35 nós = rose (perigoso)
    expect(corPorForca(35)).toContain('94'); // rose-500
  });

  it('não deixa faixa sem cor, inclusive em zero e valores extremos', () => {
    for (const k of [0, 7.9, 8, 11.9, 12, 21.9, 22, 29.9, 30, 60]) {
      expect(corPorForca(k)).toMatch(/^rgba\(/);
    }
  });
});

describe('campoDeVento', () => {
  it('retorna zero quando a lista de spots projetados está vazia', () => {
    const res = campoDeVento(100, 100, []);
    expect(res).toEqual({ vx: 0, vy: 0, forca: 0 });
  });

  it('calcula o campo corretamente a partir de spots projetados com vento', () => {
    const spotsProjetados = [
      { x: 100, y: 100, vx: -1, vy: 0, forca: 20 },
      { x: 200, y: 100, vx: -1, vy: 0, forca: 18 },
    ];
    const res = campoDeVento(150, 100, spotsProjetados);
    expect(res.vx).toBeCloseTo(-1, 2);
    expect(res.vy).toBeCloseTo(0, 2);
    expect(res.forca).toBeCloseTo(19, 1);
  });

  it('permite atualizar o campo de vento quando novos spots chegam sem quebrar o cálculo', () => {
    let spotsProjetados: { x: number; y: number; vx: number; vy: number; forca: number }[] = [];
    expect(campoDeVento(50, 50, spotsProjetados).forca).toBe(0);

    // Simula a chegada assíncrona dos dados
    spotsProjetados = [{ x: 50, y: 50, vx: 0, vy: 1, forca: 22 }];
    const atualizado = campoDeVento(50, 50, spotsProjetados);
    expect(atualizado.forca).toBeCloseTo(22, 1);
    expect(atualizado.vy).toBeCloseTo(1, 2);
  });
});

