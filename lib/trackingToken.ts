import 'server-only';

import { sql } from './db';
import { hashToken, newToken } from './auth';

/**
 * Token de rastreio para Foreground Service Android.
 *
 * Quando o velejador inicia um downwind em primeiro plano, o servidor gera um token
 * de uso único que é entregue ao app Android via FCM. O app nativo usa esse token
 * (Authorization: Bearer) para reportar posições mesmo com o app fechado.
 *
 * Escopo: o token é válido APENAS para O DOWNWIND que o gerou. Isso limita o
 * dano de um token vazado: não dá acesso à conta, não envia SOS, não lê mensagens.
 *
 * Segurança:
 * - Token cru tem 32 bytes de entropia (base64url), alto o suficiente para não
 *   precisar de bcrypt no banco — já é impraticável fazer lookup por dicionário.
 * - Apenas o hash SHA-256 é guardado no banco (mesmo padrão de invites/auth_sessions).
 * - Expira em no máximo 24h (ou quando o downwind termina, o que vier primeiro).
 * - Pode ser revogado explicitamente (encerramento, detecção de uso fraudulento).
 */

/** Duração máxima de um token de rastreio (24h). */
const MAX_TOKEN_HOURS = 24;

/**
 * Gera um novo token de rastreio para um downwind específico.
 *
 * @param downwindId - ID do downwind em andamento
 * @param userId - ID do velejador que está iniciando
 * @returns O token em claro (32 bytes base64url) para passar ao app nativo via FCM
 */
export async function criarTokenRastreio(
  downwindId: string,
  userId: string
): Promise<string> {
  const tokenCru = newToken();
  const tokenHash = hashToken(tokenCru);
  const expiresAt = new Date(Date.now() + MAX_TOKEN_HOURS * 3_600_000);

  await sql`
    INSERT INTO downwind_tracking_tokens (token_hash, downwind_id, user_id, expires_at)
    VALUES (${tokenHash}, ${downwindId}, ${userId}, ${expiresAt.toISOString()})
  `;

  return tokenCru;
}

/**
 * Valida um token de rastreio Bearer.
 *
 * Verifica:
 * 1. Token existe e não expirou
 * 2. Não foi revogado
 * 3. Pertence ao downwind especificado na URL
 *
 * @param token - Token cru (não hash) recebido no header Authorization
 * @param downwindId - ID do downwind que está na URL (para escopo)
 * @returns Objeto com userId se válido, null se inválido
 */
export async function validarTokenRastreio(
  token: string,
  downwindId: string
): Promise<{ userId: string; downwindId: string } | null> {
  if (!token) return null;

  const tokenHash = hashToken(token);

  const rows = await sql`
    SELECT user_id, downwind_id, expires_at, revoked_at
    FROM downwind_tracking_tokens
    WHERE token_hash = ${tokenHash}
    LIMIT 1
  `;

  if (rows.length === 0) return null;

  const r = rows[0] as Record<string, unknown>;
  const expiresAt = String(r.expires_at);
  const revokedAt = r.revoked_at ? String(r.revoked_at) : null;

  // Verifica expiração
  if (new Date(expiresAt) < new Date()) {
    return null;
  }

  // Verifica revogação
  if (revokedAt !== null) {
    return null;
  }

  // Verifica escopo: token é válido APENAS para o downwind que o gerou
  const tokenDownwindId = String(r.downwind_id);
  if (tokenDownwindId !== downwindId) {
    return null;
  }

  return { userId: String(r.user_id), downwindId: tokenDownwindId };
}

/**
 * Revoga um token de rastreio específico.
 *
 * Chamado quando o downwind termina ou por detecção de uso suspeito.
 */
export async function revogarTokenRastreio(
  token: string
): Promise<boolean> {
  if (!token) return false;

  const tokenHash = hashToken(token);

  const rows = await sql`
    UPDATE downwind_tracking_tokens
    SET revoked_at = NOW()
    WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}

/**
 * Revoga todos os tokens de rastreio de um downwind.
 *
 * Chamado quando o downwind é encerrado.
 */
export async function revogarTodosTokensDoDownwind(
  downwindId: string
): Promise<number> {
  const result = await sql`
    UPDATE downwind_tracking_tokens
    SET revoked_at = NOW()
    WHERE downwind_id = ${downwindId} AND revoked_at IS NULL
  `;

  return result.length;
}

/**
 * Revoga os tokens de um participante apenas dentro de um downwind.
 *
 * Usado quando o velejador encerra/desiste individualmente. O escopo duplo é
 * importante: revogar todos os tokens do usuário poderia interromper outra
 * travessia válida em caso de dados legados ou operações concorrentes.
 */
export async function revogarTokensDoParticipante(
  downwindId: string,
  userId: string
): Promise<number> {
  const result = await sql`
    UPDATE downwind_tracking_tokens
    SET revoked_at = NOW()
    WHERE downwind_id = ${downwindId}
      AND user_id = ${userId}
      AND revoked_at IS NULL
    RETURNING id
  `;

  return result.length;
}

/**
 * Revoga todos os tokens de rastreio de um usuário.
 *
 * Usado quando uma sessão é invalidada (ex: usuário reporta token comprometido).
 */
export async function revogarTokensDoUsuario(
  userId: string
): Promise<number> {
  const result = await sql`
    UPDATE downwind_tracking_tokens
    SET revoked_at = NOW()
    WHERE user_id = ${userId} AND revoked_at IS NULL
  `;

  return result.length;
}

/**
 * Limpa tokens expirados (manutenção).
 *
 * Pode ser chamado periodicamente (ex: cron diário) ou sob demanda.
 */
export async function limparTokensExpirados(): Promise<number> {
  const result = await sql`
    DELETE FROM downwind_tracking_tokens
    WHERE expires_at < NOW()
  `;

  return result.length;
}
