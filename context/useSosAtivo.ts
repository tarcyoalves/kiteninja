'use client';

/**
 * Estado e ações do SOS no cliente — primeira fatia da T17.
 *
 * Morava inteiro dentro de `KiteDataContext.tsx` (1.547 linhas juntando spots,
 * feed, chat, eventos, modais e logbook). Saiu para cá SEM mudar comportamento:
 * o corpo abaixo é o mesmo, linha a linha, e o contexto continua expondo os
 * mesmos sete campos — nenhuma tela precisou mudar. O que muda é que o fluxo de
 * emergência passa a poder ser lido e alterado sem rolar por código de feed.
 *
 * `api` chega por parâmetro (é a função de módulo do contexto, estável) para
 * este arquivo não importar o contexto e criar um ciclo.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface SosResponderData {
  userId: string;
  name: string;
  state: 'notificado' | 'a_caminho' | 'no_local' | 'nao_posso';
  distanceKm: number | null;
  /**
   * Por que esta pessoa foi notificada — ver lib/sosCandidates.ts.
   * 'downwind'/'downwind_apoio' podem estar longe e ainda assim ser o socorro
   * mais rápido, então a UI precisa distinguir de um vizinho qualquer.
   */
  motivo?: 'proximidade' | 'downwind' | 'downwind_apoio' | 'moderador' | 'spot_fallback';
  lat: number | null;
  lng: number | null;
}

export interface SosAlertData {
  id: string;
  userId: string;
  authorName: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  spotId: string | null;
  spotName: string | null;
  message: string | null;
  status: 'ativo' | 'em_atendimento' | 'resolvido' | 'cancelado' | 'falso_alarme';
  radiusKm: number;
  createdAt: string;
  responders: SosResponderData[];
  temCoordenada: boolean;
  distanceKm: number | null;
  /** Por que ESTE usuário foi chamado para este SOS (undefined se é o autor). */
  motivo?: 'proximidade' | 'downwind' | 'downwind_apoio' | 'moderador' | 'spot_fallback';
}

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

export function useSosAtivo(args: {
  api: Api;
  isAuthenticated: boolean;
  userId: string | undefined;
  lastKnownPosition: { lat: number; lng: number } | null;
}) {
  const { api, isAuthenticated, userId, lastKnownPosition } = args;

  const [myActiveSos, setMyActiveSos] = useState<SosAlertData | null>(null);
  const [incomingSosAlert, setIncomingSosAlert] = useState<SosAlertData | null>(null);
  const [allActiveSosList, setAllActiveSosList] = useState<SosAlertData[]>([]);
  const dismissedSosIdsRef = useRef<Set<string>>(new Set());
  const seenResponderStatesRef = useRef<Map<string, string>>(new Map());
  const sosBaselineDoneRef = useRef(false);

  const fetchActiveSos = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const data = await api<{ alerts: SosAlertData[] }>('/api/sos/active', { cache: 'no-store' });
      const list = data?.alerts || [];
      setAllActiveSosList(list);

      // SOS ativo emitido pelo próprio usuário
      const mySos = list.find(
        (a) => a.userId === userId && (a.status === 'ativo' || a.status === 'em_atendimento')
      );
      setMyActiveSos(mySos || null);

      // Monitoramento de transição de socorristas para aviso imediato ao autor
      if (mySos && Array.isArray(mySos.responders)) {
        if (!sosBaselineDoneRef.current) {
          for (const r of mySos.responders) {
            seenResponderStatesRef.current.set(`${mySos.id}:${r.userId}`, r.state);
          }
          sosBaselineDoneRef.current = true;
        } else {
          for (const r of mySos.responders) {
            const key = `${mySos.id}:${r.userId}`;
            const prevState = seenResponderStatesRef.current.get(key);
            if (prevState !== r.state) {
              seenResponderStatesRef.current.set(key, r.state);
              if (r.state === 'a_caminho' || r.state === 'no_local') {
                if (
                  typeof window !== 'undefined' &&
                  'Notification' in window &&
                  Notification.permission === 'granted'
                ) {
                  try {
                    new Notification(`${r.name} está a caminho!`, {
                      body: 'Alguém respondeu ao seu SOS. Acompanhe no mapa.',
                      icon: '/brand/logo.png',
                    });
                  } catch {
                    // Fallback silencioso
                  }
                }
              }
            }
          }
        }
      }

      // SOS recebido de outro velejador (ainda não dispensado pelo usuário)
      const incoming = list.find(
        (a) =>
          a.userId !== userId &&
          (a.status === 'ativo' || a.status === 'em_atendimento') &&
          !dismissedSosIdsRef.current.has(a.id)
      );
      setIncomingSosAlert(incoming || null);
    } catch {
      // Falha temporária de rede
    }
  }, [api, isAuthenticated, userId]);

  const dismissIncomingSos = useCallback(() => {
    if (incomingSosAlert) {
      dismissedSosIdsRef.current.add(incomingSosAlert.id);
    }
    setIncomingSosAlert(null);
  }, [incomingSosAlert]);

  const respondToSos = useCallback(
    async (sosId: string, state: 'a_caminho' | 'nao_posso'): Promise<{ ok: boolean; error?: string }> => {
      try {
        let lat: number | undefined;
        let lng: number | undefined;
        if (lastKnownPosition && state === 'a_caminho') {
          lat = lastKnownPosition.lat;
          lng = lastKnownPosition.lng;
        }

        await api(`/api/sos/${sosId}/respond`, {
          method: 'POST',
          body: JSON.stringify({ state, lat, lng }),
        });
        await fetchActiveSos();
        return { ok: true };
      } catch (err) {
        console.error('[sos] Erro ao responder SOS:', err);
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Não foi possível registrar a resposta.',
        };
      }
    },
    [api, fetchActiveSos, lastKnownPosition]
  );

  const cancelMySos = useCallback(async () => {
    if (!myActiveSos) return;
    try {
      await api(`/api/sos/${myActiveSos.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelado', resolutionNote: 'Cancelado pelo autor' }),
      });
      setMyActiveSos(null);
      await fetchActiveSos();
    } catch (err) {
      console.error('[sos] Erro ao cancelar SOS:', err);
    }
  }, [api, myActiveSos, fetchActiveSos]);

  // Polling regular de SOS a cada 12 segundos quando logado
  useEffect(() => {
    if (!isAuthenticated) return;
    /*
     * FALSO POSITIVO da regra, verificado à mão: `fetchActiveSos` é `async` e todo
     * `setState` dela acontece DEPOIS do primeiro `await` — ou seja, nunca
     * síncrono dentro do corpo deste efeito. O React Compiler não enxerga
     * através da fronteira `async` e assume o pior.
     *
     * O QUE TORNARIA ISTO UM ERRO DE VERDADE: alguém acrescentar um `setState`
     * em `fetchActiveSos` ANTES do primeiro `await`. Se este comentário sobreviver a uma
     * mudança dessas, ele passa a mentir — confira a função antes de confiar.
     * (Foi exatamente esse o caso de `recarregar`, que tinha um reset síncrono
     * no ramo sem sessão e foi movido para o render.)
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver acima
    fetchActiveSos();
    const interval = setInterval(fetchActiveSos, 12000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchActiveSos]);

  return {
    myActiveSos,
    incomingSosAlert,
    allActiveSosList,
    dismissIncomingSos,
    respondToSos,
    cancelMySos,
    fetchActiveSos,
  };
}
