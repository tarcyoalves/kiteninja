'use client';

/**
 * Diário de velejos (lista, registrar, excluir) — quarta fatia da T17, saída
 * de `KiteDataContext.tsx` sem mudar comportamento: o corpo é o mesmo.
 *
 * `aoRegistrarPublico` é o carregador do feed do contexto: um velejo marcado
 * como público aparece no feed, então registrá-lo recarrega a lista de lá.
 * Chega por parâmetro para este arquivo não depender do contexto.
 */
import { useCallback, useState } from 'react';
import type { SessionLog } from '../types';
import { limparTrilhaSalva } from '../lib/useTrilhaSessao';
import { useAoMudar } from '../lib/useAoMudar';

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

const UUID_RE = /^[0-9a-f-]{36}$/i;

export function useDiario(args: {
  api: Api;
  isAuthenticated: boolean;
  aoRegistrarPublico: () => void;
}) {
  const { api, isAuthenticated, aoRegistrarPublico } = args;
  const [sessions, setSessions] = useState<SessionLog[]>([]);
  const loadSessions = useCallback(async () => {
    try {
      const data = await api<{ sessions: SessionLog[] }>('/api/sessions');
      setSessions(data.sessions);
    } catch {
      // Sem sessão de usuário ou sem rede: histórico fica vazio, sem travar a UI.
    }
  }, [api]);

  // Esvaziar o logbook ao deslogar é ajuste síncrono e vai no render — sem
  // isto a lista da conta anterior ficava visível por um quadro depois do
  // logout, que é justamente o que não pode acontecer. As cargas são I/O e
  // seguem no efeito. Ver lib/useAoMudar.ts.
  useAoMudar(isAuthenticated, () => {
    if (!isAuthenticated) setSessions([]);
  });

  const addSession = async (
    sessionData: Omit<SessionLog, 'id' | 'createdAt' | 'likesCount' | 'commentsCount'>
  ): Promise<{ ok: boolean; error?: string }> => {
    // spotId só é aceito pela rota se for o UUID real do banco; "outro"/vazio
    // vira null e a sessão fica com nome/local livres.
    const spotId = sessionData.spotId && UUID_RE.test(sessionData.spotId) ? sessionData.spotId : null;

    try {
      const created = await api<SessionLog>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          spotId,
          spotName: sessionData.spotName,
          spotLocation: sessionData.spotLocation,
          date: sessionData.date,
          startTime: sessionData.startTime,
          durationMinutes: sessionData.durationMinutes,
          discipline: sessionData.discipline,
          kiteSizeM2: sessionData.kiteSizeM2,
          boardModel: sessionData.boardModel,
          avgWindKnots: sessionData.avgWindKnots,
          maxGustKnots: sessionData.maxGustKnots,
          windDirection: sessionData.windDirection,
          tideCondition: sessionData.tideCondition,
          waterCondition: sessionData.waterCondition,
          rating: sessionData.rating,
          distanceKm: sessionData.distanceKm,
          maxSpeedKnots: sessionData.maxSpeedKnots,
          highestJumpM: sessionData.highestJumpM,
          notes: sessionData.notes,
          // `photoUrl` continua indo junto para quem ainda manda uma foto só
          // (ver o comentário em POST /api/sessions sobre bundle antigo).
          photoUrl: sessionData.photoUrl,
          fotoUrls: sessionData.fotoUrls,
          isPublic: sessionData.isPublic,
          trilhaReduzida: sessionData.trilhaReduzida,
        }),
      });
      setSessions((prev) => [{ ...created, likesCount: 0, commentsCount: 0 } as SessionLog, ...prev]);
      if (sessionData.isPublic) aoRegistrarPublico();
      /*
       * O velejo virou registro: a cópia de emergência da trilha no aparelho
       * cumpriu o papel e precisa sair. Sem isto, a próxima abertura do Modo
       * Navegação ofereceria "retomar" um velejo JÁ SALVO — e aceitar viraria
       * uma segunda sessão com a mesma distância no histórico.
       *
       * Só depois do `await` dar certo: se o servidor recusou, o backup é a
       * única cópia que resta e apagá-lo aqui perderia o velejo de vez.
       */
      limparTrilhaSalva();
      return { ok: true };
    } catch (err) {
      // Não feche o formulário nem apague o que foi digitado. Em conexão ruim
      // no spot, dizer "salvo" sem confirmação do servidor perde a sessão em
      // silêncio e destrói a confiança no Logbook.
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Não foi possível salvar o velejo.',
      };
    }
  };

  /**
   * Apaga um velejo do logbook.
   *
   * POR QUE DEVOLVE ERRO EM VEZ DE ENGOLIR
   *
   * A versão anterior era otimista e muda: sumia o card e, se o servidor
   * recusasse, chamava `loadSessions()`. A linha reaparecia sozinha, sem
   * mensagem nenhuma — e do lado de cá da tela isso é indistinguível de "o
   * app apagou e depois desapagou", ou de um bug de lista. Pior no 4G da
   * praia, onde a recusa mais comum é a rede, não a permissão.
   *
   * Mesma forma de `deleteEvent`, de propósito: quem chama decide o que
   * mostrar, e as duas exclusões do app se comportam igual.
   */
  const deleteSession = async (sessionId: string): Promise<{ ok: boolean; error?: string }> => {
    const anterior = sessions;
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    try {
      await api(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      return { ok: true };
    } catch (err) {
      // Restaura a lista que existia antes, e não `loadSessions()`: recarregar
      // custa uma volta na rede que acabou de falhar, e ainda apagaria um
      // velejo recém-criado que só existe aqui.
      setSessions(anterior);
      return { ok: false, error: err instanceof Error ? err.message : 'Não foi possível excluir.' };
    }
  };

  return { sessions, loadSessions, addSession, deleteSession };
}
