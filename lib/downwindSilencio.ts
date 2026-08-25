import 'server-only';

import { sql } from './db';
import { sendPushToUsers } from './push';

/**
 * Alerta de silêncio no servidor para downwinds.
 *
 * Detecta velejadores que param de reportar posição num downwind em andamento,
 * e notifica o organizador e o apoio designado.
 *
 * O mecanismo é idempotente: registra cada silêncio detectado em
 * `downwind_silencio_alertas` para evitar notificar repetidamente.
 * Quando o velejador volta a reportar, o silêncio é marcado como "resolvido"
 * e um novo silêncio posterior pode gerar nova notificação.
 */

// Configuração de silêncio em segundos (padrão: 5 minutos)
// Pode ser sobrescrito pela configuração em app_settings
const SILENCIO_PADRAO_SEGUNDOS = 5 * 60;

// Grace period desde o início do downwind (em segundos)
// Não dispara alerta para quem ainda não teve tempo de reportar
const GRACE_PERIOD_INICIO_SEGUNDOS = 2 * 60;

/**
 * settings de configuração do silêncio (em app_settings)
 */
export const SILENCIO_CONFIG_KEY = 'downwind_silencio_config';

export interface DownwindSilencioConfig {
  /** Tempo máximo sem posição antes de alertar (em segundos) */
  silencioSegundos: number;
  /** Tempo de grace desde o início do downwind (em segundos) */
  graceInicioSegundos: number;
  /** Se alertas estão habilitados */
  habilitado: boolean;
}

const CONFIG_DEFAULT: DownwindSilencioConfig = {
  silencioSegundos: SILENCIO_PADRAO_SEGUNDOS,
  graceInicioSegundos: GRACE_PERIOD_INICIO_SEGUNDOS,
  habilitado: true,
};

/**
 * Lê a configuração de silêncio do banco ou retorna padrão.
 */
export async function getSilencioConfig(): Promise<DownwindSilencioConfig> {
  try {
    const rows = await sql`
      SELECT value FROM app_settings WHERE key = ${SILENCIO_CONFIG_KEY} LIMIT 1
    `;
    if (rows.length === 0) return CONFIG_DEFAULT;

    const value = (rows[0] as Record<string, unknown>).value as Record<string, unknown>;
    return {
      silencioSegundos: typeof value.silencioSegundos === 'number' ? value.silencioSegundos : CONFIG_DEFAULT.silencioSegundos,
      graceInicioSegundos: typeof value.graceInicioSegundos === 'number' ? value.graceInicioSegundos : CONFIG_DEFAULT.graceInicioSegundos,
      habilitado: typeof value.habilitado === 'boolean' ? value.habilitado : CONFIG_DEFAULT.habilitado,
    };
  } catch {
    return CONFIG_DEFAULT;
  }
}

/**
 * Resultado da detecção de silêncio.
 */
export interface ResultadoSilencio {
  downwindId: string;
  downwindNome: string;
  participanteUserId: string;
  participanteNome: string;
  ultimaPosicaoEm: Date | null;
  silencioDetectadoEm: Date;
  organizadoresIds: string[];
  apoioUserId: string | null;
}

/**
 * Resultado da varredura completa de silêncios.
 */
export interface ResumoVarreduraSilencio {
  examinados: number;
  silencios: ResultadoSilencio[];
  erros: number;
}

/**
 * Varre downwinds em andamento e detecta silêncios.
 *
 * Idempotente: usa a tabela downwind_silencio_alertas para evitar
 * notificar repetidamente sobre o mesmo silêncio.
 */
export async function varrerSilencos(agora: Date = new Date()): Promise<ResumoVarreduraSilencio> {
  const config = await getSilencioConfig();

  if (!config.habilitado) {
    return { examinados: 0, silencios: [], erros: 0 };
  }

  const silencioMs = config.silencioSegundos * 1000;
  const graceMs = config.graceInicioSegundos * 1000;

  // Busca participantes navegandos/em_confirmados em downwinds em andamento
  // que não reportaram posição nos últimos N minutos (desde o início do downwind + grace)
  const participantes = await sql`
    SELECT
      d.id AS downwind_id,
      d.nome AS downwind_nome,
      d.iniciado_em AS downwind_iniciado_em,
      dp.user_id,
      u.name AS participante_nome,
      p.ultima_posicao_em,
      dp.apoio_user_id
    FROM downwind_participantes dp
    JOIN downwinds d ON d.id = dp.downwind_id
    JOIN users u ON u.id = dp.user_id
    LEFT JOIN LATERAL (
      SELECT MAX(registrado_em) AS ultima_posicao_em
      FROM downwind_posicoes
      WHERE downwind_id = dp.downwind_id AND user_id = dp.user_id
    ) p ON TRUE
    WHERE d.status = 'em_andamento'
      AND dp.papel = 'velejador'
      AND dp.estado IN ('confirmado', 'navegando')
      AND (
        -- Só entra quem JÁ passou do grace period desde o início do downwind
        -- (iniciado_em aconteceu há MAIS tempo que graceMs). A condição
        -- inversa (iniciado_em > NOW() - graceMs) selecionaria exatamente
        -- quem AINDA está no grace period — o oposto do que este filtro
        -- deve fazer.
        d.iniciado_em IS NOT NULL
        AND d.iniciado_em <= NOW() - (${graceMs} || ' milliseconds')::interval
      )
  `;

  const silencios: ResultadoSilencio[] = [];
  let erros = 0;

  for (const row of participantes) {
    const r = row as Record<string, unknown>;
    const downwindId = String(r.downwind_id);
    const downwindNome = String(r.downwind_nome);
    const downwindIniciadoEm = r.downwind_iniciado_em ? new Date(String(r.downwind_iniciado_em)) : null;
    const userId = String(r.user_id);
    const participanteNome = String(r.participante_nome);
    const ultimaPosicaoEm = r.ultima_posicao_em ? new Date(String(r.ultima_posicao_em)) : null;
    const apoioUserId = r.apoio_user_id ? String(r.apoio_user_id) : null;

    // Skip se está no grace period
    if (downwindIniciadoEm && (agora.getTime() - downwindIniciadoEm.getTime()) < graceMs) {
      continue;
    }

    // Verifica se está em silêncio
    const ultimaPosicaoTimestamp = ultimaPosicaoEm ? ultimaPosicaoEm.getTime() : 0;
    const diffMs = agora.getTime() - Math.max(ultimaPosicaoTimestamp, downwindIniciadoEm?.getTime() ?? 0);

    if (diffMs < silencioMs) {
      // Não está em silêncio
      continue;
    }

    // Verifica se já alertamos sobre este silêncio
    const alertaExistente = await sql`
      SELECT id FROM downwind_silencio_alertas
      WHERE downwind_id = ${downwindId}
        AND user_id = ${userId}
        AND resolvido_em IS NULL
        AND silencio_desde < NOW() - (${silencioMs} || ' milliseconds')::interval
      LIMIT 1
    `;

    if (alertaExistente.length > 0) {
      // Já alertamos sobre este silêncio
      continue;
    }

    // Busca organizadores do downwind
    const organizadores = await sql`
      SELECT user_id FROM downwind_participantes
      WHERE downwind_id = ${downwindId} AND eh_organizador = TRUE
    `;
    const organizadoresIds = organizadores.map(o => String((o as Record<string, unknown>).user_id));

    // Registra o silêncio
    const silencioDetectadoEm = new Date(agora.getTime() - diffMs + silencioMs);

    try {
      await sql`
        INSERT INTO downwind_silencio_alertas (downwind_id, user_id, silencio_desde)
        VALUES (${downwindId}, ${userId}, ${silencioDetectadoEm})
      `;
    } catch {
      // Conflito de inserção concorrentes - outro processo já registrou
      continue;
    }

    silencios.push({
      downwindId,
      downwindNome,
      participanteUserId: userId,
      participanteNome,
      ultimaPosicaoEm,
      silencioDetectadoEm,
      organizadoresIds,
      apoioUserId,
    });
  }

  // Agora notifica os silêncios detectados
  for (const silencio of silencios) {
    try {
      await notificarSilencio(silencio);
    } catch (err) {
      erros++;
      console.error('[downwind-silencio] Erro ao notificar:', err);
    }
  }

  return {
    examinados: participantes.length,
    silencios,
    erros,
  };
}

/**
 * Notifica organizadores e apoio sobre um silêncio detectado.
 */
async function notificarSilencio(silencio: ResultadoSilencio): Promise<void> {
  const destinatarios = new Set<string>();

  // Adiciona organizadores
  for (const orgId of silencio.organizadoresIds) {
    destinatarios.add(orgId);
  }

  // Adiciona apoio designado (se houver)
  if (silencio.apoioUserId) {
    destinatarios.add(silencio.apoioUserId);
  }

  // Remove o próprio participante silencioso da lista de destinatários
  destinatarios.delete(silencio.participanteUserId);

  if (destinatarios.size === 0) {
    return;
  }

  const tempoSemPosicao = Math.round(
    (Date.now() - (silencio.ultimaPosicaoEm?.getTime() ?? Date.now())) / 60000
  );

  const titulo = `Silêncio detectado: ${silencio.participanteNome}`;
  const corpo = `${silencio.participanteNome} não reporta posição há ${tempoSemPosicao} min no downwind "${silencio.downwindNome}".`;

  await sendPushToUsers(Array.from(destinatarios), {
    title: titulo,
    body: corpo,
    tag: `downwind_silencio_${silencio.downwindId}`,
    url: `/?tab=downwind&id=${silencio.downwindId}`,
  });
}

/**
 * Marca um silêncio como resolvido quando o velejador volta a reportar.
 *
 * Chamado pela rota de posições quando uma nova posição é recebida.
 */
export async function resolverSilencio(
  downwindId: string,
  userId: string
): Promise<boolean> {
  const resultado = await sql`
    UPDATE downwind_silencio_alertas
    SET resolvido_em = NOW()
    WHERE downwind_id = ${downwindId}
      AND user_id = ${userId}
      AND resolvido_em IS NULL
    RETURNING id
  `;

  return resultado.length > 0;
}

/**
 * Limpa alertas de silêncio antigos (já resolvidos) para manter a tabela pequena.
 * Chamado periodicamente pelo cron.
 */
export async function limparAlertasAntigos(dias: number = 7): Promise<number> {
  const resultado = await sql`
    DELETE FROM downwind_silencio_alertas
    WHERE resolvido_em IS NOT NULL
      AND resolvido_em < NOW() - (${dias} || ' days')::interval
    RETURNING id
  `;

  return resultado.length;
}
