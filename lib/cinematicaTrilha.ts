import { haversineKm, type LatLng } from './geo';

/**
 * Velocidade e rumo derivados da TRILHA, não lidos do banco.
 *
 * POR QUE DERIVAR
 *
 * A rota do mapa ao vivo lia `velocidade_nos`, `direcao_graus` e
 * `bateria_pct` de `downwind_posicoes`. Nenhuma dessas colunas existe — a
 * tabela guarda `lat`, `lng`, `accuracy_m` e `registrado_em`, e é só isso que
 * o beacon do celular envia. A consulta falhava sempre, e como era a primeira
 * da rota, o mapa ao vivo devolvia 500 para todo mundo, o tempo todo.
 *
 * Guardar velocidade e rumo no banco também seria redundante: os dois são
 * função exata de duas posições consecutivas. Derivar mantém uma única fonte
 * de verdade e não exige mudar o que o celular manda.
 *
 * `bateria_pct` não é derivável e simplesmente não é coletada — some da
 * resposta em vez de virar um zero que a tela mostraria como "bateria 0%".
 */

const MS_POR_HORA = 3_600_000;
const KM_POR_NO = 1.852;

/**
 * Intervalo mínimo entre dois pontos para a velocidade significar algo.
 *
 * Abaixo disso o erro do GPS domina a conta: dois fixes a 1 s de distância
 * com 10 m de incerteza cada dão "36 km/h" com o celular parado na areia.
 * Pontos assim herdam a velocidade do ponto anterior em vez de inventar um
 * pico.
 */
export const MIN_DELTA_MS = 3_000;

/**
 * Teto de sanidade, em nós. Kitesurf de velocidade máxima registrado passa
 * pouco de 55 nós; qualquer coisa acima disso num app de travessia é salto de
 * GPS (túnel, reflexo em prédio, fix perdido e recuperado longe), não
 * velejador. Cortar aqui evita que UM ponto ruim vire o "velocidade máxima"
 * da sessão inteira no resumo.
 */
export const MAX_NOS_PLAUSIVEL = 60;

export interface PontoBruto extends LatLng {
  /** Milissegundos desde a época. */
  tsMs: number;
}

export interface PontoCinematica {
  /** Nós. 0 no primeiro ponto — não há de onde derivar. */
  velocidadeNos: number;
  /** Graus, 0 = norte, sentido horário. `null` no primeiro ponto. */
  rumoGraus: number | null;
}

/**
 * Rumo de `a` para `b` em graus (0 = norte, horário).
 *
 * Fórmula do rumo inicial ortodrômico. Para as distâncias de um downwind
 * (dezenas de km) a diferença para o rumo loxodrômico é irrelevante, mas esta
 * é a que casa com a distância que `haversineKm` devolve.
 */
export function rumoGraus(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const dLng = (b.lng - a.lng) * rad;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (Math.atan2(y, x) / rad + 360) % 360;
}

/**
 * Percorre a trilha de UM participante, em ordem cronológica, e devolve a
 * cinemática de cada ponto. O array de saída tem o mesmo comprimento e a
 * mesma ordem da entrada.
 */
export function derivarCinematica(pontos: readonly PontoBruto[]): PontoCinematica[] {
  const saida: PontoCinematica[] = [];
  let ultimaVelocidade = 0;

  for (let i = 0; i < pontos.length; i++) {
    if (i === 0) {
      saida.push({ velocidadeNos: 0, rumoGraus: null });
      continue;
    }

    const anterior = pontos[i - 1];
    const atual = pontos[i];
    const dtMs = atual.tsMs - anterior.tsMs;

    // Relógio andando para trás (fuso do aparelho, reordenação): não dá para
    // derivar nada. Mantém a última velocidade conhecida.
    if (!(dtMs >= MIN_DELTA_MS)) {
      saida.push({ velocidadeNos: ultimaVelocidade, rumoGraus: rumoGraus(anterior, atual) });
      continue;
    }

    const km = haversineKm(anterior, atual);
    const nos = (km / KM_POR_NO) * (MS_POR_HORA / dtMs);
    const velocidadeNos = nos > MAX_NOS_PLAUSIVEL ? ultimaVelocidade : nos;
    ultimaVelocidade = velocidadeNos;

    saida.push({ velocidadeNos, rumoGraus: rumoGraus(anterior, atual) });
  }

  return saida;
}

export interface ResumoTrilha {
  /** Soma das distâncias entre pontos consecutivos, em km. */
  distanciaKm: number;
  /** Maior velocidade derivada plausível, em nós. */
  velocidadeMaxNos: number;
}

/**
 * Distância percorrida e velocidade máxima de um participante.
 *
 * A distância soma TODOS os trechos, inclusive os curtos demais para virar
 * velocidade: a soma não é sensível ao ruído do jeito que a divisão por um
 * `dt` minúsculo é, e ignorar trechos curtos subestimaria a travessia.
 */
export function resumirTrilha(pontos: readonly PontoBruto[]): ResumoTrilha {
  if (pontos.length < 2) return { distanciaKm: 0, velocidadeMaxNos: 0 };

  let distanciaKm = 0;
  for (let i = 1; i < pontos.length; i++) {
    distanciaKm += haversineKm(pontos[i - 1], pontos[i]);
  }

  const velocidadeMaxNos = derivarCinematica(pontos).reduce(
    (max, p) => (p.velocidadeNos > max ? p.velocidadeNos : max),
    0
  );

  return { distanciaKm, velocidadeMaxNos };
}
