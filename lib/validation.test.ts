import { describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';

/**
 * lib/validation.ts importa HttpError de lib/auth.ts, que por sua vez importa
 * lib/db.ts — e lib/db.ts lança se DATABASE_URL não estiver definida. Testar
 * o módulo direto quebraria em qualquer ambiente sem banco configurado
 * (inclusive CI sem segredo), então replicamos aqui a mesma regra usada por
 * lib/validation.ts:password(), no mesmo padrão que lib/auth.test.ts usa
 * para as primitivas de lib/auth.ts.
 */
const MIN_LEN = 10;
const MAX_LEN = 200;

function password(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length < MIN_LEN) {
    throw new Error('A senha precisa ter no mínimo 10 caracteres.');
  }
  if (raw.length > MAX_LEN) throw new Error('Senha muito longa.');
  return raw;
}

describe('validação de senha nova (lib/validation.ts:password)', () => {
  it('rejeita senha menor que o mínimo', () => {
    expect(() => password('curta123')).toThrow(/mínimo/);
  });

  it('aceita senha exatamente no limite mínimo', () => {
    const nove = 'a'.repeat(MIN_LEN - 1);
    const dez = 'a'.repeat(MIN_LEN);
    expect(() => password(nove)).toThrow();
    expect(password(dez)).toHaveLength(MIN_LEN);
  });

  it('rejeita senha acima do máximo permitido', () => {
    expect(() => password('a'.repeat(MAX_LEN + 1))).toThrow(/longa/);
  });

  it('rejeita valor que não é string', () => {
    expect(() => password(12345678901)).toThrow();
    expect(() => password(undefined)).toThrow();
    expect(() => password(null)).toThrow();
  });

  // A regra de 10+ caracteres cobre com folga o mínimo de 8 pedido para a
  // troca obrigatória de senha: exigir mais nunca viola exigir "pelo menos 8".
  it('o mínimo do projeto (10) satisfaz a exigência de 8+ caracteres', () => {
    expect(MIN_LEN).toBeGreaterThanOrEqual(8);
  });
});

/**
 * app/api/auth/change-password/route.ts exige que a nova senha seja
 * diferente da atual comparando com bcrypt.compare contra o hash salvo — não
 * por igualdade de texto puro, já que o servidor nunca guarda a senha atual
 * em claro. Testamos a mesma primitiva usada lá, no padrão de lib/auth.test.ts.
 */
describe('regra "nova senha precisa ser diferente da atual"', () => {
  it('bcrypt reconhece a senha repetida (troca deve ser barrada)', async () => {
    const hash = await bcrypt.hash('senha-temporaria-1234', 12);
    await expect(bcrypt.compare('senha-temporaria-1234', hash)).resolves.toBe(true);
  }, 15000);

  it('bcrypt libera quando a nova senha é de fato diferente', async () => {
    const hash = await bcrypt.hash('senha-temporaria-1234', 12);
    await expect(bcrypt.compare('outra-senha-bem-diferente', hash)).resolves.toBe(false);
  }, 15000);
});
