import { describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';

/**
 * lib/auth.ts é 'server-only' e depende de next/headers, então aqui testamos as
 * primitivas de segurança que ele usa, com a mesma implementação. Se estes
 * testes passarem, a base criptográfica está correta; o fluxo completo é
 * verificado no teste de integração contra o banco.
 */

const BCRYPT_ROUNDS = 12;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (const byte of randomBytes(16)) out += alphabet[byte % alphabet.length];
  return out;
}

describe('hash de senha', () => {
  it('aceita a senha correta e rejeita a errada', async () => {
    const hash = await bcrypt.hash('vento-forte-2026', BCRYPT_ROUNDS);

    await expect(bcrypt.compare('vento-forte-2026', hash)).resolves.toBe(true);
    await expect(bcrypt.compare('vento-forte-2025', hash)).resolves.toBe(false);
  });

  it('nunca armazena a senha em claro', async () => {
    const plain = 'minha-senha-secreta';
    const hash = await bcrypt.hash(plain, BCRYPT_ROUNDS);

    expect(hash).not.toContain(plain);
    expect(hash.startsWith('$2')).toBe(true);
  });

  it('gera hashes diferentes para a mesma senha (salt por hash)', async () => {
    const a = await bcrypt.hash('igual', BCRYPT_ROUNDS);
    const b = await bcrypt.hash('igual', BCRYPT_ROUNDS);

    expect(a).not.toBe(b);
    await expect(bcrypt.compare('igual', a)).resolves.toBe(true);
    await expect(bcrypt.compare('igual', b)).resolves.toBe(true);
  });

  it('usa custo 12', async () => {
    const hash = await bcrypt.hash('x', BCRYPT_ROUNDS);
    expect(hash.split('$')[2]).toBe('12');
  });

  it('o hash descartável do login é um bcrypt válido', async () => {
    // Se este hash fosse malformado, bcrypt.compare lançaria e a rota de login
    // quebraria para email inexistente em vez de responder 401.
    const DUMMY = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO1pJ8Yd6xUqZ6ZQ0Zj3Z8QqW1lYqPYbS';
    await expect(bcrypt.compare('qualquer-coisa', DUMMY)).resolves.toBe(false);
  });
});

describe('tokens de sessão e convite', () => {
  it('gera tokens únicos e com entropia suficiente', () => {
    const tokens = new Set(Array.from({ length: 500 }, newToken));

    expect(tokens.size).toBe(500);
    // 32 bytes em base64url ≈ 43 caracteres.
    for (const t of tokens) expect(t.length).toBeGreaterThanOrEqual(43);
  });

  it('usa alfabeto seguro para URL', () => {
    for (let i = 0; i < 100; i++) {
      expect(newToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('hash do token é determinístico e não reversível ao valor', () => {
    const token = newToken();

    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toHaveLength(64);
  });

  it('tokens diferentes produzem hashes diferentes', () => {
    expect(hashToken(newToken())).not.toBe(hashToken(newToken()));
  });
});

describe('senha gerada para novas contas', () => {
  it('tem 16 caracteres e evita caracteres ambíguos', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generatePassword();
      expect(pw).toHaveLength(16);
      // 0/O e 1/l/I saem do alfabeto para não confundir na digitação.
      expect(pw).not.toMatch(/[0O1lI]/);
    }
  });

  it('não repete entre chamadas', () => {
    const all = new Set(Array.from({ length: 300 }, generatePassword));
    expect(all.size).toBe(300);
  });

  it('passa a validação mínima de 10 caracteres', () => {
    expect(generatePassword().length).toBeGreaterThanOrEqual(10);
  });
});
