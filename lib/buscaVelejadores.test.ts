import { describe, expect, it } from 'vitest';
import { deveBuscarVelejadores, MIN_CHARS_BUSCA } from './buscaVelejadores';

describe('deveBuscarVelejadores', () => {
  it('não busca com string vazia', () => {
    expect(deveBuscarVelejadores('')).toBe(false);
  });

  it('não busca com 1 caractere', () => {
    expect(deveBuscarVelejadores('a')).toBe(false);
  });

  it(`busca a partir de ${MIN_CHARS_BUSCA} caracteres`, () => {
    expect(deveBuscarVelejadores('an')).toBe(true);
    expect(deveBuscarVelejadores('ana')).toBe(true);
  });

  it('espaços em branco nas pontas não contam como caractere de busca', () => {
    expect(deveBuscarVelejadores(' a ')).toBe(false);
    expect(deveBuscarVelejadores(' an ')).toBe(true);
  });
});
