/**
 * Rate limiting em memória com janela deslizante (sliding window).
 *
 * Protege rotas críticas (login, aceite de convite, recuperação de senha)
 * contra ataques de força bruta, enumeração e DDoS.
 */
import { HttpError } from './errors';


interface RateLimitRecord {
  timestamps: number[];
}

const store = new Map<string, RateLimitRecord>();

// Limpeza periódica de entradas expiradas para não acumular memória
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, record] of store.entries()) {
    record.timestamps = record.timestamps.filter((t) => now - t < windowMs);
    if (record.timestamps.length === 0) {
      store.delete(key);
    }
  }
}

/**
 * Avalia o limite de taxa para uma chave.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  cleanup(windowMs);

  const record = store.get(key) || { timestamps: [] };
  // Filtra apenas requisições dentro da janela atual
  record.timestamps = record.timestamps.filter((t) => now - t < windowMs);

  if (record.timestamps.length >= maxRequests) {
    const oldest = record.timestamps[0];
    const resetMs = Math.max(0, windowMs - (now - oldest));
    return {
      allowed: false,
      remaining: 0,
      resetMs,
    };
  }

  record.timestamps.push(now);
  store.set(key, record);

  return {
    allowed: true,
    remaining: maxRequests - record.timestamps.length,
    resetMs: windowMs,
  };
}

/**
 * Exige cumprimento do rate limit; lança HttpError(429) se estourar o teto.
 */
export function enforceRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
  customMessage?: string
): void {
  const { allowed, resetMs } = checkRateLimit(key, maxRequests, windowMs);
  if (!allowed) {
    const minutes = Math.ceil(resetMs / 60000);
    throw new HttpError(
      429,
      customMessage ||
        `Muitas tentativas. Aguarde ${minutes} minuto(s) antes de tentar novamente.`
    );
  }
}

/** Helpers semânticos para as rotas sensíveis do KiteNinja */
export const rateLimiters = {
  login: (identifier: string) =>
    enforceRateLimit(
      `login:${identifier.toLowerCase()}`,
      5,
      15 * 60 * 1000,
      'Muitas tentativas de login incorretas. Conta temporariamente bloqueada por 15 minutos para sua segurança.'
    ),

  invite: (ipOrToken: string) =>
    enforceRateLimit(
      `invite:${ipOrToken}`,
      10,
      60 * 60 * 1000,
      'Limite de validações de convite excedido. Tente novamente mais tarde.'
    ),

  passwordReset: (identifier: string) =>
    enforceRateLimit(
      `pwd_reset:${identifier.toLowerCase()}`,
      3,
      60 * 60 * 1000,
      'Limite de solicitações de recuperação de senha excedido. Aguarde 1 hora.'
    ),

  sos: (userId: string) =>
    enforceRateLimit(
      `sos:${userId}`,
      3,
      60 * 60 * 1000,
      'Limite de chamadas SOS atingido. Aguarde 1 hora — ligue 193 (Bombeiros) ou 185 (Marinha) se precisar de socorro imediato.'
    ),
};
