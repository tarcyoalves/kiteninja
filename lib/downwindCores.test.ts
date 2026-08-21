/**
 * Testes da cor por participante.
 *
 * A cor é a única legenda do mapa: a bolinha de alguém e a trilha dessa mesma
 * pessoa têm que combinar, e a combinação tem que valer no aparelho de todo
 * mundo do grupo ao mesmo tempo. Determinismo aqui não é capricho — é o que
 * torna possível seguir um rastro até a pessoa.
 */
import { describe, expect, it } from 'vitest';
import { corDoUsuario, COR_SINAL, PALETA_DOWNWIND } from './downwindCores';

const UUIDS = [
  '0f6a3f18-2b0e-4a44-9f7b-1c2d3e4f5a6b',
  '1a2b3c4d-5e6f-4718-8293-a4b5c6d7e8f9',
  '2b3c4d5e-6f70-4819-93a4-b5c6d7e8f9a0',
  '3c4d5e6f-7081-491a-a4b5-c6d7e8f9a0b1',
  '4d5e6f70-8192-4a1b-b5c6-d7e8f9a0b1c2',
  '5e6f7081-92a3-4b1c-86d7-e8f9a0b1c2d3',
  '6f708192-a3b4-4c1d-97e8-f9a0b1c2d3e4',
  '708192a3-b4c5-4d1e-a8f9-a0b1c2d3e4f5',
];

describe('corDoUsuario', () => {
  it('é determinística: a mesma pessoa tem sempre a mesma cor', () => {
    for (const id of UUIDS) {
      expect(corDoUsuario(id)).toBe(corDoUsuario(id));
    }
  });

  it('toda cor devolvida pertence à paleta (nunca undefined por índice fora)', () => {
    for (const id of UUIDS) {
      expect(PALETA_DOWNWIND).toContain(corDoUsuario(id));
    }
  });

  it('string vazia não quebra nem devolve undefined', () => {
    expect(PALETA_DOWNWIND).toContain(corDoUsuario(''));
  });

  it('ids parecidos não caem todos na mesma cor (o hash espalha)', () => {
    // UUIDs sequenciais são o caso realista de um seed, e um hash ruim os
    // agruparia. Não exigimos zero colisão — com 12 cores e 8 ids ela é
    // esperada — só que não seja tudo a mesma cor.
    const cores = new Set(UUIDS.map(corDoUsuario));
    expect(cores.size).toBeGreaterThanOrEqual(4);
  });

  it('a paleta não tem cor repetida', () => {
    expect(new Set(PALETA_DOWNWIND).size).toBe(PALETA_DOWNWIND.length);
  });
});

describe('COR_SINAL', () => {
  it('cobre os três estados de sinal de lib/downwind.ts', () => {
    expect(Object.keys(COR_SINAL).sort()).toEqual(['atrasado', 'ok', 'sem_sinal']);
  });

  it('as três cores são distintas (o anel precisa comunicar de relance)', () => {
    expect(new Set(Object.values(COR_SINAL)).size).toBe(3);
  });
});
