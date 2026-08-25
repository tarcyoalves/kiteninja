import { describe, expect, it } from 'vitest';
import { checkRateLimit, enforceRateLimit } from './rateLimit';
import { HttpError } from './errors';


describe('rateLimit (sliding window)', () => {
  it('permite requisições dentro do limite estipulado', () => {
    const key = `test_allowed_${Date.now()}`;
    const r1 = checkRateLimit(key, 3, 1000);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = checkRateLimit(key, 3, 1000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = checkRateLimit(key, 3, 1000);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it('bloqueia e zera remaining quando atinge o teto', () => {
    const key = `test_blocked_${Date.now()}`;
    checkRateLimit(key, 2, 1000);
    checkRateLimit(key, 2, 1000);

    const r3 = checkRateLimit(key, 2, 1000);
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.resetMs).toBeGreaterThan(0);
  });

  it('enforceRateLimit lança HttpError com status 429', () => {
    const key = `test_enforce_${Date.now()}`;
    enforceRateLimit(key, 1, 1000);

    expect(() => {
      enforceRateLimit(key, 1, 1000);
    }).toThrowError(HttpError);

    try {
      enforceRateLimit(key, 1, 1000);
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(429);
    }
  });
});

describe('ANT-002: rate limits SOS criação vs atualização são independentes', () => {
  // O bug original: rate limit era cobrado ANTES de checar se já havia SOS ativo.
  // Atualizar coordenadas consumia a mesma cota de criação (3/hora), bloqueando
  // o velejador que deriva no mar. A correção: rate limits separados.
  it('criação e atualização usam chaves diferentes', () => {
    const userId = `user_${Date.now()}`;
    const chaveCriacao = `sos:${userId}`;
    const chaveUpdate = `sos_update:${userId}`;

    // Consumir criação não afeta update
    checkRateLimit(chaveCriacao, 3, 1000);
    checkRateLimit(chaveCriacao, 3, 1000);
    checkRateLimit(chaveCriacao, 3, 1000);

    // Update ainda tem 60 requests disponíveis (na chave separada)
    const r = checkRateLimit(chaveUpdate, 60, 1000);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(59);
  });

  it('update permite 60/minuto, não 3/hora', () => {
    const key = `test_update_${Date.now()}`;
    // 60 requisições em 1 minuto devem passar
    for (let i = 0; i < 60; i++) {
      const r = checkRateLimit(key, 60, 60_000);
      expect(r.allowed).toBe(true);
    }
    // A 61a deve falhar
    const r61 = checkRateLimit(key, 60, 60_000);
    expect(r61.allowed).toBe(false);
  });
});
