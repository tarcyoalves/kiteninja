import { haversineKm } from './geo';

/** `[latitude, longitude, velocidade em nós, timestamp em ms]`. */
export type PontoReplay = readonly [number, number, number, number];

export interface MetricasReplay {
  distanciaKm: number;
  velocidadeMaxNos: number;
  ultimoRegistroMs: number | null;
}

/**
 * Deriva as métricas do mesmo trecho que está visível no replay.
 *
 * `downwind_participantes` só recebe distância/máxima consolidadas ao encerrar
 * alguns fluxos. Durante um ao vivo real esses campos podem estar `NULL` mesmo
 * com dezenas de posições gravadas. A trilha é a fonte contínua e já carrega o
 * timestamp e a velocidade de cada ponto, portanto não mostramos zeros falsos.
 */
export function metricasDaTrilhaReplay(
  pontos: readonly PontoReplay[],
  ateMs = Number.POSITIVE_INFINITY,
): MetricasReplay {
  let anterior: PontoReplay | null = null;
  let distanciaKm = 0;
  let velocidadeMaxNos = 0;
  let ultimoRegistroMs: number | null = null;

  for (const ponto of pontos) {
    const [lat, lng, velocidadeNos, tsMs] = ponto;
    if (!Number.isFinite(tsMs) || tsMs > ateMs) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    if (anterior) {
      distanciaKm += haversineKm(
        { lat: anterior[0], lng: anterior[1] },
        { lat, lng },
      );
    }

    if (Number.isFinite(velocidadeNos) && velocidadeNos > velocidadeMaxNos) {
      velocidadeMaxNos = velocidadeNos;
    }

    anterior = ponto;
    ultimoRegistroMs = tsMs;
  }

  return { distanciaKm, velocidadeMaxNos, ultimoRegistroMs };
}
