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

  /*
   * PWA / Web (sem serviço nativo) — AMARELO, não verde.
   *
   * O RELATO QUE MUDOU ISTO: "veja se mesmo com a tela do iPhone fechada
   * continua rastreando; pois mesmo com a tela fechada chega push do chat".
   *
   * Não continua, e a diferença é de plataforma, não de bug: o push chega
   * porque quem entrega é o sistema operacional, que acorda o service worker.
   * O GPS não continua porque o iOS SUSPENDE a página web ao bloquear a tela,
   * e não existe API web que segure isso. O rastreio com o app fora da tela só
   * existe onde há serviço nativo — hoje, só o Foreground Service do Android
   * (não há pasta `ios/` neste projeto).
   *
   * Estava VERDE, "Localização sendo compartilhada", com a ressalva em letra
   * pequena embaixo. Verde quer dizer "está tudo certo, pode ir" — e no iPhone
   * isso é falso no instante em que a tela apaga. O grupo acha que enxerga
   * alguém que sumiu. Numa feature cuja razão de existir é ninguém ficar para
   * trás na água sem que se saiba, essa cor era a informação errada.
   *
   * Amarelo não é alarme: é "funciona, com uma condição" — e a condição está
   * no título, não escondida no detalhe.
   */
  if (statusTrackingNativo === null && telaTravadaLigada) {
    return {
      kind: 'enviando',
      titulo: 'Compartilhando só com a tela acesa',
      detalhe: 'Se a tela apagar ou você sair do app, o envio para',
      cor: 'amarelo',
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