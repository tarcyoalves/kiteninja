import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { sql } from './db';
import { HttpError } from './errors';
import { canOrganizeDownwind } from './authz';


export const SESSION_COOKIE = 'kiteninja_session';
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const BCRYPT_ROUNDS = 12;

export type Role = 'admin' | 'moderator' | 'instructor' | 'rider';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
}

// ------------------------------------------------------------------ hashing

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Tokens opacos (sessão, convite e recuperação) são guardados como SHA-256 no banco.
 * Não usamos bcrypt aqui: o token já tem 256 bits de entropia, então não há
 * ataque de dicionário a mitigar, e SHA-256 permite lookup por índice.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Compara strings em tempo constante, evitando vazar informação por timing. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Senha aleatória legível para o admin repassar na criação de conta. */
export function generatePassword(): string {
  // Sem caracteres ambíguos (0/O, 1/l/I) — vai ser digitado no celular na praia.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

// ------------------------------------------------------------------ sessões

export async function createSession(userId: string, userAgent?: string): Promise<string> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await sql`
    INSERT INTO auth_sessions (user_id, token_hash, user_agent, expires_at)
    VALUES (${userId}, ${hashToken(token)}, ${userAgent ?? null}, ${expiresAt.toISOString()})
  `;

  // Atualiza métricas de monitoramento de acesso do velejador
  try {
    await sql`
      UPDATE users
      SET last_login_at = NOW(),
          last_seen_at  = NOW(),
          login_count   = COALESCE(login_count, 0) + 1,
          last_user_agent = ${userAgent ?? null}
      WHERE id = ${userId}
    `;
  } catch {
    // Tolerante a oscilações
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return token;
}

/** Usuário da requisição atual, ou null. Fonte única de verdade de identidade. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await sql`
    SELECT u.id, u.email, u.name, u.role, u.must_change_password
    FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(token)}
      AND s.expires_at > NOW()
      AND u.is_active = TRUE
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;

  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: row.role as Role,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

/** Igual a getSessionUser, mas lança 401 — use em rotas que exigem login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, 'Não autenticado.');
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'admin') throw new HttpError(403, 'Acesso restrito ao administrador.');
  return user;
}

/**
 * Exige login e a permissão de organizar downwind (lib/authz.ts,
 * `canOrganizeDownwind`): admin/moderator/instructor por causa do role, ou
 * um rider com a liberação pontual `pode_organizar_downwind`. A flag não
 * está em `SessionUser`/na sessão (que só carrega o que toda rota precisa) —
 * por isso a busca aqui, só quando a checagem realmente é necessária.
 */
export async function requireDownwindOrganizer(): Promise<SessionUser> {
  const user = await requireUser();

  const rows = await sql`
    SELECT pode_organizar_downwind FROM users WHERE id = ${user.id} LIMIT 1
  `;
  const podeOrganizar = Boolean(
    (rows[0] as Record<string, unknown> | undefined)?.pode_organizar_downwind
  );

  if (!canOrganizeDownwind({ id: user.id, role: user.role, pode_organizar_downwind: podeOrganizar })) {
    throw new HttpError(403, 'Sem permissão para organizar downwind.');
  }
  return user;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await sql`DELETE FROM auth_sessions WHERE token_hash = ${hashToken(token)}`;
  }
  jar.delete(SESSION_COOKIE);
}

/**
 * Invalida todas as sessões de um usuário (usado na recuperação de senha e
 * pelo admin ao suspender/rebaixar um velejador).
 *
 * O cookie desta requisição só é apagado quando ele pertence à própria conta
 * invalidada. Antes ele era apagado sempre — então um admin suspendendo OUTRO
 * velejador perdia a própria sessão no meio da ação: a chamada seguinte
 * (recarregar a lista) caía em 401, o que aparecia como "Falha ao carregar
 * lista de velejadores" logo depois de um "suspender" bem-sucedido.
 */
export async function invalidateAllUserSessions(userId: string): Promise<void> {
  const jar = await cookies();
  const currentToken = jar.get(SESSION_COOKIE)?.value;

  let isMinhaSessao = false;
  if (currentToken) {
    const minha = await sql`
      SELECT 1 FROM auth_sessions WHERE token_hash = ${hashToken(currentToken)} AND user_id = ${userId} LIMIT 1
    `;
    isMinhaSessao = minha.length > 0;
  }

  await sql`DELETE FROM auth_sessions WHERE user_id = ${userId}`;

  if (isMinhaSessao) {
    jar.delete(SESSION_COOKIE);
  }
}

/** Lista sessões ativas do usuário com indicação da sessão atual. */
export async function listUserSessions(userId: string): Promise<
  Array<{ id: string; userAgent: string | null; createdAt: string; isCurrent: boolean }>
> {
  const jar = await cookies();
  const currentToken = jar.get(SESSION_COOKIE)?.value;
  const currentHash = currentToken ? hashToken(currentToken) : null;

  const rows = await sql`
    SELECT id, user_agent, created_at, token_hash
    FROM auth_sessions
    WHERE user_id = ${userId} AND expires_at > NOW()
    ORDER BY created_at DESC
  `;

  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      userAgent: row.user_agent ? String(row.user_agent) : null,
      createdAt: String(row.created_at),
      isCurrent: currentHash ? safeEqual(String(row.token_hash), currentHash) : false,
    };
  });
}

/** Revoga uma sessão específica de um usuário. */
export async function revokeUserSession(userId: string, sessionId: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM auth_sessions
    WHERE id = ${sessionId} AND user_id = ${userId}
    RETURNING id
  `;
  return rows.length > 0;
}

// ------------------------------------------------------------------ convites

export interface CreatedInvite {
  token: string;
  expiresAt: Date;
}

/**
 * Gera um convite de uso único. O token em claro só existe aqui e no link que
 * o admin copia — o banco guarda apenas o hash.
 */
export async function createInvite(
  adminId: string,
  opts: { email?: string; note?: string } = {}
): Promise<CreatedInvite> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);

  await sql`
    INSERT INTO invites (token_hash, email, note, created_by, expires_at)
    VALUES (
      ${hashToken(token)},
      ${opts.email?.toLowerCase() ?? null},
      ${opts.note ?? null},
      ${adminId},
      ${expiresAt.toISOString()}
    )
  `;

  return { token, expiresAt };
}

export interface ValidInvite {
  id: string;
  email: string | null;
}

/** Retorna o convite se ele estiver aberto (não usado, não revogado, no prazo). */
export async function findUsableInvite(token: string): Promise<ValidInvite | null> {
  if (!token) return null;

  const rows = await sql`
    SELECT id, email FROM invites
    WHERE token_hash = ${hashToken(token)}
      AND used_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;
  return { id: String(row.id), email: row.email ? String(row.email) : null };
}

/**
 * Marca o convite como usado. O UPDATE é condicional em `used_at IS NULL`, então
 * duas requisições simultâneas com o mesmo link não conseguem criar duas contas:
 * o banco resolve a corrida e a segunda recebe 0 linhas.
 */
export async function consumeInvite(inviteId: string, userId: string): Promise<boolean> {
  const rows = await sql`
    UPDATE invites
    SET used_at = NOW(), used_by = ${userId}
    WHERE id = ${inviteId} AND used_at IS NULL AND revoked_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

// ---------------------------------------------------- recuperação de senha

const RESET_TOKEN_HOURS = 2;

/** Cria um token de recuperação de senha para um e-mail cadastrado. */
export async function createPasswordResetToken(email: string): Promise<string | null> {
  const rows = await sql`
    SELECT id FROM users
    WHERE LOWER(email) = ${email.toLowerCase().trim()} AND is_active = TRUE
    LIMIT 1
  `;
  if (rows.length === 0) return null;

  const userId = String((rows[0] as Record<string, unknown>).id);
  const token = newToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_HOURS * 3600_000);

  // Invalida tokens anteriores não usados
  await sql`
    UPDATE password_reset_tokens
    SET used_at = NOW()
    WHERE user_id = ${userId} AND used_at IS NULL
  `;

  await sql`
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
    VALUES (${userId}, ${hashToken(token)}, ${expiresAt.toISOString()})
  `;

  return token;
}

/** Valida se um token de recuperação está aberto e retorna o usuário associado. */
export async function findUsablePasswordReset(
  token: string
): Promise<{ userId: string; email: string } | null> {
  if (!token) return null;

  const rows = await sql`
    SELECT r.id, r.user_id, u.email
    FROM password_reset_tokens r
    JOIN users u ON u.id = r.user_id
    WHERE r.token_hash = ${hashToken(token)}
      AND r.used_at IS NULL
      AND r.expires_at > NOW()
      AND u.is_active = TRUE
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;
  return { userId: String(row.user_id), email: String(row.email) };
}

/** Consome o token de recuperação, atualiza a senha e encerra todas as sessões. */
export async function consumePasswordReset(token: string, newPasswordHash: string): Promise<boolean> {
  const reset = await findUsablePasswordReset(token);
  if (!reset) return false;

  const updated = await sql`
    UPDATE password_reset_tokens
    SET used_at = NOW()
    WHERE token_hash = ${hashToken(token)} AND used_at IS NULL
    RETURNING id
  `;
  if (updated.length === 0) return false;

  await sql`
    UPDATE users
    SET password_hash = ${newPasswordHash}, must_change_password = FALSE, updated_at = NOW()
    WHERE id = ${reset.userId}
  `;

  await invalidateAllUserSessions(reset.userId);
  return true;
}

// ------------------------------------------------------------------ erros

export { HttpError } from './errors';


