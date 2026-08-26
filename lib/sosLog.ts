/**
 * Log estruturado do caminho de vida (SOS).
 *
 * Motivo (P1-3 da auditoria de 2026-08-23): o projeto não tem nenhuma
 * ferramenta de observabilidade instalada e o tratamento de erro é um
 * `console.error` genérico. Consequência concreta: **se um SOS falhar em
 * produção, ninguém fica sabendo**.
 *
 * Isto não substitui APM — é o mínimo para que a linha do tempo de uma
 * emergência seja reconstruível a partir dos logs da Vercel, sem adicionar
 * dependência nem serviço pago (o dono do produto pediu para ser avisado antes
 * de qualquer custo novo).
 *
 * O que NUNCA entra aqui, por decisão explícita:
 *   - senha, token, secret, chave VAPID;
 *   - conteúdo de mensagem privada;
 *   - **coordenada exata**. Um log é copiado, exportado e lido por gente que
 *     não precisa saber onde o velejador estava. Registramos a PRECISÃO e a
 *     presença/ausência de GPS, nunca lat/lng. Para depurar "o candidato certo
 *     foi escolhido?" o que importa é a distância e a contagem, não o ponto.
 *
 * `userId` sai truncado em 8 caracteres: suficiente para correlacionar as
 * etapas de um mesmo socorro, curto demais para virar identificador
 * distribuído em log.
 */

export type EtapaSos =
  | 'criado'
  | 'criado.duplicata_evitada'
  | 'criado.sem_gps'
  | 'candidatos'
  | 'push.enviado'
  | 'push.falhou'
  | 'escalada'
  | 'escalada.sem_gatilho'
  | 'respond.ok'
  | 'respond.negado'
  | 'respond.event_db_falhou'
  | 'respond.push_falhou'
  | 'encerrado'
  | 'erro';

export interface EventoSos {
  etapa: EtapaSos;
  sosId?: string;
  userId?: string;
  /** Campos livres — mas nunca coordenada exata nem segredo. */
  detalhe?: Record<string, unknown>;
}

/** Chaves proibidas: barreira contra vazamento por descuido em chamada nova. */
const CHAVES_PROIBIDAS = new Set([
  'lat', 'lng', 'latitude', 'longitude', 'coords', 'coordinates',
  'password', 'senha', 'token', 'secret', 'authorization', 'cookie',
  'vapid', 'privateKey', 'endpoint', 'keys',
]);

function anonimizarId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.slice(0, 8);
}

/**
 * Remove chaves sensíveis em qualquer profundidade. Silencioso de propósito:
 * um log não pode derrubar o fluxo de socorro por causa de um campo indevido.
 */
function sanitizar(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 4) return '[profundo]';
  if (valor === null || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.map(v => sanitizar(v, profundidade + 1));

  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    if (CHAVES_PROIBIDAS.has(k)) {
      saida[k] = '[removido]';
      continue;
    }
    saida[k] = sanitizar(v, profundidade + 1);
  }
  return saida;
}

/**
 * Monta a linha de log. Exportada separada de `logSos` para ser testável sem
 * espionar o console.
 */
export function montarLinhaSos(evento: EventoSos, agora: Date = new Date()): Record<string, unknown> {
  const linha: Record<string, unknown> = {
    tag: 'sos',
    etapa: evento.etapa,
    ts: agora.toISOString(),
  };
  if (evento.sosId) linha.sosId = evento.sosId;
  const uid = anonimizarId(evento.userId);
  if (uid) linha.user = uid;
  if (evento.detalhe) {
    const limpo = sanitizar(evento.detalhe) as Record<string, unknown>;
    for (const [k, v] of Object.entries(limpo)) {
      if (v !== undefined) linha[k] = v;
    }
  }
  return linha;
}

/**
 * Emite o evento. Uma linha JSON por evento — o painel da Vercel permite
 * filtrar por `"tag":"sos"` e reconstruir a emergência inteira.
 *
 * Nunca lança: observabilidade não pode quebrar o socorro.
 */
export function logSos(evento: EventoSos): void {
  try {
    const linha = montarLinhaSos(evento);
    const grave = evento.etapa === 'erro' || evento.etapa === 'push.falhou';
    // eslint-disable-next-line no-console
    (grave ? console.error : console.log)(JSON.stringify(linha));
  } catch {
    // Se nem serializar deu, desistimos em silêncio.
  }
}
