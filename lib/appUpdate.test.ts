import { describe, expect, it } from 'vitest';
import { detectarNovoCommit } from './appUpdate';

describe('detectarNovoCommit', () => {
  const atual = 'aaae5b612b07ad99fce3ad4198b3c7a4f5b12e04';

  it('não anuncia quando bundle e deploy são o mesmo commit', () => {
    expect(detectarNovoCommit(atual, atual)).toBeNull();
  });

  it('considera SHA curto e completo como a mesma revisão', () => {
    expect(detectarNovoCommit('aaae5b6', atual)).toBeNull();
    expect(detectarNovoCommit(atual, 'aaae5b6')).toBeNull();
  });

  it('anuncia somente quando existe outro SHA Git válido', () => {
    const novo = '1234567890abcdef1234567890abcdef12345678';
    expect(detectarNovoCommit(atual, novo)).toBe(novo);
  });

  it('não usa local, horário ou valor inválido como versão', () => {
    expect(detectarNovoCommit('local', atual)).toBeNull();
    expect(detectarNovoCommit(atual, 'local')).toBeNull();
    expect(detectarNovoCommit(atual, '2026-08-31T19:21:53.256Z')).toBeNull();
    expect(detectarNovoCommit(undefined, atual)).toBeNull();
  });
});
