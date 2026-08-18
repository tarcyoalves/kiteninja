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
