import { beforeEach, describe, expect, it } from 'vitest';
import { marcarSeloVisto, seloAindaNovo } from './seloNovo';

// O ambiente de teste é Node: um localStorage mínimo basta.
const guardado = new Map<string, string>();
beforeEach(() => {
  guardado.clear();
  (globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem'> }).localStorage = {
    getItem: (k) => guardado.get(k) ?? null,
    setItem: (k, v) => void guardado.set(k, String(v)),
  };
});

describe('selo "Novo" do menu', () => {
  it('aparece até o item ser aberto e some depois, só para aquele item', () => {
    expect(seloAindaNovo('mapa')).toBe(true);
    expect(seloAindaNovo('anuncios')).toBe(true);
    marcarSeloVisto('mapa');
    expect(seloAindaNovo('mapa')).toBe(false);
    expect(seloAindaNovo('anuncios')).toBe(true);
  });

  it('sem armazenamento disponível, não mostra selo (não dá para lembrar)', () => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(seloAindaNovo('mapa')).toBe(false);
    expect(() => marcarSeloVisto('mapa')).not.toThrow();
  });
});
