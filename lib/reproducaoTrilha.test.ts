import { describe, expect, it } from 'vitest';
import { ATRASO_REPRODUCAO_MS, posicaoNoInstante } from './reproducaoTrilha';
import type { PontoTrilha } from './trilhaDownwind';

/** t=0 é o primeiro ponto; os demais em segundos a partir dele. */
const T0 = 1_757_000_000_000;
const p = (lat: number, lng: number, seg: number): PontoTrilha => [lat, lng, T0 + seg * 1000];

/**
 * Tempo decorrido desde a chegada da resposta para a reprodução estar
 * mostrando o segundo `seg` da trilha. Depende do último ponto, que é a
 * âncora — ver o comentário de `posicaoNoInstante`.
 */
const decorridoPara = (ultimoSeg: number, seg: number) =>
  ATRASO_REPRODUCAO_MS - (ultimoSeg - seg) * 1000;

describe('posicaoNoInstante', () => {
  const trilha = [p(-5.0, -36.5, 0), p(-5.01, -36.5, 60), p(-5.02, -36.5, 120)];
  /** O último ponto desta trilha está em t=120s. */
  const emT = (seg: number) => decorridoPara(120, seg);

  it('sem pontos não inventa marcador', () => {
    expect(posicaoNoInstante([], 0)).toBeNull();
  });

  it('anda CONTINUAMENTE entre duas leituras — é o ponto de tudo isto', () => {
    /*
     * O defeito original: o marcador ficava ~45s congelado entre leituras.
     * Aqui, dois instantes diferentes DENTRO do mesmo trecho devolvem posições
     * diferentes. Se isto falhar, o marcador voltou a ficar parado.
     */
    const a = posicaoNoInstante(trilha, emT(10))!;
    const b = posicaoNoInstante(trilha, emT(11))!;
    expect(a.lat).not.toBe(b.lat);
    // Indo para o sul: a latitude diminui com o tempo.
    expect(b.lat).toBeLessThan(a.lat);
  });

  it('no meio do primeiro trecho está no meio do caminho', () => {
    const meio = posicaoNoInstante(trilha, emT(30))!;
    expect(meio.lat).toBeCloseTo(-5.005, 5);
    expect(meio.noFim).toBe(false);
  });

  it('atravessa o segundo trecho usando o par certo de pontos', () => {
    // Busca binária: se o par errado fosse escolhido, a posição saltaria.
    const meio = posicaoNoInstante(trilha, emT(90))!;
    expect(meio.lat).toBeCloseTo(-5.015, 5);
  });

  it('PARA no último ponto — nunca extrapola', () => {
    /*
     * A regra mais importante do arquivo. Um marcador que segue andando
     * sozinho depois de o sinal cair apaga justamente o sinal de que algo está
     * errado — e alguém pode estar precisando de socorro.
     */
    const muitoDepois = posicaoNoInstante(trilha, emT(600))!;
    expect(muitoDepois.lat).toBe(-5.02);
    expect(muitoDepois.noFim).toBe(true);
  });

  it('antes do primeiro ponto fica no primeiro, sem sumir do mapa', () => {
    const antes = posicaoNoInstante(trilha, emT(-10))!;
    expect(antes.lat).toBe(-5.0);
  });

  it('com um ponto só, mostra ele e marca que está no fim', () => {
    const unico = posicaoNoInstante([p(-5.0, -36.5, 0)], emT(10))!;
    expect(unico.lat).toBe(-5.0);
    expect(unico.noFim).toBe(true);
  });

  it('aponta o rumo do trecho que está percorrendo', () => {
    // Sul = 180 graus.
    expect(posicaoNoInstante(trilha, emT(30))!.rumoGraus).toBeCloseTo(180, 0);
  });

  it('parado n\'água não gira a seta', () => {
    const parado = [p(-5.0, -36.5, 0), p(-5.0, -36.5, 60)];
    expect(posicaoNoInstante(parado, decorridoPara(60, 30))!.rumoGraus).toBeNull();
  });

  it('dois pontos no mesmo milissegundo não dividem por zero', () => {
    const colados: PontoTrilha[] = [p(-5.0, -36.5, 0), [-5.01, -36.5, T0]];
    const r = posicaoNoInstante(colados, decorridoPara(0, 0));
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.lat)).toBe(true);
  });
});

describe('atraso de reprodução', () => {
  it('é maior que o intervalo entre leituras, senão o marcador volta a parar', () => {
    // O beacon manda a cada 45s. Com atraso menor que isso, o marcador chega
    // ao último ponto e fica esperando — exatamente o defeito original.
    expect(ATRASO_REPRODUCAO_MS).toBeGreaterThanOrEqual(45_000);
  });
});

describe('relógio do celular desacertado', () => {
  const trilha = [p(-5.0, -36.5, 0), p(-5.01, -36.5, 60)];

  it('não afeta a reprodução — o tempo é relativo, não absoluto', () => {
    /*
     * Os carimbos vêm do servidor; `Date.now()` é o relógio do aparelho.
     * Comparar os dois colocaria um celular adiantado sempre no fim da trilha
     * e um atrasado sempre no começo. Aqui a função nem vê relógio absoluto:
     * o mesmo tempo decorrido dá o mesmo resultado, com qualquer T0.
     */
    const outraEpoca = [
      p(-5.0, -36.5, 0),
      p(-5.01, -36.5, 60),
    ].map((pt) => [pt[0], pt[1], pt[2] + 86_400_000] as PontoTrilha);

    const a = posicaoNoInstante(trilha, 20_000)!;
    const b = posicaoNoInstante(outraEpoca, 20_000)!;
    expect(a.lat).toBeCloseTo(b.lat, 10);
    expect(a.lng).toBeCloseTo(b.lng, 10);
  });
});
