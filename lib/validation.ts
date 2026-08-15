import { HttpError } from './auth';

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
