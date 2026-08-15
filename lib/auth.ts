import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { sql } from './db';

export const SESSION_COOKIE = 'kiteninja_session';
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const BCRYPT_ROUNDS = 12;

export type Role = 'admin' | 'rider';

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
 * Tokens opacos (sessão e convite) são guardados como SHA-256 no banco.
 * Não usamos bcrypt aqui: o token já tem 256 bits de entropia, então não há
 * ataque de dicionário a mitigar, e SHA-256 permite lookup por índice.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
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

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await sql`DELETE FROM auth_sessions WHERE token_hash = ${hashToken(token)}`;
  }
  jar.delete(SESSION_COOKIE);
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

// ------------------------------------------------------------------ erros

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
