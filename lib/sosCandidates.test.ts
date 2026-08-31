import { describe, expect, it, vi } from 'vitest';

// As consultas de `sosCandidates` importam `server-only` e o driver da Neon.
// O que está sob teste aqui é só a decisão pura de mesclagem — o resto do
// módulo é exercido contra Postgres de verdade em scripts/verify-sos.ts.
vi.mock('server-only', () => ({}));
vi.mock('./db', () => ({ sql: vi.fn() }));

const { mesclarCamadas } = await import('./sosCandidates');
import type { CandidatoSos } from './sosCandidates';

const doDownwind = (id: string): CandidatoSos => ({ userId: id, dist: null, motivo: 'downwind' });
const porPerto = (id: string, dist: number): CandidatoSos => ({ userId: id, dist, motivo: 'proximidade' });
const moderador = (id: string): CandidatoSos => ({ userId: id, dist: null, motivo: 'moderador' });

describe('mesclarCamadas', () => {
  it('junta camadas distintas sem perder ninguém', () => {
    const r = mesclarCamadas([[doDownwind('a')], [porPerto('b', 2)]]);
    expect(r.map((c) => c.userId).sort()).toEqual(['a', 'b']);
  });

  /**
   * O caso que motivou a função. Quem está no downwind E por perto recebia
   * dois pushes; e se a ordem do dedupe fosse a errada, o push que chegava
   * dizia "alguém a 2 km" em vez de "é do seu downwind" — a informação que
   * faz o socorrista largar o que está fazendo.
   */
  it('mantém o motivo da camada de MAIOR prioridade e não repete a pessoa', () => {
    const r = mesclarCamadas([[doDownwind('a')], [porPerto('a', 2)]]);
    expect(r).toHaveLength(1);
    expect(r[0].motivo).toBe('downwind');
  });

  it('a prioridade é a ordem dos argumentos, não o tipo do motivo', () => {
    const r = mesclarCamadas([[porPerto('a', 2)], [doDownwind('a')]]);
    expect(r[0].motivo).toBe('proximidade');
  });

  /**
   * Memória da escalada: quem já foi chamado no raio de 5 km não pode ser
   * chamado de novo aos 15 km. Sem isto, cada degrau da escalada reenviaria
   * o push para todo mundo que já tinha sido avisado.
   */
  it('exclui quem já foi notificado numa rodada anterior', () => {
    const r = mesclarCamadas([[doDownwind('a'), doDownwind('b')]], new Set(['a']));
    expect(r.map((c) => c.userId)).toEqual(['b']);
  });

  it('não deixa `jaNotificados` escapar por uma camada posterior', () => {
    const r = mesclarCamadas([[doDownwind('a')], [moderador('a')]], new Set(['a']));
    expect(r).toEqual([]);
  });

  it('devolve lista vazia quando não há camada nenhuma', () => {
    expect(mesclarCamadas([])).toEqual([]);
    expect(mesclarCamadas([[], []])).toEqual([]);
  });

  it('preserva a distância medida — é o que a UI mostra ao socorrista', () => {
    const r = mesclarCamadas([[porPerto('a', 3.5)]]);
    expect(r[0].dist).toBe(3.5);
  });
});
