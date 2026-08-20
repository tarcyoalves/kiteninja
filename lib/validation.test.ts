/**
 * Testes das funções puras de lib/validation.ts usadas pelo perfil
 * auto-atendido (app/api/profile/route.ts): clampQuiverKites e
 * clampQuiverBoards descartam itens fora da faixa em vez de rejeitar a
 * requisição inteira — o mesmo comportamento tolerante que os demais campos
 * de array do perfil (ex: disciplines) já tinham antes.
 */
import { describe, expect, it } from 'vitest';
import { clampQuiverBoards, clampQuiverKites } from './validation';

describe('clampQuiverKites', () => {
  it('mantém tamanhos dentro da faixa real de kites (3 a 21 m²)', () => {
    expect(clampQuiverKites([9, 12, 7])).toEqual([9, 12, 7]);
  });

  it('descarta itens fora da faixa em vez de rejeitar a lista inteira', () => {
    expect(clampQuiverKites([2, 9, 25, 12])).toEqual([9, 12]);
  });

  it('aceita os limites inclusivos', () => {
    expect(clampQuiverKites([3, 21])).toEqual([3, 21]);
  });

  it('descarta valores não numéricos e strings vazias', () => {
    expect(clampQuiverKites([9, 'foo', null, undefined, 'NaN'])).toEqual([9]);
  });

  it('limita a 10 itens por padrão (ninguém tem 50 pipas)', () => {
    const muitas = Array.from({ length: 15 }, (_, i) => 5 + (i % 10));
    expect(clampQuiverKites(muitas)).toHaveLength(10);
  });

  it('não é uma lista: devolve array vazio em vez de lançar', () => {
    expect(clampQuiverKites('9')).toEqual([]);
    expect(clampQuiverKites(null)).toEqual([]);
    expect(clampQuiverKites(undefined)).toEqual([]);
  });

  it('respeita faixa e limite customizados', () => {
    expect(clampQuiverKites([1, 2, 3, 4], { min: 2, max: 3, maxItems: 1 })).toEqual([2]);
  });
});

describe('clampQuiverBoards', () => {
  it('mantém strings não vazias, aparadas', () => {
    expect(clampQuiverBoards(['  North Whip 135cm  ', 'Duotone Team'])).toEqual([
      'North Whip 135cm',
      'Duotone Team',
    ]);
  });

  it('descarta itens vazios ou só espaço', () => {
    expect(clampQuiverBoards(['Prancha A', '', '   '])).toEqual(['Prancha A']);
  });

  it('corta itens além do tamanho máximo de caracteres', () => {
    const longo = 'X'.repeat(100);
    expect(clampQuiverBoards([longo])[0]).toHaveLength(60);
  });

  it('limita a 10 itens por padrão', () => {
    const muitas = Array.from({ length: 15 }, (_, i) => `Prancha ${i}`);
    expect(clampQuiverBoards(muitas)).toHaveLength(10);
  });

  it('não é uma lista: devolve array vazio em vez de lançar', () => {
    expect(clampQuiverBoards('Prancha A')).toEqual([]);
    expect(clampQuiverBoards(null)).toEqual([]);
  });

  it('converte itens não-string para texto antes de validar', () => {
    expect(clampQuiverBoards([135, true])).toEqual(['135', 'true']);
  });
});
