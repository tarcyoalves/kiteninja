import { describe, expect, it } from 'vitest';
import { dataCalendario, formatarDataCurta, instanteIso } from './datas';
import { formatRelativeTime } from './chat';

/**
 * O feed, os alertas e o diário mostravam o `toString()` do Date —
 * "Mon Oct 05 2026 23:58:21 GMT+0000 (Coordinated Universal Time)" — porque o
 * driver do Neon devolve Date e as rotas faziam String(...). Ver lib/datas.ts.
 */
describe('datas que saem do banco', () => {
  it('instante vira ISO, nunca o toString do Date', () => {
    const d = new Date('2026-10-05T23:58:21.000Z');
    expect(instanteIso(d)).toBe('2026-10-05T23:58:21.000Z');
    expect(instanteIso(d)).not.toMatch(/GMT|Coordinated/);
    expect(instanteIso('2026-10-05 23:58:21+00')).toBe('2026-10-05T23:58:21.000Z');
    expect(instanteIso(null)).toBe('');
    expect(instanteIso('lixo')).toBe('');
  });

  it('coluna date vira AAAA-MM-DD sem pular de dia', () => {
    // Como o driver monta: meia-noite LOCAL do dia da coluna.
    expect(dataCalendario(new Date(2026, 9, 6))).toBe('2026-10-06');
    expect(dataCalendario('2026-10-06')).toBe('2026-10-06');
    expect(dataCalendario(undefined)).toBe('');
  });

  it('a tela mostra DD/MM/AAAA', () => {
    expect(formatarDataCurta('2026-10-06')).toBe('06/10/2026');
    expect(formatarDataCurta('')).toBe('');
  });

  it('o ISO que a API devolve é o que formatRelativeTime entende', () => {
    const agora = new Date('2026-10-06T00:35:00.000Z');
    expect(formatRelativeTime(instanteIso(new Date('2026-10-05T23:58:00.000Z')), agora)).toBe('há 37 min');
  });
});
