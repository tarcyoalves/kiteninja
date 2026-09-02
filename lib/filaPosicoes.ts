/**
 * Fila de posições que não conseguiram ser enviadas.
 *
 * POR QUE ISTO EXISTE
 *
 * O beacon do downwind envia uma posição a cada 45 s e, quando o `fetch`
 * falha, o `catch` **descarta o ponto em silêncio**. Numa praia com 4G
 * oscilante — que é onde este app é usado — cada falha vira um buraco
 * permanente na trilha: some do mapa de quem acompanha em terra, some do
 * resumo da travessia, e some do registro do velejador.
 *
 * É o mesmo defeito de sempre nesta base, agora no ponto mais sensível: o
 * dado é medido corretamente e depois se perde. Aqui dói mais porque a
 * posição perdida é a de alguém que está na água.
 *
 * A rota `/posicoes` já aceita `registradoEm` — foi feita assim para o
 * serviço nativo reportar pontos coletados offline com o horário em que
 * foram coletados, não com o da rede. A fila web usa exatamente o mesmo
 * contrato.
 */

export interface PosicaoPendente {
  lat: number;
  lng: number;
  accuracyM: number | null;
  /** Quando o GPS mediu, em ms. É isto que vai em `registradoEm`. */
  registradoEmMs: number;
}

export const CHAVE_FILA_POSICOES = 'kiteninja:posicoes-pendentes';

/**
 * Teto da fila.
 *
 * 240 pontos = 3 horas de beacon a cada 45 s, que cobre uma travessia longa
 * inteira sem rede. Acima disso, os pontos MAIS ANTIGOS são descartados: o
 * servidor recusa timestamp com mais de 9 h de qualquer forma, e para quem
 * acompanha em terra a posição recente vale mais que a de três horas atrás.
 */
export const MAX_POSICOES_NA_FILA = 240;

/**
 * Quantas posições despachar de uma vez ao recuperar a rede.
 *
 * O rate limit da rota é de 120 por minuto. Vinte por rodada mantém margem
 * larga para o beacon normal continuar enviando enquanto a fila drena, e
 * evita uma rajada que o servidor recusaria — o que faria a fila nunca
 * esvaziar.
 */
export const LOTE_DE_DESPACHO = 20;

function ehPosicaoValida(p: unknown): p is PosicaoPendente {
  if (!p || typeof p !== 'object') return false;
  const c = p as Record<string, unknown>;
  return (
    typeof c.lat === 'number' &&
    Number.isFinite(c.lat) &&
    Math.abs(c.lat) <= 90 &&
    typeof c.lng === 'number' &&
    Number.isFinite(c.lng) &&
    Math.abs(c.lng) <= 180 &&
    typeof c.registradoEmMs === 'number' &&
    Number.isFinite(c.registradoEmMs) &&
    (c.accuracyM === null || (typeof c.accuracyM === 'number' && Number.isFinite(c.accuracyM)))
  );
}

/** Acrescenta uma posição, aplicando o teto pelo lado mais antigo. */
export function enfileirar(
  fila: readonly PosicaoPendente[],
  nova: PosicaoPendente
): PosicaoPendente[] {
  return [...fila, nova].slice(-MAX_POSICOES_NA_FILA);
}

/**
 * O que ainda vale a pena enviar.
 *
 * O servidor recusa timestamp com mais de 9 h (ver `validarRegistroEm` na
 * rota). Mandar um ponto vencido gasta uma requisição para receber um erro,
 * e com a fila cheia isso trava o despacho do que ainda serve. Filtrar antes
 * é mais barato que descobrir depois.
 */
export const VALIDADE_POSICAO_MS = 9 * 60 * 60 * 1000;

export function descartarVencidas(
  fila: readonly PosicaoPendente[],
  agoraMs: number
): PosicaoPendente[] {
  return fila.filter((p) => {
    const idade = agoraMs - p.registradoEmMs;
    // Vencida, ou "do futuro" (relógio do aparelho mexido) — o servidor
    // recusa as duas.
    return idade >= 0 && idade < VALIDADE_POSICAO_MS;
  });
}

/**
 * Divide a fila entre o lote a enviar agora e o que fica para depois.
 *
 * As MAIS ANTIGAS primeiro, para a trilha ser reconstruída na ordem em que
 * foi percorrida.
 */
export function proximoLote(
  fila: readonly PosicaoPendente[]
): { lote: PosicaoPendente[]; resto: PosicaoPendente[] } {
  return {
    lote: fila.slice(0, LOTE_DE_DESPACHO),
    resto: fila.slice(LOTE_DE_DESPACHO),
  };
}

export function serializarFila(fila: readonly PosicaoPendente[]): string {
  return JSON.stringify(fila);
}

/**
 * `[]` — nunca `null` — para qualquer entrada estragada. Uma fila ilegível é
 * indistinguível de uma fila vazia para quem chama, e devolver algo pela
 * metade enviaria coordenada inventada como se fosse posição real de alguém
 * na água.
 */
export function desserializarFila(bruto: string | null): PosicaoPendente[] {
  if (!bruto) return [];
  try {
    const dados = JSON.parse(bruto);
    if (!Array.isArray(dados)) return [];
    return dados.filter(ehPosicaoValida).slice(-MAX_POSICOES_NA_FILA);
  } catch {
    return [];
  }
}
