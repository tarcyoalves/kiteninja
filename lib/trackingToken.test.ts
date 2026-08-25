import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

/**
 * lib/trackingToken.ts é o token escopado por downwind+participante que o
 * Foreground Service Android usa para reportar posição sem cookie de sessão
 * (ver docs/PLANO-RASTREIO-BACKGROUND-ANDROID.md). Como é 'server-only' e
 * depende de lib/db (Neon), o banco é mockado aqui — mesmo padrão de mock que
 * os testes de rota usam para lib/db.
 */

const sqlMock = vi.fn();
vi.mock('./db', () => ({ sql: sqlMock }));

const {
  criarTokenRastreio,
  validarTokenRastreio,
  revogarTokenRastreio,
  revogarTodosTokensDoDownwind,
  revogarTokensDoParticipante,
  revogarTokensDoUsuario,
  limparTokensExpirados,
} = await import('./trackingToken');

function hashDoToken(tokenCru: string): string {
  return createHash('sha256').update(tokenCru).digest('hex');
}

beforeEach(() => {
  sqlMock.mockReset();
});

describe('criarTokenRastreio', () => {
  it('grava o hash SHA-256 do token, nunca o token cru', async () => {
    sqlMock.mockResolvedValueOnce([]);

    const tokenCru = await criarTokenRastreio('downwind-1', 'user-1');

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const args = sqlMock.mock.calls[0];
    // args[0] é o array de strings do template; args[1..] são os valores interpolados.
    const valores = args.slice(1);
    expect(valores).toContain(hashDoToken(tokenCru));
    expect(valores).not.toContain(tokenCru);
    expect(valores).toContain('downwind-1');
    expect(valores).toContain('user-1');
  });

  it('expira em até 24h a partir de agora', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const antes = Date.now();

    await criarTokenRastreio('downwind-1', 'user-1');

    const valores = sqlMock.mock.calls[0].slice(1);
    const expiresAtIso = valores.find((v) => typeof v === 'string' && v.includes('T')) as string;
    const expiresAtMs = new Date(expiresAtIso).getTime();

    expect(expiresAtMs).toBeGreaterThan(antes + 23 * 3_600_000);
    expect(expiresAtMs).toBeLessThanOrEqual(antes + 24 * 3_600_000 + 5_000);
  });

  it('gera token com entropia suficiente (32 bytes → 43 chars base64url)', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const tokenCru = await criarTokenRastreio('downwind-1', 'user-1');
    expect(tokenCru.length).toBeGreaterThanOrEqual(40);
    expect(tokenCru).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('validarTokenRastreio', () => {
  it('rejeita token vazio sem consultar o banco', async () => {
    const resultado = await validarTokenRastreio('', 'downwind-1');
    expect(resultado).toBeNull();
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejeita quando o token não existe no banco', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const resultado = await validarTokenRastreio('token-inexistente', 'downwind-1');
    expect(resultado).toBeNull();
  });

  it('rejeita token expirado', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        user_id: 'user-1',
        downwind_id: 'downwind-1',
        expires_at: new Date(Date.now() - 1000).toISOString(),
        revoked_at: null,
      },
    ]);
    const resultado = await validarTokenRastreio('token-x', 'downwind-1');
    expect(resultado).toBeNull();
  });

  it('rejeita token revogado', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        user_id: 'user-1',
        downwind_id: 'downwind-1',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        revoked_at: new Date().toISOString(),
      },
    ]);
    const resultado = await validarTokenRastreio('token-x', 'downwind-1');
    expect(resultado).toBeNull();
  });

  it('rejeita quando o downwind da URL não é o downwind do token (escopo)', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        user_id: 'user-1',
        downwind_id: 'downwind-OUTRO',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        revoked_at: null,
      },
    ]);
    const resultado = await validarTokenRastreio('token-x', 'downwind-1');
    expect(resultado).toBeNull();
  });

  it('aceita token válido, não expirado, não revogado e do downwind certo', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        user_id: 'user-1',
        downwind_id: 'downwind-1',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        revoked_at: null,
      },
    ]);
    const resultado = await validarTokenRastreio('token-x', 'downwind-1');
    expect(resultado).toEqual({ userId: 'user-1', downwindId: 'downwind-1' });
  });
});

describe('revogação de tokens', () => {
  it('revogarTokenRastreio retorna true quando revogou uma linha', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'tok-1' }]);
    await expect(revogarTokenRastreio('token-x')).resolves.toBe(true);
  });

  it('revogarTokenRastreio retorna false quando token vazio (sem query)', async () => {
    await expect(revogarTokenRastreio('')).resolves.toBe(false);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('revogarTokenRastreio retorna false quando nenhuma linha bate (já revogado/inexistente)', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(revogarTokenRastreio('token-x')).resolves.toBe(false);
  });

  it('revogarTodosTokensDoDownwind retorna a contagem de linhas afetadas', async () => {
    sqlMock.mockResolvedValueOnce([{ id: '1' }, { id: '2' }]);
    await expect(revogarTodosTokensDoDownwind('downwind-1')).resolves.toBe(2);
  });

  it('revogarTokensDoParticipante mantém o escopo por downwind e usuário', async () => {
    sqlMock.mockResolvedValueOnce([{ id: '1' }]);
    await expect(revogarTokensDoParticipante('downwind-1', 'user-1')).resolves.toBe(1);

    const valores = sqlMock.mock.calls[0].slice(1);
    expect(valores).toContain('downwind-1');
    expect(valores).toContain('user-1');
  });

  it('revogarTokensDoUsuario retorna a contagem de linhas afetadas', async () => {
    sqlMock.mockResolvedValueOnce([{ id: '1' }]);
    await expect(revogarTokensDoUsuario('user-1')).resolves.toBe(1);
  });

  it('limparTokensExpirados retorna a contagem de linhas apagadas', async () => {
    sqlMock.mockResolvedValueOnce([{ id: '1' }, { id: '2' }, { id: '3' }]);
    await expect(limparTokensExpirados()).resolves.toBe(3);
  });
});
