/**
 * O velejador andando SEM PARAR no mapa, e não um deslize a cada leitura.
 *
 * O PEDIDO: "queremos ver o movimento do velejador, estilo Uber". A primeira
 * versão fez o marcador deslizar 1,2s até cada leitura nova — melhor que
 * teleportar, mas ele ainda passava ~45s congelado entre um deslize e outro.
 *
 * A DIFERENÇA ENTRE AS DUAS ABORDAGENS
 *
 * Deslizar é reagir: chegou ponto novo, anda até ele, para. Reproduzir é
 * tocar a trilha como um vídeo: o marcador avança continuamente entre os
 * pontos JÁ MEDIDOS, quadro a quadro, e nunca fica parado enquanto houver
 * trilha à frente.
 *
 * É o que o Uber faz, e o preço é o mesmo que o Uber paga: o marcador mostra
 * onde a pessoa estava há alguns segundos, não onde ela está neste
 * milissegundo. Trocamos "posição instantânea que pula" por "movimento
 * contínuo levemente atrasado" — e para quem acompanha da praia ou do carro, o
 * segundo responde muito melhor à pergunta real, que é "para onde ele está
 * indo".
 *
 * NUNCA EXTRAPOLA. Chegando ao último ponto conhecido, o marcador PARA ali.
 * Não segue no mesmo rumo inventando posição. Num app cuja razão de existir é
 * ninguém se perder na água, um marcador que continua andando sozinho depois
 * de o sinal cair apaga justamente o sinal de que algo está errado — e o
 * indicador de "sem sinal" existe para isso aparecer.
 */

import { rumoGraus } from './cinematicaTrilha';
import type { PontoTrilha } from './trilhaDownwind';

/**
 * Quanto o marcador fica atrás do tempo real.
 *
 * Uma leitura chega a cada ~45s (o beacon) e o mapa busca a cada 30s. Sem
 * atraso nenhum, o marcador chegaria ao último ponto em instantes e passaria o
 * resto do intervalo parado — voltando ao problema original. Com 50s de
 * atraso, quando ele termina de percorrer um trecho o próximo já chegou, e o
 * movimento não tem costura.
 *
 * O atraso NÃO esconde perda de sinal: o indicador de sinal e o alarme de
 * "sem sinal" continuam olhando o horário real da última posição, não este
 * relógio de reprodução.
 */
export const ATRASO_REPRODUCAO_MS = 50_000;

export interface PosicaoReproduzida {
  lat: number;
  lng: number;
  /** Graus, 0 = norte. `null` quando não há movimento de onde derivar. */
  rumoGraus: number | null;
  /** `true` quando chegou ao fim da trilha conhecida e está parado ali. */
  noFim: boolean;
}

/**
 * Onde o marcador deve estar, `decorridoMs` depois de a trilha ter chegado.
 *
 * O TEMPO É RELATIVO, E ISSO NÃO É DETALHE. Os carimbos dos pontos vêm do
 * relógio do SERVIDOR; `Date.now()` é o relógio do CELULAR. Comparar os dois
 * parecia natural e estava errado: um aparelho três minutos adiantado colocaria
 * o marcador sempre no fim da trilha (nunca anda), e um atrasado, sempre no
 * começo (mostra posição velha). Relógio de celular desacertado é comum, e o
 * defeito seria invisível em teste.
 *
 * Usando só o tempo DECORRIDO desde que a resposta chegou, o relógio absoluto
 * do aparelho deixa de importar — o único requisito é que ele conte segundos
 * no ritmo certo.
 *
 * `pontos` precisa estar em ordem cronológica — é como `mesclarTrilha` e a
 * rota de posições já devolvem.
 */
export function posicaoNoInstante(
  pontos: readonly PontoTrilha[],
  decorridoMs: number
): PosicaoReproduzida | null {
  if (pontos.length === 0) return null;

  /*
   * A âncora é o ÚLTIMO ponto recebido menos o atraso: no instante em que a
   * resposta chega, o marcador está mostrando o que aconteceu 50s antes do
   * último ponto — e caminha para a frente a partir dali.
   */
  const alvo = pontos[pontos.length - 1][2] - ATRASO_REPRODUCAO_MS + decorridoMs;
  const primeiro = pontos[0];
  const ultimo = pontos[pontos.length - 1];

  /*
   * Antes do primeiro ponto: fica no primeiro. Acontece nos segundos
   * iniciais, quando só existe uma leitura e o relógio de reprodução ainda
   * não a alcançou. Mostrar a única posição conhecida é melhor que não
   * mostrar marcador nenhum.
   */
  if (alvo <= primeiro[2]) {
    return { lat: primeiro[0], lng: primeiro[1], rumoGraus: null, noFim: pontos.length === 1 };
  }

  // Depois do último: PARA nele. Ver o bloco sobre não extrapolar acima.
  if (alvo >= ultimo[2]) {
    const anterior = pontos.length > 1 ? pontos[pontos.length - 2] : null;
    return {
      lat: ultimo[0],
      lng: ultimo[1],
      rumoGraus: anterior ? rumoEntre(anterior, ultimo) : null,
      noFim: true,
    };
  }

  // Busca binária: uma travessia de 3h com trilha reduzida tem centenas de
  // pontos, e isto roda a cada quadro, para cada participante.
  let baixo = 0;
  let alto = pontos.length - 1;
  while (alto - baixo > 1) {
    const meio = (baixo + alto) >> 1;
    if (pontos[meio][2] <= alvo) baixo = meio;
    else alto = meio;
  }

  const a = pontos[baixo];
  const b = pontos[alto];
  const intervalo = b[2] - a[2];
  // Dois pontos no mesmo milissegundo: sem divisão por zero, fica no segundo.
  const fracao = intervalo > 0 ? (alvo - a[2]) / intervalo : 1;

  return {
    lat: a[0] + (b[0] - a[0]) * fracao,
    lng: a[1] + (b[1] - a[1]) * fracao,
    rumoGraus: rumoEntre(a, b),
    noFim: false,
  };
}

function rumoEntre(a: PontoTrilha, b: PontoTrilha): number | null {
  const parado = Math.abs(b[0] - a[0]) < 1e-6 && Math.abs(b[1] - a[1]) < 1e-6;
  if (parado) return null;
  return rumoGraus({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
}
