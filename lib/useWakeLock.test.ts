import { afterEach, describe, expect, it, vi } from 'vitest';
import { deveReadquirir, solicitarWakeLock, suportaWakeLock } from './useWakeLock';

/**
 * O wake lock existe para manter a tela ligada (OLED preto = pixel apagado)
 * durante uma navegação longa, para que lib/usePositionBeacon.ts continue
 * reportando posição em vez de o iOS matar o JS quando a tela apaga.
 *
 * O que se testa aqui, no mesmo espírito de usePositionBeacon.test.ts: o
 * contrato que não pode quebrar é que `solicitarWakeLock` NUNCA rejeita —
 * nem quando a API não existe, nem quando `request()` rejeita — e que a
 * decisão de readquirir ao voltar de segundo plano está correta (é essa
 * lógica que evita o bug clássico de "voltei ao app e a tela apagou
 * sozinha em seguida").
 */

function stubWakeLock(request: ((tipo: 'screen') => Promise<unknown>) | undefined) {
  const nav = globalThis.navigator as unknown as Record<string, unknown> | undefined;
  if (!nav) {
    // Ambiente `node`: não existe `navigator`. Cria só o necessário.
    Object.defineProperty(globalThis, 'navigator', {
      value: request ? { wakeLock: { request } } : {},
      configurable: true,
      writable: true,
    });
    return;
  }
  if (request) {
    Object.defineProperty(globalThis.navigator, 'wakeLock', {
      value: { request },
      configurable: true,
      writable: true,
    });
  } else {
    delete (nav as Record<string, unknown>).wakeLock;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('suportaWakeLock', () => {
  it('é false quando navigator.wakeLock não existe', () => {
    stubWakeLock(undefined);
    expect(suportaWakeLock()).toBe(false);
  });

  it('é true quando navigator.wakeLock existe', () => {
    stubWakeLock(async () => ({ released: false, release: async () => {} }));
    expect(suportaWakeLock()).toBe(true);
  });
});

describe('solicitarWakeLock', () => {
  it('resolve null, em vez de lançar, quando a API não existe (navegador sem suporte)', async () => {
    stubWakeLock(undefined);
    await expect(solicitarWakeLock()).resolves.toBeNull();
  });

  it('resolve null, em vez de lançar, quando request() rejeita (doc oculto ou política do navegador)', async () => {
    stubWakeLock(async () => {
      throw new Error('NotAllowedError');
    });
    await expect(solicitarWakeLock()).resolves.toBeNull();
  });

  it('devolve o sentinel quando request() resolve', async () => {
    const sentinel = { released: false, release: async () => {} };
    stubWakeLock(async () => sentinel);
    await expect(solicitarWakeLock()).resolves.toBe(sentinel);
  });
});

describe('deveReadquirir', () => {
  it('não tenta readquirir enquanto o documento está oculto (a API rejeitaria mesmo)', () => {
    expect(deveReadquirir(true, null)).toBe(false);
    expect(deveReadquirir(true, { released: true })).toBe(false);
  });

  it('tenta readquirir ao voltar a ficar visível se nunca teve lock', () => {
    expect(deveReadquirir(false, null)).toBe(true);
  });

  it('tenta readquirir ao voltar a ficar visível se o lock foi liberado (caso comum: perdido em background)', () => {
    expect(deveReadquirir(false, { released: true })).toBe(true);
  });

  it('não tenta readquirir se já existe um lock vivo, para não duplicar a requisição', () => {
    expect(deveReadquirir(false, { released: false })).toBe(false);
  });
});
