import { describe, expect, it } from 'vitest';
import {
  desserializarFila,
  descartarVencidas,
  enfileirar,
  LOTE_DE_DESPACHO,
  MAX_POSICOES_NA_FILA,
  proximoLote,
  serializarFila,
  VALIDADE_POSICAO_MS,
  type PosicaoPendente,
} from './filaPosicoes';

const AGORA = 1_756_000_000_000;
const pos = (over: Partial<PosicaoPendente> = {}): PosicaoPendente => ({
  lat: -4.9,
  lng: -37.0,
  accuracyM: 12,
  registradoEmMs: AGORA,
  ...over,
});

describe('enfileirar', () => {
  it('acrescenta ao fim', () => {
    const fila = enfileirar([pos({ lat: -4.9 })], pos({ lat: -4.95 }));
    expect(fila).toHaveLength(2);
    expect(fila[1].lat).toBe(-4.95);
  });

  /**
   * Com a fila cheia, o ponto ANTIGO é o que sai. Para quem acompanha em
   * terra, saber onde a pessoa está agora vale mais que onde ela estava há
   * três horas — e o servidor recusaria o antigo de qualquer forma.
   */
  it('no teto, descarta o mais antigo e mantém o mais novo', () => {
    const cheia = Array.from({ length: MAX_POSICOES_NA_FILA }, (_, i) =>
      pos({ registradoEmMs: AGORA + i })
    );
    const fila = enfileirar(cheia, pos({ registradoEmMs: AGORA + 99999 }));
    expect(fila).toHaveLength(MAX_POSICOES_NA_FILA);
    expect(fila[fila.length - 1].registradoEmMs).toBe(AGORA + 99999);
    expect(fila[0].registradoEmMs).toBe(AGORA + 1);
  });
});

describe('descartarVencidas', () => {
  /**
   * O servidor recusa timestamp com mais de 9 h. Mandar um ponto vencido
   * gasta requisição para receber erro, e com a fila cheia isso trava o
   * despacho do que ainda serve.
   */
  it('tira o que o servidor recusaria por idade', () => {
    const fila = [
      pos({ registradoEmMs: AGORA - VALIDADE_POSICAO_MS - 1000 }),
      pos({ registradoEmMs: AGORA - 60_000 }),
    ];
    const viva = descartarVencidas(fila, AGORA);
    expect(viva).toHaveLength(1);
    expect(viva[0].registradoEmMs).toBe(AGORA - 60_000);
  });

  it('tira posição "do futuro" — relógio do aparelho mexido', () => {
    expect(descartarVencidas([pos({ registradoEmMs: AGORA + 60_000 })], AGORA)).toHaveLength(0);
  });

  it('mantém a fila inteira quando tudo é recente', () => {
    const fila = [pos({ registradoEmMs: AGORA - 1000 }), pos({ registradoEmMs: AGORA })];
    expect(descartarVencidas(fila, AGORA)).toHaveLength(2);
  });
});

describe('proximoLote', () => {
  /** Ordem cronológica: a trilha precisa ser reconstruída como foi percorrida. */
  it('manda as MAIS ANTIGAS primeiro', () => {
    const fila = [
      pos({ registradoEmMs: AGORA - 3000 }),
      pos({ registradoEmMs: AGORA - 2000 }),
      pos({ registradoEmMs: AGORA - 1000 }),
    ];
    expect(proximoLote(fila).lote[0].registradoEmMs).toBe(AGORA - 3000);
  });

  /**
   * O rate limit da rota é 120/min. Um lote menor deixa margem para o beacon
   * normal continuar enviando enquanto a fila drena — sem isso, a rajada
   * seria recusada e a fila nunca esvaziaria.
   */
  it('respeita o tamanho do lote e devolve o resto', () => {
    const fila = Array.from({ length: LOTE_DE_DESPACHO + 7 }, () => pos());
    const { lote, resto } = proximoLote(fila);
    expect(lote).toHaveLength(LOTE_DE_DESPACHO);
    expect(resto).toHaveLength(7);
    expect(LOTE_DE_DESPACHO).toBeLessThan(120);
  });

  it('fila menor que o lote sai inteira', () => {
    const { lote, resto } = proximoLote([pos(), pos()]);
    expect(lote).toHaveLength(2);
    expect(resto).toHaveLength(0);
  });
});

describe('ida e volta pelo storage', () => {
  it('preserva as posições', () => {
    const fila = [pos({ lat: -4.91 }), pos({ lat: -4.92, accuracyM: null })];
    expect(desserializarFila(serializarFila(fila))).toEqual(fila);
  });

  /**
   * Fila estragada vira fila VAZIA, nunca algo pela metade: coordenada
   * inventada seria enviada como posição real de alguém na água.
   */
  it('entrada estragada vira fila vazia', () => {
    expect(desserializarFila(null)).toEqual([]);
    expect(desserializarFila('{quebrado')).toEqual([]);
    expect(desserializarFila('{"nao":"array"}')).toEqual([]);
  });

  it('descarta item com coordenada impossível, mantendo os válidos', () => {
    const bruto = JSON.stringify([
      { lat: 999, lng: -37, accuracyM: 1, registradoEmMs: AGORA },
      pos({ lat: -4.9 }),
    ]);
    const fila = desserializarFila(bruto);
    expect(fila).toHaveLength(1);
    expect(fila[0].lat).toBe(-4.9);
  });

  it('arquivo adulterado respeita o teto', () => {
    const muitos = Array.from({ length: MAX_POSICOES_NA_FILA + 50 }, () => pos());
    expect(desserializarFila(JSON.stringify(muitos))).toHaveLength(MAX_POSICOES_NA_FILA);
  });
});
