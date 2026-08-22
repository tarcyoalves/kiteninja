import { describe, expect, it } from 'vitest';
import { devePuxarAtualizar, LIMIAR_PULL_PX, progressoPull } from './pullToRefresh';

describe('devePuxarAtualizar', () => {
  it('dispara quando começou no topo e o arrasto cruza o limiar', () => {
    expect(devePuxarAtualizar(0, LIMIAR_PULL_PX)).toBe(true);
    expect(devePuxarAtualizar(0, LIMIAR_PULL_PX + 20)).toBe(true);
  });

  it('não dispara se o arrasto fica abaixo do limiar', () => {
    expect(devePuxarAtualizar(0, LIMIAR_PULL_PX - 1)).toBe(false);
  });

  it('não dispara se a lista NÃO estava no topo (é rolagem normal, não pull)', () => {
    expect(devePuxarAtualizar(120, LIMIAR_PULL_PX + 50)).toBe(false);
  });

  it('não dispara para arrasto para cima (delta negativo)', () => {
    expect(devePuxarAtualizar(0, -30)).toBe(false);
  });

  it('scrollTop levemente negativo (bounce do iOS) ainda conta como "no topo"', () => {
    expect(devePuxarAtualizar(-2, LIMIAR_PULL_PX)).toBe(true);
  });
});

describe('progressoPull', () => {
  it('delta 0 ou negativo é progresso 0', () => {
    expect(progressoPull(0)).toBe(0);
    expect(progressoPull(-10)).toBe(0);
  });

  it('delta na metade do limiar é progresso 0.5', () => {
    expect(progressoPull(LIMIAR_PULL_PX / 2)).toBeCloseTo(0.5);
  });

  it('delta no limiar é progresso 1', () => {
    expect(progressoPull(LIMIAR_PULL_PX)).toBe(1);
  });

  it('delta muito além do limiar trava em 1 (não cresce sem fim)', () => {
    expect(progressoPull(LIMIAR_PULL_PX * 10)).toBe(1);
  });
});
