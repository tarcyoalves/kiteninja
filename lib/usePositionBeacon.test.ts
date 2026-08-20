import { afterEach, describe, expect, it, vi } from 'vitest';
import { lerPosicao } from './usePositionBeacon';

/**
 * O beacon existe porque a posição só chegava ao banco se o velejador abrisse a
 * aba Mapa e depois a aba Chat na mesma sessão (as duas montam por `activeTab`).
 * Quem deixava o app no feed, no bolso, não tinha posição — e um SOS não achava
 * essa pessoa.
 *
 * O que se testa aqui é o contrato que sustenta isso: falha de GPS nunca
 * rejeita. Se `lerPosicao` rejeitasse, o `await` dentro do beacon estouraria e
 * o intervalo pararia de reportar presença.
 */

function stubGeolocation(impl: Partial<Geolocation> | null) {
  const nav = globalThis.navigator as unknown as Record<string, unknown> | undefined;
  if (!nav) {
    // Ambiente `node`: não existe `navigator`. Cria só o necessário.
    Object.defineProperty(globalThis, 'navigator', {
      value: impl ? { geolocation: impl } : {},
      configurable: true,
      writable: true,
    });
    return;
  }
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: impl ?? undefined,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lerPosicao', () => {
  it('devolve a coordenada quando o GPS responde', async () => {
    stubGeolocation({
      getCurrentPosition: ((ok: PositionCallback) =>
        ok({
          coords: { latitude: -4.9572, longitude: -36.8833, accuracy: 30 },
        } as GeolocationPosition)) as Geolocation['getCurrentPosition'],
    });

    await expect(lerPosicao()).resolves.toEqual({ lat: -4.9572, lng: -36.8833 });
  });

  it('resolve null quando a permissão é negada, em vez de rejeitar', async () => {
    stubGeolocation({
      getCurrentPosition: ((_ok: PositionCallback, err?: PositionErrorCallback) =>
        err?.({ code: 1, message: 'User denied Geolocation' } as GeolocationPositionError)) as Geolocation['getCurrentPosition'],
    });

    await expect(lerPosicao()).resolves.toBeNull();
  });

  it('resolve null no timeout do GPS (sem sinal na praia)', async () => {
    stubGeolocation({
      getCurrentPosition: ((_ok: PositionCallback, err?: PositionErrorCallback) =>
        err?.({ code: 3, message: 'Timeout expired' } as GeolocationPositionError)) as Geolocation['getCurrentPosition'],
    });

    await expect(lerPosicao()).resolves.toBeNull();
  });

  it('resolve null quando o navegador não tem geolocation', async () => {
    stubGeolocation(null);
    await expect(lerPosicao()).resolves.toBeNull();
  });

  it('pede fix barato: sem alta precisão e aceitando cache', async () => {
    // Isto não é detalhe de implementação: `enableHighAccuracy` acende o rádio
    // do GPS, e fazer isso a cada 90s queimaria bateria no meio de uma sessão.
    const spy: Geolocation['getCurrentPosition'] = vi.fn(
      (ok: PositionCallback, _err?: PositionErrorCallback | null, _opts?: PositionOptions) =>
        ok({ coords: { latitude: 0, longitude: 0, accuracy: 1 } } as GeolocationPosition)
    );
    stubGeolocation({ getCurrentPosition: spy });

    await lerPosicao();

    const opts = vi.mocked(spy).mock.calls[0][2];
    if (!opts) throw new Error('lerPosicao precisa passar PositionOptions');
    expect(opts.enableHighAccuracy).toBe(false);
    expect(opts.maximumAge).toBeGreaterThan(0);
    expect(opts.timeout).toBeGreaterThan(0);
  });
});
