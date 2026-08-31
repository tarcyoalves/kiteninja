import { describe, expect, it } from 'vitest';
import { dataDoEvento } from './dataEvento';

describe('dataDoEvento', () => {
  it('aceita o ISO completo que o formulário de downwind manda', () => {
    const d = dataDoEvento('2026-08-31T14:30:00.000Z');
    expect(d?.toISOString()).toBe('2026-08-31T14:30:00.000Z');
  });

  it('aceita YYYY-MM-DD do <input type="date">', () => {
    expect(dataDoEvento('2026-08-31')?.toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('aceita DD/MM/AAAA digitado à mão', () => {
    const d = dataDoEvento('31/08/2026');
    expect(d?.getUTCFullYear()).toBe(2026);
    expect(d?.getUTCMonth()).toBe(7); // agosto
    expect(d?.getUTCDate()).toBe(31);
  });

  /**
   * A razão de não existir um `new Date(texto)` como último recurso. O parser
   * do JavaScript aceita quase tudo e erra em silêncio: `new Date('01/02/2026')`
   * devolve 1º de FEVEREIRO nos motores que assumem o formato americano. A
   * data errada, com cara de certa — e alguém apareceria na praia no dia
   * errado.
   */
  it('interpreta DD/MM, nunca MM/DD', () => {
    const d = dataDoEvento('01/02/2026');
    expect(d?.getUTCDate()).toBe(1);
    expect(d?.getUTCMonth()).toBe(1); // fevereiro
  });

  /**
   * O formato que a coluna `event_date` realmente guarda hoje. Não é
   * reinterpretado de propósito: `null` manda o evento para o fim da lista
   * (NULLS LAST + created_at), que é melhor que colocá-lo na data errada.
   */
  it('devolve null para a data por extenso em português', () => {
    expect(dataDoEvento('31 de agosto de 2026')).toBeNull();
  });

  it('devolve null para vazio, nulo e lixo', () => {
    expect(dataDoEvento(null)).toBeNull();
    expect(dataDoEvento(undefined)).toBeNull();
    expect(dataDoEvento('')).toBeNull();
    expect(dataDoEvento('   ')).toBeNull();
    expect(dataDoEvento('sábado que vem')).toBeNull();
  });

  it('rejeita dia que não existe no mês em vez de rolar para o mês seguinte', () => {
    // O Date rolaria 31/02 para 3 de março e mudaria o mês em silêncio.
    expect(dataDoEvento('31/02/2026')).toBeNull();
    expect(dataDoEvento('31/04/2026')).toBeNull();
  });

  it('rejeita mês fora da faixa', () => {
    expect(dataDoEvento('01/13/2026')).toBeNull();
    expect(dataDoEvento('01/00/2026')).toBeNull();
  });

  /**
   * Uma data sem hora não pode mudar de dia por causa de fuso: gravada à
   * meia-noite UTC, ela vira o dia anterior no Brasil (UTC-3). Meio-dia UTC
   * mantém o mesmo dia em todos os fusos que o app atende.
   */
  it('data sem hora não escorrega de dia por fuso', () => {
    const d = dataDoEvento('31/08/2026');
    expect(d?.getUTCHours()).toBe(12);
    expect(dataDoEvento('2026-08-31')?.getUTCHours()).toBe(12);
  });
});
