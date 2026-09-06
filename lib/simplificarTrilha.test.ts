import { describe, expect, it } from 'vitest';
import { amostrarTrilha } from './trilhaDownwind';
import type { PontoTrilha } from './trilhaDownwind';
import {
  distanciaPerpendicularM,
  simplificarPorTolerancia,
  simplificarTrilha,
} from './simplificarTrilha';

/**
 * Trilha com a FORMA de um velejo de verdade: pernadas longas e retas ligadas
 * por curvas fechadas (a jibe no fim de cada bordo).
 *
 * A primeira versão deste teste usava um arco perfeito — e ali a decimação
 * uniforme empata ou ganha, porque pontos igualmente espaçados ao longo de uma
 * curvatura constante é exatamente o que ela faz. O arco é o MELHOR caso dela,
 * e testar com ele mediria a coisa errada.
 *
 * O caso real é este: numa reta longa a decimação gasta dezenas de pontos para
 * desenhar o que dois desenham, e chega na curva sem orçamento — que é
 * precisamente o "linhas praticamente retas" do relato.
 */
function trilhaDeVelejo(): PontoTrilha[] {
  const pontos: PontoTrilha[] = [];
  let t = 0;
  const empurrar = (lat: number, lng: number) => pontos.push([lat, lng, (t += 1000)]);

  const pernadas: Array<[number, number]> = [
    [-5.0, -36.5],
    [-5.02, -36.5],
    [-5.02, -36.47],
    [-5.04, -36.47],
  ];

  for (let seg = 0; seg < pernadas.length - 1; seg++) {
    const [lat0, lng0] = pernadas[seg];
    const [lat1, lng1] = pernadas[seg + 1];
    // 60 pontos por pernada reta.
    for (let i = 0; i < 60; i++) {
      const f = i / 60;
      empurrar(lat0 + (lat1 - lat0) * f, lng0 + (lng1 - lng0) * f);
    }
    // Curva fechada de 8 pontos no fim do bordo.
    if (seg < pernadas.length - 2) {
      const [lat2, lng2] = pernadas[seg + 2];
      for (let i = 1; i <= 8; i++) {
        const f = i / 9;
        empurrar(
          lat1 + (lat2 - lat1) * f * 0.12 + 0.0012 * Math.sin(Math.PI * f),
          lng1 + (lng2 - lng1) * f * 0.12 - 0.0012 * Math.sin(Math.PI * f)
        );
      }
    }
  }
  empurrar(pernadas[pernadas.length - 1][0], pernadas[pernadas.length - 1][1]);
  return pontos;
}

/** Erro máximo, em metros, entre a trilha reduzida e a original. */
function erroMaximoM(original: PontoTrilha[], reduzida: PontoTrilha[]): number {
  let pior = 0;
  let j = 0;
  for (const p of original) {
    while (j + 2 < reduzida.length && reduzida[j + 1][2] < p[2]) j++;
    const d = distanciaPerpendicularM(p, reduzida[j], reduzida[j + 1] ?? reduzida[j]);
    if (d > pior) pior = d;
  }
  return pior;
}

describe('distanciaPerpendicularM', () => {
  it('ponto em cima da reta tem distância zero', () => {
    const a: PontoTrilha = [-5, -36.5, 0];
    const b: PontoTrilha = [-5.02, -36.5, 2];
    expect(distanciaPerpendicularM([-5.01, -36.5, 1], a, b)).toBeCloseTo(0, 3);
  });

  it('mede o desvio lateral em metros', () => {
    const a: PontoTrilha = [-5, -36.5, 0];
    const b: PontoTrilha = [-5, -36.4, 2];
    // ~0.001 grau de latitude = ~111 m de desvio da reta leste-oeste.
    expect(distanciaPerpendicularM([-5.001, -36.45, 1], a, b)).toBeGreaterThan(100);
    expect(distanciaPerpendicularM([-5.001, -36.45, 1], a, b)).toBeLessThan(120);
  });

  it('não mede até a reta infinita, e sim até o segmento', () => {
    // Sem limitar a projeção ao segmento, um ponto muito além da ponta
    // apareceria como "em cima da reta" e seria descartado por engano.
    const a: PontoTrilha = [-5, -36.5, 0];
    const b: PontoTrilha = [-5, -36.49, 1];
    expect(distanciaPerpendicularM([-5, -36.4, 2], a, b)).toBeGreaterThan(9_000);
  });

  it('reta degenerada (a = b) não divide por zero', () => {
    const a: PontoTrilha = [-5, -36.5, 0];
    expect(Number.isFinite(distanciaPerpendicularM([-5.01, -36.5, 1], a, a))).toBe(true);
  });
});

describe('simplificarTrilha vs. decimação uniforme', () => {
  const original = trilhaDeVelejo();
  const LIMITE = 20;

  it('respeita o orçamento de pontos', () => {
    expect(simplificarTrilha(original, LIMITE).length).toBeLessThanOrEqual(LIMITE);
  });

  it('É O TESTE QUE IMPORTA: a curva sobrevive onde a decimação a aplanava', () => {
    /*
     * O relato foi "as linhas estão muito retas". Com o MESMO número de
     * pontos, Douglas-Peucker precisa ficar sensivelmente mais perto do
     * traçado real do que pegar 1 a cada N.
     */
    const uniforme = amostrarTrilha([...original], LIMITE);
    const dp = simplificarTrilha(original, LIMITE);
    expect(dp.length).toBeLessThanOrEqual(uniforme.length);
    expect(erroMaximoM(original, dp)).toBeLessThan(erroMaximoM(original, uniforme));
  });

  it('mantém as pontas — a trilha encosta no marcador', () => {
    const dp = simplificarTrilha(original, LIMITE);
    expect(dp[0]).toEqual(original[0]);
    expect(dp[dp.length - 1]).toEqual(original[original.length - 1]);
  });

  it('não inventa ponto nenhum: tudo que sai foi medido pelo GPS', () => {
    // Isto NÃO é suavização. Uma trilha tremida continua tremida, porque é
    // isso que o GPS mediu.
    const dp = simplificarTrilha(original, LIMITE);
    for (const p of dp) expect(original).toContainEqual(p);
  });

  it('preserva a ordem cronológica', () => {
    const dp = simplificarTrilha(original, LIMITE);
    for (let i = 1; i < dp.length; i++) expect(dp[i][2]).toBeGreaterThan(dp[i - 1][2]);
  });
});

describe('casos de borda', () => {
  it('trilha menor que o limite volta inteira', () => {
    const curta: PontoTrilha[] = [[-5, -36.5, 0], [-5.01, -36.5, 1]];
    expect(simplificarTrilha(curta, 100)).toEqual(curta);
  });

  it('trilha vazia ou de um ponto não quebra', () => {
    expect(simplificarTrilha([], 10)).toEqual([]);
    expect(simplificarTrilha([[-5, -36.5, 0]], 10)).toHaveLength(1);
  });

  it('uma reta perfeita colapsa para duas pontas — o resto era redundante', () => {
    // O outro lado da moeda: numa reta longa a decimação uniforme gastava
    // dezenas de pontos para desenhar o que dois desenham.
    const reta: PontoTrilha[] = [];
    for (let i = 0; i <= 100; i++) reta.push([-5 + i * 0.0001, -36.5, i * 1000]);
    expect(simplificarPorTolerancia(reta, 1).length).toBe(2);
  });

  it('milhares de pontos quase colineares não estouram a pilha', () => {
    // Recursão levaria a profundidade `n` neste caso; por isso a pilha é
    // explícita.
    const muitos: PontoTrilha[] = [];
    for (let i = 0; i < 5000; i++) muitos.push([-5 + i * 1e-6, -36.5, i * 100]);
    expect(() => simplificarTrilha(muitos, 200)).not.toThrow();
  });
});

/**
 * Os DOIS orçamentos de trilha, e por que eles são diferentes.
 *
 * O que se guarda e o que se manda no feed deixaram de ser o mesmo número —
 * e é essa separação que permite a trilha ficar mais detalhada SEM custar
 * banda. Ver PONTOS_TRILHA_GUARDADOS (lib/trilhaSessao.ts) e
 * PONTOS_TRILHA_FEED (app/api/feed/route.ts).
 */
describe('orçamento de pontos: guardar denso, mandar pouco', () => {
  /** ~38 bytes por ponto em JSON — medido, não estimado. */
  const bytesDoPonto = (() => {
    const p: PontoTrilha = [-5.123456, -36.789012, 1_757_000_000_000];
    return JSON.stringify(p).length;
  })();

  it('um ponto em JSON custa cerca de 38 bytes', () => {
    // A conta de banda inteira sai daqui; se o formato mudar, os números dos
    // comentários precisam mudar junto.
    expect(bytesDoPonto).toBeGreaterThan(30);
    expect(bytesDoPonto).toBeLessThan(45);
  });

  it('a página do feed fica MENOR que antes, com a trilha 6x mais detalhada', () => {
    /*
     * Era 200 pontos guardados e 200 mandados: 15 velejos por página =
     * ~114 KB de trilha. Agora são 1200 guardados e 80 mandados: ~45 KB.
     * Mais detalhe onde se vê, menos bytes onde não se vê.
     */
    const PAGE_SIZE = 15;
    const antes = PAGE_SIZE * 200 * bytesDoPonto;
    const agora = PAGE_SIZE * 80 * bytesDoPonto;
    expect(agora).toBeLessThan(antes);
    expect(agora).toBeLessThan(60_000);
  });

  it('o que se guarda cabe folgado no armazenamento do plano livre', () => {
    // 1200 pontos por velejo, 0,5 GB de armazenamento: mais de dez mil velejos
    // só de trilha. Se alguém subir o orçamento sem refazer esta conta, o
    // teste avisa.
    const porVelejo = 1200 * bytesDoPonto;
    const velejosEmMeioGiga = 500 * 1024 * 1024 / porVelejo;
    expect(velejosEmMeioGiga).toBeGreaterThan(5_000);
  });

  it('o velejo salvo cabe com folga no corpo de uma requisição', () => {
    // Teto de corpo de requisição em função serverless é da ordem de MB; a
    // trilha de um velejo é da ordem de dezenas de KB.
    expect(1200 * bytesDoPonto).toBeLessThan(500_000);
  });
});
