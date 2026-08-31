import { describe, expect, it } from 'vitest';
import { amostrarPontos, mesclarPontos, amostrarTrilha, mesclarTrilha } from './trilhaDownwind';
import type { PontoTrilha } from './trilhaDownwind';

/**
 * `amostrarPontos` e `mesclarPontos` são as versões genéricas por onde
 * `amostrarTrilha`/`mesclarTrilha` passaram a delegar. A generalização existe
 * porque o mapa ao vivo (`/api/downwind/[id]/live`) carrega pontos de QUATRO
 * elementos — `[lat, lng, velocidade, ts]`, timestamp no índice 3 — enquanto
 * `PontoTrilha` tem três.
 *
 * Sem isso, aquela rota precisaria de uma cópia da amostragem, e a regra sutil
 * de "preservar SEMPRE o ponto mais recente" existiria em dois lugares para
 * divergir num deles.
 */

type PontoLive = [number, number, number, number];
const TS = (p: PontoLive) => p[3];

function liveSerie(n: number): PontoLive[] {
  return Array.from({ length: n }, (_, i) => [1 + i / 1000, 2 + i / 1000, 10, 1000 + i] as PontoLive);
}

describe('amostrarPontos (genérico)', () => {
  it('devolve tudo quando cabe no limite', () => {
    const pts = liveSerie(5);
    expect(amostrarPontos(pts, 10, TS)).toEqual(pts);
  });

  it('respeita o teto', () => {
    expect(amostrarPontos(liveSerie(500), 50, TS).length).toBeLessThanOrEqual(51);
  });

  /**
   * A regra que não pode quebrar: o último ponto encosta no marcador da
   * pessoa. Descartá-lo faria a trilha terminar longe da bolinha, e a tela
   * sugeriria que o velejador saltou.
   */
  it('preserva SEMPRE o ponto mais recente', () => {
    const pts = liveSerie(477);
    const amostrado = amostrarPontos(pts, 40, TS);
    expect(TS(amostrado[amostrado.length - 1])).toBe(TS(pts[pts.length - 1]));
  });

  it('aguenta lista vazia', () => {
    expect(amostrarPontos([] as PontoLive[], 10, TS)).toEqual([]);
  });

  it('continua funcionando para PontoTrilha de 3 elementos via amostrarTrilha', () => {
    const pts: PontoTrilha[] = Array.from({ length: 100 }, (_, i) => [1, 2, 500 + i]);
    const r = amostrarTrilha(pts, 10);
    expect(r.length).toBeLessThanOrEqual(11);
    expect(r[r.length - 1][2]).toBe(599);
  });
});

describe('mesclarPontos (genérico)', () => {
  it('mantém o acumulado quando o delta vem vazio', () => {
    const atual = liveSerie(3);
    expect(mesclarPontos(atual, [] as PontoLive[], TS)).toBe(atual);
  });

  it('junta e ordena por timestamp', () => {
    const a: PontoLive[] = [[1, 1, 5, 300]];
    const b: PontoLive[] = [[2, 2, 5, 100], [3, 3, 5, 200]];
    expect(mesclarPontos(a, b, TS).map(TS)).toEqual([100, 200, 300]);
  });

  /**
   * O mesmo ponto pode voltar quando o cursor não avança (resposta parcial).
   * Sem dedup a trilha ganharia vértices repetidos, que o Leaflet desenha
   * como um nó visível.
   */
  it('deduplica por timestamp', () => {
    const a: PontoLive[] = [[1, 1, 5, 100]];
    const b: PontoLive[] = [[9, 9, 5, 100]];
    const r = mesclarPontos(a, b, TS);
    expect(r).toHaveLength(1);
    // O mais novo vence — é o que o delta acabou de trazer.
    expect(r[0][0]).toBe(9);
  });

  it('ao estourar o teto, descarta os MAIS ANTIGOS', () => {
    const r = mesclarPontos(liveSerie(10), liveSerie(0), TS, 5);
    // delta vazio devolve o acumulado intacto — o teto só se aplica com dados novos
    expect(r).toHaveLength(10);

    const comNovos = mesclarPontos(liveSerie(10), [[9, 9, 5, 9999]] as PontoLive[], TS, 5);
    expect(comNovos).toHaveLength(5);
    expect(TS(comNovos[comNovos.length - 1])).toBe(9999);
    expect(TS(comNovos[0])).toBeGreaterThan(1000);
  });

  it('mesclarTrilha (3 elementos) continua delegando corretamente', () => {
    const a: PontoTrilha[] = [[1, 1, 100]];
    const b: PontoTrilha[] = [[2, 2, 200]];
    expect(mesclarTrilha(a, b).map((p) => p[2])).toEqual([100, 200]);
  });
});
