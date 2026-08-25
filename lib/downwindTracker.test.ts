import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * lib/downwindTracker.ts é o adapter que liga o app web ao plugin nativo
 * Capacitor `DownwindTracker` (Foreground Service Android). Antes desta
 * mudança o plugin existia e compilava, mas nenhuma linha de JS/TS o
 * chamava — este arquivo testa a peça que fecha essa lacuna.
 *
 * `decidirTracking` é função pura (mesmo padrão de `deveReadquirir` em
 * lib/useWakeLock.ts): testada sem mock de Capacitor, sem jsdom, sem rede.
 * `iniciarTrackingNativo`/`pararTrackingNativo` mockam '@capacitor/core' via
 * `registerPlugin` para não depender de um app nativo real.
 */

const startTrackingMock = vi.fn();
const stopTrackingMock = vi.fn();

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({
    startTracking: startTrackingMock,
    stopTracking: stopTrackingMock,
    isTracking: vi.fn(),
    setAuthToken: vi.fn(),
  }),
  Capacitor: {
    isNativePlatform: () => true,
  },
}));

const { decidirTracking, iniciarTrackingNativo, pararTrackingNativo, estaNoAppNativo, PermissaoLocalizacaoNegadaError } =
  await import('./downwindTracker');

afterEach(() => {
  vi.restoreAllMocks();
  startTrackingMock.mockReset();
  stopTrackingMock.mockReset();
});

describe('decidirTracking', () => {
  const base = {
    isAuthenticated: true,
    papel: 'velejador' as const,
    downwindStatus: 'em_andamento' as const,
    participanteEstado: 'navegando' as const,
    appNativo: true,
  };

  it('rastreia quando velejador autenticado, downwind em andamento, navegando, no app nativo', () => {
    expect(decidirTracking(base)).toBe(true);
  });

  it('rastreia também com participanteEstado confirmado (ainda não começou a navegar)', () => {
    expect(decidirTracking({ ...base, participanteEstado: 'confirmado' })).toBe(true);
  });

  it('não rastreia fora do app nativo (PWA/browser)', () => {
    expect(decidirTracking({ ...base, appNativo: false })).toBe(false);
  });

  it('não rastreia sem usuário autenticado', () => {
    expect(decidirTracking({ ...base, isAuthenticated: false })).toBe(false);
  });

  it('não rastreia apoio em terra', () => {
    expect(decidirTracking({ ...base, papel: 'apoio_terra' })).toBe(false);
  });

  it('não rastreia papel nulo (nenhuma participação carregada ainda)', () => {
    expect(decidirTracking({ ...base, papel: null })).toBe(false);
  });

  it('não rastreia downwind aberto (ainda não começou)', () => {
    expect(decidirTracking({ ...base, downwindStatus: 'aberto' })).toBe(false);
  });

  it('não rastreia downwind encerrado', () => {
    expect(decidirTracking({ ...base, downwindStatus: 'encerrado' })).toBe(false);
  });

  it('não rastreia downwind cancelado', () => {
    expect(decidirTracking({ ...base, downwindStatus: 'cancelado' })).toBe(false);
  });

  it('não rastreia participante que já encerrou', () => {
    expect(decidirTracking({ ...base, participanteEstado: 'encerrado' })).toBe(false);
  });

  it('não rastreia participante que desistiu', () => {
    expect(decidirTracking({ ...base, participanteEstado: 'desistiu' })).toBe(false);
  });

  it('não rastreia sem downwindStatus (nenhum downwind ativo)', () => {
    expect(decidirTracking({ ...base, downwindStatus: null })).toBe(false);
  });
});

describe('estaNoAppNativo', () => {
  it('false fora de um objeto window (ambiente node/servidor)', () => {
    // Neste arquivo de teste `window` não existe (environment: 'node' do vitest.config.ts).
    expect(estaNoAppNativo()).toBe(false);
  });
});

describe('iniciarTrackingNativo', () => {
  it('busca o token e inicia o plugin nativo com os parâmetros corretos', async () => {
    startTrackingMock.mockResolvedValueOnce({ success: true, downwindId: 'dw-1' });
    const obterToken = vi.fn().mockResolvedValueOnce({ token: 'tok-abc' });

    const resultado = await iniciarTrackingNativo({
      downwindId: 'dw-1',
      baseUrl: 'https://kiteninja.vercel.app',
      obterToken,
    });

    expect(resultado).toEqual({ ok: true });
    expect(obterToken).toHaveBeenCalledTimes(1);
    expect(startTrackingMock).toHaveBeenCalledWith({
      downwindId: 'dw-1',
      authToken: 'tok-abc',
      baseUrl: 'https://kiteninja.vercel.app',
    });
  });

  it('não chama o plugin nativo se a busca do token falhar', async () => {
    const obterToken = vi.fn().mockRejectedValueOnce(new Error('Falha na requisição.'));

    const resultado = await iniciarTrackingNativo({
      downwindId: 'dw-1',
      baseUrl: 'https://kiteninja.vercel.app',
      obterToken,
    });

    expect(resultado.ok).toBe(false);
    expect(startTrackingMock).not.toHaveBeenCalled();
  });

  it('devolve permissaoNegada=true honestamente quando o plugin rejeita por permissão', async () => {
    const obterToken = vi.fn().mockResolvedValueOnce({ token: 'tok-abc' });
    startTrackingMock.mockRejectedValueOnce(new Error('Permissão de localização negada'));

    const resultado = await iniciarTrackingNativo({
      downwindId: 'dw-1',
      baseUrl: 'https://kiteninja.vercel.app',
      obterToken,
    });

    expect(resultado).toEqual({
      ok: false,
      permissaoNegada: true,
      error: 'Permissão de localização negada.',
    });
  });

  it('devolve permissaoNegada indefinido (não true) para outros erros', async () => {
    const obterToken = vi.fn().mockResolvedValueOnce({ token: 'tok-abc' });
    startTrackingMock.mockRejectedValueOnce(new Error('Atividade não disponível'));

    const resultado = await iniciarTrackingNativo({
      downwindId: 'dw-1',
      baseUrl: 'https://kiteninja.vercel.app',
      obterToken,
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.permissaoNegada).toBeUndefined();
    expect(resultado.error).toBe('Atividade não disponível');
  });
});

describe('pararTrackingNativo', () => {
  it('chama stopTracking no plugin', async () => {
    stopTrackingMock.mockResolvedValueOnce({ success: true });
    await pararTrackingNativo();
    expect(stopTrackingMock).toHaveBeenCalledTimes(1);
  });

  it('não lança quando o plugin rejeita (best-effort)', async () => {
    stopTrackingMock.mockRejectedValueOnce(new Error('Serviço já parado'));
    await expect(pararTrackingNativo()).resolves.toBeUndefined();
  });
});

describe('PermissaoLocalizacaoNegadaError', () => {
  it('carrega uma mensagem clara para diferenciar de erro genérico', () => {
    const err = new PermissaoLocalizacaoNegadaError();
    expect(err.name).toBe('PermissaoLocalizacaoNegadaError');
    expect(err.message).toMatch(/permiss/i);
  });
});
