import { describe, expect, it } from 'vitest';
import { temTrabalhoNaoSalvo } from './descarteFormulario';

describe('temTrabalhoNaoSalvo', () => {
  /**
   * A parte que mais importa: uma confirmação que aparece sempre é uma
   * confirmação que ninguém lê. Formulário intocado fecha na hora.
   */
  it('formulário intocado não pergunta nada', () => {
    expect(temTrabalhoNaoSalvo({})).toBe(false);
    expect(temTrabalhoNaoSalvo({ textos: [], temFoto: false })).toBe(false);
    expect(temTrabalhoNaoSalvo({ textos: ['', null, undefined] })).toBe(false);
  });

  /** Espaço em branco não é trabalho. */
  it('só espaços não conta como preenchido', () => {
    expect(temTrabalhoNaoSalvo({ textos: ['   ', '\n\t'] })).toBe(false);
  });

  it('texto escrito conta', () => {
    expect(temTrabalhoNaoSalvo({ textos: ['vento entrou forte às 15h'] })).toBe(true);
    expect(temTrabalhoNaoSalvo({ textos: ['', 'North Orbit 9m'] })).toBe(true);
  });

  /**
   * Foto é o item mais caro de refazer: a pessoa teria que achar o arquivo de
   * novo, e no celular isso é sair do app e voltar.
   */
  it('foto anexada conta mesmo sem nenhum texto', () => {
    expect(temTrabalhoNaoSalvo({ temFoto: true })).toBe(true);
    expect(temTrabalhoNaoSalvo({ textos: [''], temFoto: true })).toBe(true);
  });
});
