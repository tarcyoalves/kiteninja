import type { TrackingStatus } from './downwindTracker';

export type EstadoCompartilhamento = {
  kind: 'iniciando' | 'enviando' | 'offline' | 'interrompido';
  titulo: string;
  detalhe?: string;
  podeTentar?: boolean;
  cor: 'cinza' | 'verde' | 'amarelo' | 'vermelho';
};

export interface ParametrosEstadoVisual {
  isServiceRunning: boolean;
  statusTrackingNativo: 'ativo' | 'inativo' | 'erro' | 'permissao_negada' | null;
  telaTravadaLigada: boolean;
  telemetry: TrackingStatus | null;
  erroTerminal?: boolean;
}

export function derivarEstadoCompartilhamento(params: ParametrosEstadoVisual): EstadoCompartilhamento {
  const { isServiceRunning, statusTrackingNativo, telaTravadaLigada, telemetry, erroTerminal } = params;

  // Erro terminal ou serviço explicitamente em erro / permissão negada
  if (erroTerminal || statusTrackingNativo === 'erro' || statusTrackingNativo === 'permissao_negada') {
    return {
      kind: 'interrompido',
      titulo: 'Localização não está sendo enviada',
      detalhe:
        statusTrackingNativo === 'permissao_negada'
          ? 'Permissão de localização necessária'
          : 'Toque para tentar novamente',
      podeTentar: true,
      cor: 'vermelho',
    };
  }

  // Se o rastreamento nativo estiver ativo no Android
  if (statusTrackingNativo === 'ativo' || isServiceRunning) {
    // Se há posições pendentes ou falhas temporárias recentes de rede
    if (telemetry && (telemetry.pendingCount > 0 || (telemetry.consecutiveFailures > 0 && telemetry.lastError))) {
      return {
        kind: 'offline',
        titulo: 'Sem internet — posições salvas no aparelho',
        detalhe: 'Serão enviadas quando a conexão voltar',
        cor: 'amarelo',
      };
    }

    // Enviando normalmente
    let detalhe = 'Aguardando primeiro envio';
    if (telemetry && telemetry.lastSuccessfulSendAt > 0) {
      const diffSeg = Math.floor((Date.now() - telemetry.lastSuccessfulSendAt) / 1000);
      if (diffSeg < 15) {
        detalhe = 'Último envio agora';
      } else if (diffSeg < 60) {
        detalhe = `Último envio há ${diffSeg}s`;
      } else if (diffSeg < 3600) {
        const mins = Math.floor(diffSeg / 60);
        detalhe = `Último envio há ${mins} min`;
      } else {
        detalhe = `Último envio às ${new Date(telemetry.lastSuccessfulSendAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}`;
      }
    } else if (telaTravadaLigada) {
      detalhe = 'Mantenha o app aberto e a tela acesa';
    }

    return {
      kind: 'enviando',
      titulo: 'Localização sendo compartilhada',
      detalhe,
      cor: 'verde',
    };
  }

  // PWA / Web com WakeLock ativo
  if (statusTrackingNativo === null && telaTravadaLigada) {
    return {
      kind: 'enviando',
      titulo: 'Localização sendo compartilhada',
      detalhe: 'Mantenha o app aberto e a tela acesa',
      cor: 'verde',
    };
  }

  // Se o status nativo ainda estiver carregando / inicializando
  if (statusTrackingNativo === null && !telaTravadaLigada) {
    return {
      kind: 'iniciando',
      titulo: 'Iniciando rastreamento...',
      detalhe: 'Aguardando fix do GPS',
      cor: 'cinza',
    };
  }

  return {
    kind: 'interrompido',
    titulo: 'Rastreamento pausado',
    detalhe: 'Toque para iniciar o envio',
    podeTentar: true,
    cor: 'vermelho',
  };
}