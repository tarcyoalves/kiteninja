/**
 * O velejador DESLIZANDO no mapa, em vez de teleportar a cada 30 segundos.
 *
 * O RELATO: "queremos ver o movimento do velejador, estilo Uber, e não o
 * ponto estático no mapa".
 *
 * O QUE ACONTECIA: a posição chega pelo poll a cada 30s, e o marcador era
 * redesenhado direto na coordenada nova. Metade do minuto parado, um salto, e
 * de novo parado. Mesmo com o velejador a 40 km/h, a tela dizia "parado" —
 * porque o salto é instantâneo e o olho não vê movimento nenhum nele.
 *
 * O QUE ISTO É, E O QUE NÃO É
 *
 * A animação é uma TRANSIÇÃO entre duas leituras reais, não um palpite sobre
 * o caminho. O trajeto de verdade continua sendo a polilinha desenhada a
 * partir dos pontos medidos; o marcador só deixa de pular entre eles.
 *
 * E ela NUNCA extrapola. Passado o último ponto conhecido, o marcador para
 * onde a última leitura o colocou — não segue "na mesma direção" inventando
 * posição. Num app cuja razão de existir é ninguém se perder na água, um
 * marcador que continua andando sozinho depois de o sinal cair é a pior
 * mentira possível: some justamente o sinal de que algo está errado.
 */

import { rumoGraus } from './cinematicaTrilha';
import type { LatLng } from './geo';

/**
 * Duração do deslize até a leitura nova.
 *
 * 1,2s: rápido o bastante para o marcador estar sempre mostrando a posição
 * mais recente (é isso que importa quando alguém precisa de socorro), e longo
 * o bastante para o olho registrar a direção do movimento. Uber faz o mesmo —
 * o carro desliza até o fix novo, não fica interpolando um minuto atrás da
 * realidade.
 */
export const DURACAO_TWEEN_MS = 1_200;

/**
 * Salto longo demais para animar.
 *
 * Acima disso o deslize deixa de comunicar movimento e vira um objeto
 * cruzando a tela: acontece quando o app volta do segundo plano com dez
 * minutos de trilha acumulada, ou quando o GPS corrige um erro grande. Nesses
 * casos o marcador vai direto, sem animação — mostrar a posição certa importa
 * mais do que a transição ser bonita.
 */
export const SALTO_MAXIMO_ANIMAVEL_GRAUS = 0.05;

/**
 * Suavização (ease-out cúbico): começa rápido e desacelera no fim.
 *
 * Ease-out e não linear porque a chegada é o que se lê — a desaceleração diz
 * "é aqui que ele está agora". Linear pareceria uma peça arrastada por um
 * trilho.
 */
export function suavizar(fracao: number): number {
  const f = Math.min(1, Math.max(0, fracao));
  return 1 - Math.pow(1 - f, 3);
}

export function interpolar(de: LatLng, para: LatLng, fracao: number): LatLng {
  const f = suavizar(fracao);
  return {
    lat: de.lat + (para.lat - de.lat) * f,
    lng: de.lng + (para.lng - de.lng) * f,
  };
}

/**
 * O salto é curto o bastante para valer a pena animar?
 *
 * Compara em graus, não em km, de propósito: é a mesma unidade em que o
 * marcador se move na tela, e não exige uma conta de distância a cada quadro.
 */
export function vaisAnimar(de: LatLng, para: LatLng): boolean {
  return (
    Math.abs(para.lat - de.lat) <= SALTO_MAXIMO_ANIMAVEL_GRAUS &&
    Math.abs(para.lng - de.lng) <= SALTO_MAXIMO_ANIMAVEL_GRAUS
  );
}

/**
 * Para onde o marcador aponta.
 *
 * `null` quando não há movimento perceptível: um marcador apontando para um
 * rumo calculado a partir de dois pontos idênticos giraria de forma aleatória
 * com o velejador parado na praia. Sem rumo, a seta some — e "sem seta" é uma
 * informação correta.
 */
export function rumoDoMovimento(de: LatLng, para: LatLng): number | null {
  const parado =
    Math.abs(para.lat - de.lat) < 1e-6 && Math.abs(para.lng - de.lng) < 1e-6;
  if (parado) return null;
  return rumoGraus(de, para);
}
