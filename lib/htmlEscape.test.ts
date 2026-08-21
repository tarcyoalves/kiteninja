/**
 * Testes do escape de HTML dos marcadores.
 *
 * `L.divIcon({ html })` recebe HTML cru, e é ali que o nome do velejador —
 * campo livre — entra no mapa de todo o grupo. Sem escape, um nome hostil
 * viraria execução de script no aparelho de quem está na água.
 */
import { describe, expect, it } from 'vitest';
import { escaparHtml, iniciaisDoNome } from './htmlEscape';

describe('escaparHtml', () => {
  it('neutraliza uma tag injetada no nome', () => {
    const saida = escaparHtml('<img src=x onerror=alert(1)>');
    expect(saida).not.toContain('<');
    expect(saida).not.toContain('>');
    expect(saida).toContain('&lt;img');
  });

  it('escapa aspas, que quebrariam um atributo do marcador', () => {
    expect(escaparHtml('a"b')).toBe('a&quot;b');
    expect(escaparHtml("a'b")).toBe('a&#39;b');
  });

  it('escapa o & ANTES dos outros (senão re-escaparia os próprios escapes)', () => {
    expect(escaparHtml('&')).toBe('&amp;');
    expect(escaparHtml('<')).toBe('&lt;');
    // Se a ordem estivesse errada, '<' viraria '&amp;lt;'.
    expect(escaparHtml('<')).not.toContain('&amp;');
  });

  it('texto normal atravessa sem mudança', () => {
    expect(escaparHtml('Tarcyo Alves')).toBe('Tarcyo Alves');
    expect(escaparHtml('')).toBe('');
  });

  it('preserva acento (nome brasileiro não pode virar mojibake no mapa)', () => {
    expect(escaparHtml('João Conceição')).toBe('João Conceição');
  });
});

describe('iniciaisDoNome', () => {
  it('nome composto vira primeira + última inicial', () => {
    expect(iniciaisDoNome('Tarcyo Alves')).toBe('TA');
    expect(iniciaisDoNome('Ana Paula de Souza')).toBe('AS');
  });

  it('nome único vira uma letra só', () => {
    expect(iniciaisDoNome('Madonna')).toBe('M');
  });

  it('nome vazio vira "?" — marcador mudo esconde uma pessoa no mapa', () => {
    expect(iniciaisDoNome('')).toBe('?');
    expect(iniciaisDoNome('   ')).toBe('?');
  });

  it('escapa o resultado: inicial hostil não passa', () => {
    expect(iniciaisDoNome('<script> x')).not.toContain('<');
  });

  it('espaços extras não viram iniciais fantasma', () => {
    expect(iniciaisDoNome('  Pedro   Lima  ')).toBe('PL');
  });
});
