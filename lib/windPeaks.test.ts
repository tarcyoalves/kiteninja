import { describe, it, expect } from 'vitest';
import type { WindForecastHour } from '@/types';
import {
  LIMIAR_FORTE,
  ehPico,
  encontrarJanelasDePico,
  melhorJanela,
  indiceDoPicoMaximo,
  resumoDePico,
} from './windPeaks';

/**
 * Constrói uma hora de previsão completa. Preencher o tipo inteiro em vez de
 * forçar um cast garante que, se WindForecastHour ganhar um campo que o módulo
 * passe a ler, o typecheck avise aqui.
 */
function h(hour: string, knots: number, gust = knots + 4): WindForecastHour {
  return {
    hour,
    knots,
    gustKnots: gust,
    directionDeg: 90,
    directionText: 'E',
    conditionIcon: 'sun',
    temperature: 29,
    pressureHpa: 1013,
    waveHeightM: 1.1,
    wavePeriodS: 7,
    waveDirDeg: 95,
    tideTrend: 'up',
    tideHeightM: 1.4,
  };
}

describe('ehPico', () => {
  it('marca a partir de 22 nós, onde começa "Forte"', () => {
    expect(ehPico(h('12:00', 21))).toBe(false);
    expect(ehPico(h('12:00', 22))).toBe(true);
    expect(ehPico(h('12:00', 34))).toBe(true);
  });

  it('usa vento sustentado, não rajada', () => {
    // Rajada de 30 num vento de 14 não é pico: não define a sessão.
    expect(ehPico(h('12:00', 14, 30))).toBe(false);
  });

  it('ignora valores inválidos em vez de quebrar', () => {
    expect(ehPico(h('12:00', NaN))).toBe(false);
    expect(ehPico(undefined as unknown as WindForecastHour)).toBe(false);
  });
});

describe('encontrarJanelasDePico', () => {
  it('agrupa horas fortes consecutivas numa janela só', () => {
    const janelas = encontrarJanelasDePico([
      h('00:00', 10),
      h('03:00', 12),
      h('06:00', 24),
      h('09:00', 27),
      h('12:00', 25),
      h('15:00', 14),
    ]);
    expect(janelas).toHaveLength(1);
    expect(janelas[0].faixaHoraria).toBe('06h–12h');
    expect(janelas[0].picoKnots).toBe(27);
    expect(janelas[0].horaPico).toBe('09h');
  });

  it('separa janelas quando o vento cai no meio', () => {
    const janelas = encontrarJanelasDePico([
      h('00:00', 26),
      h('03:00', 12),
      h('06:00', 23),
      h('09:00', 24),
    ]);
    expect(janelas).toHaveLength(2);
    expect(janelas[0].faixaHoraria).toBe('00h');
    expect(janelas[1].faixaHoraria).toBe('06h–09h');
  });

  it('rotula janela de uma hora sem intervalo', () => {
    const janelas = encontrarJanelasDePico([h('15:00', 25)]);
    expect(janelas[0].faixaHoraria).toBe('15h');
  });

  it('classifica a faixa pelo pico', () => {
    const [janela] = encontrarJanelasDePico([h('12:00', 33)]);
    expect(janela.faixa).toBe('Perigoso');
  });

  it('dia fraco não gera janela nenhuma', () => {
    expect(encontrarJanelasDePico([h('00:00', 8), h('03:00', 15)])).toEqual([]);
  });

  it('aceita lista vazia, nula e indefinida', () => {
    expect(encontrarJanelasDePico([])).toEqual([]);
    expect(encontrarJanelasDePico(null)).toEqual([]);
    expect(encontrarJanelasDePico(undefined)).toEqual([]);
  });

  it('janela que vai até o fim do dia é fechada', () => {
    // Regressão: esquecer o fechar() final descartaria a última janela.
    const janelas = encontrarJanelasDePico([h('18:00', 12), h('21:00', 28)]);
    expect(janelas).toHaveLength(1);
    expect(janelas[0].faixaHoraria).toBe('21h');
  });
});

describe('melhorJanela', () => {
  it('escolhe a de maior pico, não a mais longa', () => {
    const j = melhorJanela([
      h('00:00', 23),
      h('03:00', 23),
      h('06:00', 23),
      h('09:00', 12),
      h('12:00', 29),
    ]);
    expect(j?.faixaHoraria).toBe('12h');
    expect(j?.picoKnots).toBe(29);
  });

  it('empate no pico vai para a janela mais longa', () => {
    const j = melhorJanela([
      h('00:00', 26),
      h('03:00', 12),
      h('06:00', 26),
      h('09:00', 26),
    ]);
    expect(j?.faixaHoraria).toBe('06h–09h');
  });

  it('empate em pico e duração vai para a mais cedo', () => {
    const j = melhorJanela([h('00:00', 25), h('03:00', 12), h('06:00', 25)]);
    expect(j?.faixaHoraria).toBe('00h');
  });

  it('sem vento forte devolve null', () => {
    expect(melhorJanela([h('00:00', 10)])).toBeNull();
  });
});

describe('indiceDoPicoMaximo', () => {
  it('acha a hora mais ventada mesmo abaixo do limiar', () => {
    expect(indiceDoPicoMaximo([h('00:00', 9), h('03:00', 17), h('06:00', 11)])).toBe(1);
  });

  it('devolve -1 para lista vazia', () => {
    expect(indiceDoPicoMaximo([])).toBe(-1);
    expect(indiceDoPicoMaximo(null)).toBe(-1);
  });

  it('primeiro máximo vence em empate, para não pular a linha', () => {
    expect(indiceDoPicoMaximo([h('00:00', 20), h('03:00', 20)])).toBe(0);
  });
});

describe('resumoDePico', () => {
  it('monta o texto do topo do modal', () => {
    expect(resumoDePico([h('12:00', 24), h('15:00', 27.4)])).toBe('12h–15h · pico 27 nós');
  });

  it('devolve null quando não vale a pena montar kite', () => {
    expect(resumoDePico([h('12:00', 11)])).toBeNull();
  });
});

describe('limiar', () => {
  it('LIMIAR_FORTE casa com o início da faixa Forte da escala', () => {
    expect(LIMIAR_FORTE).toBe(22);
  });

  it('aceita limiar customizado', () => {
    expect(ehPico(h('12:00', 18), 15)).toBe(true);
    expect(encontrarJanelasDePico([h('12:00', 18)], 15)).toHaveLength(1);
  });
});
