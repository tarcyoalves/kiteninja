import { describe, expect, it } from 'vitest';
import {
  ehDownwindAbandonado,
  HORAS_SILENCIO_PARA_ABANDONO,
  instanteDeEncerramento,
} from './downwindAbandono';

const H = 3_600_000;
const inicio = new Date('2026-08-31T12:10:00.000Z');
const emHoras = (h: number) => new Date(inicio.getTime() + h * H);

describe('ehDownwindAbandonado', () => {
  /**
   * O caso real que motivou o módulo: o downwind "Pernambuquinho x fortaleza"
   * iniciado em 31/08 12:10 UTC, ainda `em_andamento` 36 horas depois. Sem
   * encerramento não há `resumirEPurgar`, e sem ele a travessia não fica
   * registrada em lugar nenhum.
   */
  it('36 horas de silêncio é abandono', () => {
    expect(
      ehDownwindAbandonado({ iniciadoEm: inicio, ultimaPosicaoEm: emHoras(1) }, emHoras(36))
    ).toBe(true);
  });

  it('travessia em curso, reportando, NÃO é abandono', () => {
    expect(
      ehDownwindAbandonado({ iniciadoEm: inicio, ultimaPosicaoEm: emHoras(2.9) }, emHoras(3))
    ).toBe(false);
  });

  /**
   * A trava que mais importa. O rastreio em segundo plano no Android é a
   * parte frágil deste app: quem está na água pode simplesmente perder o
   * beacon por um tempo. Encerrar cedo demais apagaria do mapa alguém que
   * talvez precise de socorro — o erro mais caro possível aqui.
   */
  it('silêncio de 5h ainda NÃO encerra — margem para beacon que caiu', () => {
    expect(HORAS_SILENCIO_PARA_ABANDONO).toBeGreaterThanOrEqual(6);
    expect(
      ehDownwindAbandonado({ iniciadoEm: inicio, ultimaPosicaoEm: emHoras(1) }, emHoras(6))
    ).toBe(false);
  });

  it('exatamente no limiar, encerra', () => {
    expect(
      ehDownwindAbandonado({ iniciadoEm: inicio, ultimaPosicaoEm: inicio }, emHoras(6))
    ).toBe(true);
  });

  /**
   * Downwind iniciado que nunca recebeu um ponto sequer: também é abandono
   * depois do prazo, contado do início. Não há travessia para registrar, e
   * deixá-lo aberto para sempre é pior.
   */
  it('sem posição nenhuma, conta do início', () => {
    const semPosicao = { iniciadoEm: inicio, ultimaPosicaoEm: null };
    expect(ehDownwindAbandonado(semPosicao, emHoras(3))).toBe(false);
    expect(ehDownwindAbandonado(semPosicao, emHoras(7))).toBe(true);
  });

  /**
   * Relógio do aparelho errado: uma posição com timestamp ANTERIOR ao início
   * não pode fazer o silêncio parecer maior e encerrar a travessia de quem
   * acabou de entrar na água.
   */
  it('posição anterior ao início não antecipa o encerramento', () => {
    const relogioErrado = {
      iniciadoEm: inicio,
      ultimaPosicaoEm: new Date(inicio.getTime() - 50 * H),
    };
    expect(ehDownwindAbandonado(relogioErrado, emHoras(1))).toBe(false);
  });
});

describe('instanteDeEncerramento', () => {
  /**
   * A razão de a função existir. O cron pode passar por ali horas depois;
   * carimbar `NOW()` faria a travessia parecer ter durado 36 horas no resumo
   * e no histórico do velejador.
   */
  it('usa a última posição, não a hora da varredura', () => {
    const fim = emHoras(2.5);
    expect(
      instanteDeEncerramento({ iniciadoEm: inicio, ultimaPosicaoEm: fim }).toISOString()
    ).toBe(fim.toISOString());
  });

  it('sem posição, cai no início — duração zero é honesto', () => {
    expect(
      instanteDeEncerramento({ iniciadoEm: inicio, ultimaPosicaoEm: null }).toISOString()
    ).toBe(inicio.toISOString());
  });

  it('nunca devolve instante anterior ao início', () => {
    const antes = new Date(inicio.getTime() - 10 * H);
    expect(
      instanteDeEncerramento({ iniciadoEm: inicio, ultimaPosicaoEm: antes }).getTime()
    ).toBe(inicio.getTime());
  });
});
