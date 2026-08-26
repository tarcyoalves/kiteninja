import { describe, it, expect } from 'vitest';
import { derivarEstadoCompartilhamento } from './downwindStatusVisual';
import type { TrackingStatus } from './downwindTracker';

const mockTelemetryBase: TrackingStatus = {
  isServiceRunning: true,
  isTrackingConfigured: true,
  downwindId: 'dw-123',
  startedAt: Date.now() - 60000,
  lastLocationAt: Date.now(),
  lastSendAttemptAt: Date.now(),
  lastSuccessfulSendAt: Date.now(),
  lastHttpStatus: 200,
  lastError: null,
  pendingCount: 0,
  consecutiveFailures: 0,
  droppedCount: 0,
  lastStopReason: null,
  batteryOptimizationIgnored: true,
  networkAvailable: true,
};

describe('Visual Status do Rastreamento (lib/downwindStatusVisual.ts)', () => {
  it('retorna VERDE quando o serviço está rodando e enviando normalmente', () => {
    const estado = derivarEstadoCompartilhamento({
      isServiceRunning: true,
      statusTrackingNativo: 'ativo',
      telaTravadaLigada: false,
      telemetry: mockTelemetryBase,
    });

    expect(estado.cor).toBe('verde');
    expect(estado.kind).toBe('enviando');
    expect(estado.titulo).toContain('compartilhada');
  });

  it('retorna AMARELO (offline) quando há posições pendentes ou falhas de rede', () => {
    const estado = derivarEstadoCompartilhamento({
      isServiceRunning: true,
      statusTrackingNativo: 'ativo',
      telaTravadaLigada: false,
      telemetry: {
        ...mockTelemetryBase,
        pendingCount: 5,
        consecutiveFailures: 2,
        lastError: 'HTTP 503',
      },
    });

    expect(estado.cor).toBe('amarelo');
    expect(estado.kind).toBe('offline');
    expect(estado.titulo).toContain('Sem internet');
  });

  it('retorna VERMELHO quando permissão é negada ou há erro terminal', () => {
    const estadoPermissao = derivarEstadoCompartilhamento({
      isServiceRunning: false,
      statusTrackingNativo: 'permissao_negada',
      telaTravadaLigada: false,
      telemetry: null,
    });

    expect(estadoPermissao.cor).toBe('vermelho');
    expect(estadoPermissao.kind).toBe('interrompido');
    expect(estadoPermissao.podeTentar).toBe(true);

    const estadoErro = derivarEstadoCompartilhamento({
      isServiceRunning: false,
      statusTrackingNativo: 'erro',
      telaTravadaLigada: false,
      telemetry: null,
      erroTerminal: true,
    });

    expect(estadoErro.cor).toBe('vermelho');
    expect(estadoErro.podeTentar).toBe(true);
  });

  it('retorna CINZA (iniciando) quando o serviço ainda está obtendo fix de satélite', () => {
    const estado = derivarEstadoCompartilhamento({
      isServiceRunning: false,
      statusTrackingNativo: null,
      telaTravadaLigada: false,
      telemetry: null,
    });

    expect(estado.cor).toBe('cinza');
    expect(estado.kind).toBe('iniciando');
  });
});