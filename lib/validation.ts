// Direto de './errors' (não './auth'): './auth' importa './db', que exige
// DATABASE_URL no carregamento do módulo — isso quebrava qualquer teste
// unitário das funções puras deste arquivo mesmo sem tocar o banco.
import { HttpError } from './errors';

/** Extrai um campo string obrigatório, com limite de tamanho. */
export function str(
  body: unknown,
  field: string,
  opts: { min?: number; max?: number; optional?: boolean } = {}
): string {
  const { min = 1, max = 500, optional = false } = opts;
  const raw = (body as Record<string, unknown> | null)?.[field];

  if (raw === undefined || raw === null || raw === '') {
    if (optional) return '';
    throw new HttpError(400, `Campo obrigatório: ${field}.`);
  }
  if (typeof raw !== 'string') {
    throw new HttpError(400, `Campo ${field} deve ser texto.`);
  }

  const value = raw.trim();
  if (value.length < min) throw new HttpError(400, `Campo ${field} muito curto.`);
  if (value.length > max) throw new HttpError(400, `Campo ${field} excede ${max} caracteres.`);
  return value;
}

export function num(
  body: unknown,
  field: string,
  opts: { min?: number; max?: number; optional?: boolean } = {}
): number | null {
  const { min = -Infinity, max = Infinity, optional = false } = opts;
  const raw = (body as Record<string, unknown> | null)?.[field];

  if (raw === undefined || raw === null || raw === '') {
    if (optional) return null;
    throw new HttpError(400, `Campo obrigatório: ${field}.`);
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) throw new HttpError(400, `Campo ${field} deve ser numérico.`);
  if (value < min || value > max) {
    throw new HttpError(400, `Campo ${field} deve estar entre ${min} e ${max}.`);
  }
  return value;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Extrai um UUID obrigatório.
 *
 * Sem isto, um id malformado vindo da URL chega cru no Postgres e o cast
 * `invalid input syntax for type uuid` sobe como 500 — barulho de erro
 * interno para o que é claramente um pedido inválido (400).
 *
 * Normaliza para minúsculas: o Postgres compara UUID por valor, mas o texto
 * normalizado evita divergência quando o id é usado para montar chave de
 * idempotência ou nome de sala.
 */
export function uuid(body: unknown, field: string): string {
  const raw = (body as Record<string, unknown> | null)?.[field];
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
    throw new HttpError(400, `Campo ${field} deve ser um UUID válido.`);
  }
  return raw.toLowerCase();
}

export function bool(body: unknown, field: string, fallback = false): boolean {
  const raw = (body as Record<string, unknown> | null)?.[field];
  if (raw === undefined || raw === null) return fallback;
  return raw === true || raw === 'true';
}

export function oneOf<T extends string>(
  body: unknown,
  field: string,
  allowed: readonly T[],
  fallback?: T
): T {
  const raw = (body as Record<string, unknown> | null)?.[field];
  if ((raw === undefined || raw === null || raw === '') && fallback !== undefined) return fallback;
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) {
    throw new HttpError(400, `Campo ${field} inválido. Valores aceitos: ${allowed.join(', ')}.`);
  }
  return raw as T;
}

export function email(body: unknown, field = 'email'): string {
  const value = str(body, field, { max: 254 }).toLowerCase();
  // Validação deliberadamente simples: a verificação real é o envio funcionar.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    throw new HttpError(400, 'Email inválido.');
  }
  return value;
}

/** Exigimos 10+ caracteres em vez de regras de símbolo: comprimento vale mais. */
export function password(body: unknown, field = 'password'): string {
  const raw = (body as Record<string, unknown> | null)?.[field];
  if (typeof raw !== 'string' || raw.length < 10) {
    throw new HttpError(400, 'A senha precisa ter no mínimo 10 caracteres.');
  }
  if (raw.length > 200) throw new HttpError(400, 'Senha muito longa.');
  return raw;
}

/**
 * Filtra o array bruto de tamanhos de pipa (m²) do quiver do perfil: só
 * números dentro da faixa real de kites sobrevivem, e o array é limitado para
 * não crescer sem fim (ninguém tem 50 pipas). Itens inválidos são descartados
 * silenciosamente em vez de rejeitar a requisição inteira — o mesmo
 * comportamento tolerante que os demais campos de array do perfil (ex:
 * disciplines) já usam em app/api/profile/route.ts.
 */
export function clampQuiverKites(
  raw: unknown,
  opts: { min?: number; max?: number; maxItems?: number } = {}
): number[] {
  const { min = 3, max = 21, maxItems = 10 } = opts;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((k) => Number(k))
    .filter((k) => Number.isFinite(k) && k >= min && k <= max)
    .slice(0, maxItems);
}

/** Mesma lógica de clampQuiverKites, para o quiver de pranchas (texto livre). */
export function clampQuiverBoards(
  raw: unknown,
  opts: { maxLen?: number; maxItems?: number } = {}
): string[] {
  const { maxLen = 60, maxItems = 10 } = opts;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => String(b).trim().slice(0, maxLen))
    .filter((b) => b.length > 0)
    .slice(0, maxItems);
}
