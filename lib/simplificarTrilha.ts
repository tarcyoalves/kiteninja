/**
 * Reduzir a trilha SEM aplanar as curvas.
 *
 * O RELATO: "as linhas dos trajetos estão muito retas, preciso que mostrem a
 * realidade do GPS, com as curvas reais".
 *
 * A CAUSA: toda redução de trilha do app usava decimação uniforme — guardar 1
 * ponto a cada N, contando índices. Isso ignora o FORMATO do percurso, e o
 * efeito numa curva é o pior possível: os pontos que definem a curvatura são
 * descartados junto com todos os outros, e sobram dois pontos distantes ligados
 * por uma reta. Numa reta longa acontece o contrário — dezenas de pontos
 * redundantes são preservados para desenhar o que uma linha de dois pontos já
 * desenharia.
 *
 * Ou seja: o orçamento de pontos era gasto exatamente ao contrário do que
 * deveria.
 *
 * A SOLUÇÃO: Douglas-Peucker. Ele pergunta, para cada ponto, "se eu te
 * apagar, o traço muda de forma?" — mantém quem responde sim e descarta quem
 * responde não. Com o MESMO número de pontos, as curvas ficam curvas e as
 * retas param de gastar orçamento.
 *
 * O QUE ISTO NÃO É: suavização. Nada é inventado nem arredondado — todos os
 * pontos devolvidos são leituras reais do GPS, nas coordenadas em que foram
 * medidas. Uma trilha tremida continua tremida, porque é isso que o GPS mediu
 * e é isso que o velejador quer ver.
 */

import type { PontoTrilha } from './trilhaDownwind';

/** Raio médio da Terra, em metros. */
const R_TERRA_M = 6_371_000;

/**
 * Distância do ponto `p` até a reta `a`-`b`, em metros.
 *
 * Projeção equirretangular local: para as dezenas de quilômetros de uma
 * travessia, o erro é muito menor que a precisão do próprio GPS, e evita
 * trigonometria pesada num laço que roda milhares de vezes.
 */
export function distanciaPerpendicularM(
  p: PontoTrilha,
  a: PontoTrilha,
  b: PontoTrilha
): number {
  const rad = Math.PI / 180;
  const cosLat = Math.cos(a[0] * rad);
  const px = (p[1] - a[1]) * rad * cosLat * R_TERRA_M;
  const py = (p[0] - a[0]) * rad * R_TERRA_M;
  const bx = (b[1] - a[1]) * rad * cosLat * R_TERRA_M;
  const by = (b[0] - a[0]) * rad * R_TERRA_M;

  const compAoQuadrado = bx * bx + by * by;
  // `a` e `b` no mesmo lugar: a "reta" é um ponto, então a distância é até ele.
  if (compAoQuadrado === 0) return Math.hypot(px, py);

  // Projeção escalar limitada ao segmento — sem o clamp, um ponto além das
  // pontas mediria a distância até a reta infinita, e não até o traço.
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / compAoQuadrado));
  return Math.hypot(px - bx * t, py - by * t);
}

/**
 * Douglas-Peucker com pilha explícita.
 *
 * Iterativo e não recursivo de propósito: uma trilha de milhares de pontos
 * quase colineares leva a recursão à profundidade `n`, e cinco mil quadros de
 * pilha estouram no navegador do celular — justamente no aparelho que precisa
 * aguentar.
 */
export function simplificarPorTolerancia(
  pontos: readonly PontoTrilha[],
  toleranciaM: number
): PontoTrilha[] {
  if (pontos.length <= 2) return [...pontos];

  const manter = new Uint8Array(pontos.length);
  manter[0] = 1;
  manter[pontos.length - 1] = 1;

  const pilha: Array<[number, number]> = [[0, pontos.length - 1]];
  while (pilha.length > 0) {
    const [inicio, fim] = pilha.pop()!;
    let maior = -1;
    let indiceMaior = -1;
    for (let i = inicio + 1; i < fim; i++) {
      const d = distanciaPerpendicularM(pontos[i], pontos[inicio], pontos[fim]);
      if (d > maior) {
        maior = d;
        indiceMaior = i;
      }
    }
    if (indiceMaior !== -1 && maior > toleranciaM) {
      manter[indiceMaior] = 1;
      pilha.push([inicio, indiceMaior], [indiceMaior, fim]);
    }
  }

  const saida: PontoTrilha[] = [];
  for (let i = 0; i < pontos.length; i++) if (manter[i]) saida.push(pontos[i]);
  return saida;
}

/**
 * Tolerância máxima considerada, em metros.
 *
 * Acima disso a trilha vira duas ou três retas — e, se nem essa tolerância
 * couber no orçamento, o problema é o orçamento, não a busca.
 */
const TOLERANCIA_MAXIMA_M = 2_000;

/** Precisão da busca. Meio metro está muito abaixo do erro do próprio GPS. */
const PRECISAO_BUSCA_M = 0.5;

/**
 * Reduz a trilha a no máximo `limite` pontos, preservando o formato.
 *
 * Douglas-Peucker trabalha com uma TOLERÂNCIA (quantos metros de desvio podem
 * ser perdidos), não com uma contagem. Como o que temos é um orçamento de
 * pontos, a tolerância é encontrada por busca binária: a menor que ainda cabe
 * no limite — ou seja, a trilha mais fiel que o orçamento permite.
 *
 * O primeiro e o último ponto sempre sobrevivem, por construção do algoritmo.
 * Isso preserva a regra que a decimação antiga garantia à mão: o fim da trilha
 * encosta no marcador da pessoa, em vez de terminar a quilômetros dele.
 */
export function simplificarTrilha(
  pontos: readonly PontoTrilha[],
  limite: number
): PontoTrilha[] {
  if (pontos.length <= limite || pontos.length <= 2) return [...pontos];

  // Tolerância zero devolve tudo; se já couber, é a resposta mais fiel possível.
  let baixo = 0;
  let alto = TOLERANCIA_MAXIMA_M;
  let melhor = simplificarPorTolerancia(pontos, alto);

  while (alto - baixo > PRECISAO_BUSCA_M) {
    const meio = (baixo + alto) / 2;
    const tentativa = simplificarPorTolerancia(pontos, meio);
    if (tentativa.length <= limite) {
      melhor = tentativa;
      alto = meio;
    } else {
      baixo = meio;
    }
  }

  return melhor;
}
