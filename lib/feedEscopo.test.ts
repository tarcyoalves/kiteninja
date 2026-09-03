import { describe, expect, it } from 'vitest';
import { ESCOPO_PADRAO, normalizarEscopo, podeVerNoFeed } from './feedEscopo';

describe('normalizarEscopo', () => {
  it('aceita os dois valores, com espaço e caixa variada', () => {
    expect(normalizarEscopo('comunidade')).toBe('comunidade');
    expect(normalizarEscopo(' SEGUINDO ')).toBe('seguindo');
  });

  it('cai no padrão em vez de estourar', () => {
    // Escopo é preferência de leitura, não permissão: recusar a página porque
    // alguém digitou ?escopo=todos seria pior que mostrar a comunidade.
    for (const ruim of ['todos', '', null, undefined, 7, {}]) {
      expect(normalizarEscopo(ruim)).toBe(ESCOPO_PADRAO);
    }
  });

  it('o padrão é comunidade — feed vazio não ensina nada a quem chegou agora', () => {
    expect(ESCOPO_PADRAO).toBe('comunidade');
  });
});

describe('podeVerNoFeed', () => {
  const base = {
    escopo: 'comunidade' as const,
    autorId: 'outro',
    souEu: 'eu',
    isPublic: true,
    euSigoOAutor: false,
  };

  it('comunidade mostra público de quem eu NÃO sigo — é o ponto da aba', () => {
    expect(podeVerNoFeed(base)).toBe(true);
  });

  it('seguindo esconde quem eu não sigo', () => {
    expect(podeVerNoFeed({ ...base, escopo: 'seguindo' })).toBe(false);
    expect(podeVerNoFeed({ ...base, escopo: 'seguindo', euSigoOAutor: true })).toBe(true);
  });

  it('sessão PRIVADA de terceiro não aparece em escopo nenhum', () => {
    // A trava que importa: trocar de aba amplia quem aparece, nunca o que é
    // visível. Se este teste cair, a aba Comunidade virou um vazamento.
    for (const escopo of ['comunidade', 'seguindo'] as const) {
      expect(
        podeVerNoFeed({ ...base, escopo, isPublic: false }),
        escopo
      ).toBe(false);
      expect(
        podeVerNoFeed({ ...base, escopo, isPublic: false, euSigoOAutor: true }),
        `${escopo} seguindo`
      ).toBe(false);
    }
  });

  it('eu me vejo nos dois escopos, inclusive o que marquei como privado', () => {
    for (const escopo of ['comunidade', 'seguindo'] as const) {
      expect(
        podeVerNoFeed({ ...base, escopo, autorId: 'eu', isPublic: false }),
        escopo
      ).toBe(true);
    }
  });
});
