'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useDownwindBeacon } from '../lib/useDownwindBeacon';
import { useWakeLock } from '../lib/useWakeLock';
import {
  decidirTracking,
  estaNoAppNativo,
  iniciarTrackingNativo,
  pararTrackingNativo,
} from '../lib/downwindTracker';

/**
 * Estado do mapa ao vivo do downwind — se o usuário está numa travessia agora.
 *
 * Contexto separado de KiteDataContext (780+ linhas, já cobrindo spots, feed,
 * chat, SOS e modais) de propósito: este domínio tem ciclo de vida próprio
 * (existe só enquanto há downwind ativo) e precisa ser lido de dentro do
 * Modo Navegação, que já lê KiteDataContext — por isso este provider entra
 * DENTRO do KiteDataProvider em app/page.tsx, nunca fora.
 *
 * DECISÃO DE PRODUTO: um downwind ativo permanece rastreado globalmente, mas
 * não sequestra a navegação principal. A aba Mapa mostra o mapa ao vivo e o
 * menu flutuante continua disponível para acessar chat, feed e demais áreas.
 * O beacon vive neste provider (não na tela do mapa), portanto trocar de aba
 * não interrompe o envio de posição durante a travessia.
 */

export type DownwindPapel = 'velejador' | 'apoio_terra';
export type DownwindParticipanteEstado = 'confirmado' | 'navegando' | 'encerrado' | 'desistiu';
export type DownwindStatus = 'aberto' | 'em_andamento' | 'encerrado' | 'cancelado';

export interface DownwindPonto {
  nome: string;
  lat: number;
  lng: number;
}

export interface MinhaParticipacaoDownwind {
  papel: DownwindPapel;
  estado: DownwindParticipanteEstado;
  ehOrganizador: boolean;
  apoioUserId: string | null;
}

export interface DownwindAtivo {
  id: string;
  nome: string;
  status: DownwindStatus;
  previstoPara: string | null;
  iniciadoEm: string | null;
  saida: DownwindPonto | null;
  chegada: DownwindPonto | null;
  minhaParticipacao: MinhaParticipacaoDownwind;
}

interface DownwindContextType {
  downwindAtivo: DownwindAtivo | null;
  /** Primeira resolução (GET /api/downwind/ativo) ainda em voo. */
  carregando: boolean;
  /** Último POST de posição confirmado; continua atualizando fora da aba Mapa. */
  ultimaPosicaoEm: Date | null;
  /**
   * A tela está travada ligada por causa da travessia. Quando `false` com um
   * downwind em andamento, o aparelho vai apagar a tela sozinho e o
   * rastreamento pode parar — a UI precisa poder avisar em vez de deixar o
   * velejador achar que está coberto.
   */
  telaTravadaLigada: boolean;
  /**
   * Estado mínimo do rastreamento nativo (Foreground Service Android via
   * lib/downwindTracker.ts). `null` em PWA/browser — lá o conceito não
   * existe, e a UI não deve tratar isso como erro. Dentro do app nativo,
   * `'permissao_negada'` é o único caso que precisa de aviso explícito ao
   * velejador: sem o serviço nativo, o rastreio só sobrevive enquanto o
   * beacon web + Wake Lock conseguirem manter a página viva (ver
   * lib/useDownwindBeacon.ts e lib/useWakeLock.ts) — ou seja, PARA se o app
   * for removido dos recentes.
   */
  statusTrackingNativo: 'inativo' | 'ativo' | 'permissao_negada' | null;
  /**
   * Frase legível dizendo em que ponto o rastreio nativo está — ou por que
   * não ligou. Existe para ser MOSTRADA na tela: sem cabo USB não há outro
   * jeito de saber onde o fluxo parou no aparelho do usuário.
   */
  diagnosticoTracking: string | null;
  entrarNoDownwind: (
    downwindId: string,
    papel?: DownwindPapel
  ) => Promise<{ ok: boolean; error?: string }>;
  iniciarDownwind: () => Promise<{ ok: boolean; error?: string }>;
  encerrarMinhaParticipacao: (
    motivo: 'encerrado' | 'desistiu',
    resumo?: { distanciaKm?: number; velocidadeMaxNos?: number }
  ) => Promise<{ ok: boolean; error?: string }>;
  encerrarDownwind: () => Promise<{ ok: boolean; error?: string }>;
  cancelarDownwind: () => Promise<{ ok: boolean; error?: string }>;
  /** Define (ou remove, com `null`) o carro de apoio de um velejador — o
   * próprio velejador escolhe o seu, e o organizador designa por todos. */
  definirApoio: (alvoUserId: string, apoioUserId: string | null) => Promise<{ ok: boolean; error?: string }>;
  recarregar: () => Promise<void>;
}

const DownwindContext = createContext<DownwindContextType | undefined>(undefined);

/** Só a dica visual da primeira tela — nunca autoriza nada sozinha (ver `carregando` abaixo). */
const CACHE_KEY = 'kiteninja_downwind_dica';
const CACHE_VALIDADE_MS = 12 * 60 * 60 * 1000;

interface DicaCache {
  id: string;
  nome: string;
  em: string;
}

function lerDica(): DicaCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DicaCache;
    if (!parsed?.id || !parsed?.em) return null;
    if (Date.now() - Date.parse(parsed.em) > CACHE_VALIDADE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function salvarDica(d: DicaCache | null) {
  if (typeof window === 'undefined') return;
  try {
    if (d) localStorage.setItem(CACHE_KEY, JSON.stringify(d));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // localStorage indisponível (Safari privado etc) não pode derrubar o app.
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    // Ver o mesmo comentário em context/KiteDataContext.tsx: dado de downwind
    // servido de cache velho mostraria travessia encerrada como ativa.
    cache: 'no-store',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : null;
    throw new Error(msg || 'Falha na requisição.');
  }
  return body as T;
}

export const DownwindProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useAuth();
  const [downwindAtivo, setDownwindAtivo] = useState<DownwindAtivo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const emAndamento = downwindAtivo?.status === 'em_andamento';
  const beacon = useDownwindBeacon(downwindAtivo?.id ?? null, emAndamento);

  /*
   * Wake Lock durante TODA a travessia, não só dentro do Modo Navegação.
   *
   * O relato que motivou isto: no Android, com o app em segundo plano, o
   * downwind deixava de ser monitorado. A causa não era só o beacon pausar
   * (corrigido em lib/useDownwindBeacon.ts) — era a tela apagar. Tela
   * apagada, o sistema congela a página e nenhum `setInterval` dispara;
   * o velejador some do mapa de quem acompanha em terra.
   *
   * O Wake Lock já existia, mas SÓ enquanto o Modo Navegação estava aberto
   * (components/ModoNavegacao.tsx). Quem entrava no downwind e ficava em
   * qualquer outra aba — ou só guardava o celular no colete — perdia a
   * proteção justamente por não estar olhando a tela.
   *
   * Fica aqui no provider, e não numa tela, pelo mesmo motivo do beacon:
   * trocar de aba não pode interromper o rastreamento. Solto assim que o
   * downwind sai de `em_andamento` (encerrar, desistir, cancelar), então a
   * tela volta ao normal sem exigir nada do usuário.
   *
   * NÃO substitui rastreio nativo: com o app FECHADO nada disto roda.
   * Ver docs/ANTIGRAVITY-FINDINGS.md (ANT-003).
   */
  const wakeLock = useWakeLock(emAndamento);
  // Evita que a resposta do GET sobrescreva um estado mais novo (ex.: acabou
  // de entrar num downwind) se as duas chegarem fora de ordem.
  const versaoRef = useRef(0);

  /*
   * Rastreamento nativo (Foreground Service Android) via lib/downwindTracker.ts.
   *
   * DECISÃO DE PRODUTO: liga automaticamente, sem ação extra do velejador,
   * assim que `decidirTracking()` for true — o mesmo espírito do beacon web
   * e do Wake Lock acima: a proteção não deveria depender de o usuário
   * lembrar de apertar um botão. Desliga nas mesmas condições descritas no
   * pedido: downwind encerra/cancela, participação encerra/desiste ou logout.
   * A desmontagem da WebView NÃO desliga o serviço: sobreviver ao app removido
   * dos recentes é justamente a função do Foreground Service.
   *
   * NÃO duplica o beacon web — ver o cabeçalho de lib/downwindTracker.ts.
   * Os dois convivem: o nativo é a rede de segurança para quando o app é
   * removido dos recentes, algo que nenhum código JS alcança.
   */
  const [statusTrackingNativo, setStatusTrackingNativo] = useState<
    'inativo' | 'ativo' | 'permissao_negada' | null
  >(estaNoAppNativo() ? 'inativo' : null);
  // Evita iniciar duas vezes em corridas de re-render (ex.: `recarregar()`
  // disparando de novo antes do primeiro `startTracking` resolver) — só
  // chama o plugin nativo quando o estado ligado/desligado realmente muda.
  const trackingLigadoRef = useRef(false);

  /*
   * Diagnóstico legível do rastreio nativo, mostrado na tela do downwind.
   *
   * POR QUE ISTO EXISTE: `statusTrackingNativo` era exposto pelo contexto e
   * NUNCA renderizado em lugar nenhum. Quando o dono relatou "continua sem
   * rastrear com a tela apagada", não havia como saber onde o fluxo parava —
   * se não era app nativo, se a decisão dava false, se o token falhava, se o
   * plugin rejeitava, ou se o serviço subia e morria depois. Sem cabo USB e
   * sem logcat, um agente não tem NENHUMA visibilidade do aparelho.
   *
   * Mesmo caminho já adotado para o FCM ("diag(push): mostra na tela por que
   * o registro não completa"): quando não dá para depurar de fora, o app
   * precisa dizer na própria tela o que está acontecendo.
   */
  const [diagnosticoTracking, setDiagnosticoTracking] = useState<string | null>(null);

  useEffect(() => {
    if (!estaNoAppNativo()) {
      setDiagnosticoTracking('Rodando como PWA/navegador — sem serviço nativo.');
      return;
    }

    const downwindId = downwindAtivo?.id ?? null;
    const papel = downwindAtivo?.minhaParticipacao.papel ?? null;
    const estadoParticipante = downwindAtivo?.minhaParticipacao.estado ?? null;
    const statusDw = downwindAtivo?.status ?? null;

    const deveRastrear = decidirTracking({
      isAuthenticated,
      papel,
      downwindStatus: statusDw,
      participanteEstado: estadoParticipante,
      appNativo: true,
    });

    if (deveRastrear && downwindId && !trackingLigadoRef.current) {
      trackingLigadoRef.current = true;
      setDiagnosticoTracking('Pedindo token de rastreio ao servidor…');
      iniciarTrackingNativo({
        downwindId,
        baseUrl: window.location.origin,
        obterToken: () => api<{ token: string }>(`/api/downwind/${downwindId}/tracking-token`, { method: 'POST' }),
      }).then((resultado) => {
        if (resultado.ok) {
          setStatusTrackingNativo('ativo');
          setDiagnosticoTracking('Serviço nativo iniciado. Procure a notificação "Rastreando downwind".');
        } else {
          // Falhou: libera o ref para permitir nova tentativa (ex.: revalidação
          // periódica trazendo o mesmo estado de novo) em vez de travar
          // silenciosamente "tentando" para sempre.
          trackingLigadoRef.current = false;
          setStatusTrackingNativo(resultado.permissaoNegada ? 'permissao_negada' : 'inativo');
          setDiagnosticoTracking(
            resultado.permissaoNegada
              ? 'Permissão de localização negada — o serviço nativo não pode iniciar.'
              : `Falha ao iniciar o serviço nativo: ${resultado.error ?? 'motivo desconhecido'}`
          );
        }
      });
    } else if (!deveRastrear && trackingLigadoRef.current) {
      trackingLigadoRef.current = false;
      pararTrackingNativo();
      setStatusTrackingNativo('inativo');
      setDiagnosticoTracking('Rastreio nativo encerrado (travessia terminou ou você saiu).');
    } else if (!deveRastrear) {
      // Diz QUAL condição barrou. Sem isso, "não rastreia" é indistinguível de
      // "não deveria rastrear ainda", e o relato vira adivinhação.
      const motivo = !isAuthenticated
        ? 'sem sessão iniciada'
        : statusDw !== 'em_andamento'
          ? `downwind está "${statusDw ?? 'nenhum'}", não "em_andamento"`
          : papel !== 'velejador'
            ? `seu papel é "${papel}", e só velejador rastreia`
            : `sua participação está "${estadoParticipante}", precisa ser "confirmado" ou "navegando"`;
      setDiagnosticoTracking(`Rastreio nativo não deve ligar agora: ${motivo}.`);
    }
  }, [
    isAuthenticated,
    downwindAtivo?.id,
    downwindAtivo?.status,
    downwindAtivo?.minhaParticipacao.papel,
    downwindAtivo?.minhaParticipacao.estado,
  ]);

  const recarregar = useCallback(async () => {
    if (!isAuthenticated) {
      setDownwindAtivo(null);
      setCarregando(false);
      return;
    }
    const minhaVersao = ++versaoRef.current;
    try {
      const data = await api<{ downwind: DownwindAtivo | null }>('/api/downwind/ativo');
      if (minhaVersao !== versaoRef.current) return;
      setDownwindAtivo(data.downwind);
      salvarDica(
        data.downwind ? { id: data.downwind.id, nome: data.downwind.nome, em: new Date().toISOString() } : null
      );
    } catch {
      // Falha de rede na checagem periódica não deve apagar um downwind que já
      // estava confirmado na tela — só a checagem em si falhou.
    } finally {
      if (minhaVersao === versaoRef.current) setCarregando(false);
    }
  }, [isAuthenticated]);

  // Dica de abertura: Neon free suspende por inatividade e a primeira consulta
  // demora visivelmente. Sem isto, reabrir o PWA na praia mostraria as abas
  // normais por 1-3s antes do mapa aparecer, e o velejador acharia que perdeu
  // o downwind. O cache só pinta pixel — o servidor confirma ou desfaz.
  useEffect(() => {
    const dica = lerDica();
    if (dica && isAuthenticated) {
      setDownwindAtivo((atual) =>
        atual ??
        ({
          id: dica.id,
          nome: dica.nome,
          status: 'em_andamento',
          previstoPara: null,
          iniciadoEm: null,
          saida: null,
          chegada: null,
          minhaParticipacao: {
            papel: 'velejador',
            estado: 'navegando',
            ehOrganizador: false,
            apoioUserId: null,
          },
        } satisfies DownwindAtivo)
      );
    }
    recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  /*
   * Revalida o downwind ativo ao voltar para o primeiro plano — mesma correção
   * e mesmo motivo do KiteDataContext (ver docs/BUG-SINCRONIZACAO-DADOS.md).
   *
   * Aqui o estado velho é ainda pior que no feed: `recarregar()` só rodava ao
   * logar e depois de ação do próprio usuário, então um downwind CANCELADO ou
   * ENCERRADO pelo organizador continuava na tela do participante como se
   * estivesse rolando — inclusive mantendo o Wake Lock aceso e o beacon
   * mandando posição para uma travessia que acabou.
   */
  useEffect(() => {
    if (!isAuthenticated) return;

    const revalidar = () => {
      if (!document.hidden) recarregar();
    };

    document.addEventListener('visibilitychange', revalidar);
    window.addEventListener('focus', revalidar);
    return () => {
      document.removeEventListener('visibilitychange', revalidar);
      window.removeEventListener('focus', revalidar);
    };
  }, [isAuthenticated, recarregar]);

  const entrarNoDownwind = useCallback(
    async (downwindId: string, papel: DownwindPapel = 'velejador') => {
      try {
        await api(`/api/downwind/${downwindId}/entrar`, {
          method: 'POST',
          body: JSON.stringify({ papel }),
        });
        // Busca o cabeçalho completo (nome, saída, chegada) em vez de montar
        // um objeto parcial aqui — evita duas fontes de verdade para o mesmo
        // formato de resposta.
        await recarregar();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Falha ao entrar no downwind.' };
      }
    },
    [recarregar]
  );

  const iniciarDownwind = useCallback(async () => {
    if (!downwindAtivo) return { ok: false, error: 'Nenhum downwind ativo.' };
    try {
      await api(`/api/downwind/${downwindAtivo.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ para: 'em_andamento' }),
      });
      await recarregar();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Falha ao iniciar.' };
    }
  }, [downwindAtivo, recarregar]);

  const encerrarMinhaParticipacao = useCallback(
    async (
      motivo: 'encerrado' | 'desistiu',
      resumo?: { distanciaKm?: number; velocidadeMaxNos?: number }
    ) => {
      if (!downwindAtivo || !user) return { ok: false, error: 'Nenhum downwind ativo.' };
      try {
        await api(`/api/downwind/${downwindAtivo.id}/participantes/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            estado: motivo,
            distanciaKm: resumo?.distanciaKm,
            velocidadeMaxNos: resumo?.velocidadeMaxNos,
          }),
        });
        await recarregar();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Falha ao encerrar.' };
      }
    },
    [downwindAtivo, user, recarregar]
  );

  const encerrarDownwind = useCallback(async () => {
    if (!downwindAtivo) return { ok: false, error: 'Nenhum downwind ativo.' };
    try {
      await api(`/api/downwind/${downwindAtivo.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ para: 'encerrado' }),
      });
      await recarregar();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Falha ao encerrar downwind.' };
    }
  }, [downwindAtivo, recarregar]);

  const definirApoio = useCallback(
    async (alvoUserId: string, apoioUserId: string | null) => {
      if (!downwindAtivo) return { ok: false, error: 'Nenhum downwind ativo.' };
      try {
        await api(`/api/downwind/${downwindAtivo.id}/participantes/${alvoUserId}`, {
          method: 'PATCH',
          body: JSON.stringify({ apoioUserId }),
        });
        await recarregar();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Falha ao definir apoio.' };
      }
    },
    [downwindAtivo, recarregar]
  );

  const cancelarDownwind = useCallback(async () => {
    if (!downwindAtivo) return { ok: false, error: 'Nenhum downwind ativo.' };
    try {
      await api(`/api/downwind/${downwindAtivo.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ para: 'cancelado' }),
      });
      await recarregar();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Falha ao cancelar downwind.' };
    }
  }, [downwindAtivo, recarregar]);

  return (
    <DownwindContext.Provider
      value={{
        downwindAtivo,
        carregando,
        ultimaPosicaoEm: beacon.ultimaPosicaoEm,
        telaTravadaLigada: wakeLock.ativo,
        statusTrackingNativo,
        diagnosticoTracking,
        entrarNoDownwind,
        iniciarDownwind,
        encerrarMinhaParticipacao,
        encerrarDownwind,
        cancelarDownwind,
        definirApoio,
        recarregar,
      }}
    >
      {children}
    </DownwindContext.Provider>
  );
};

export function useDownwind(): DownwindContextType {
  const ctx = useContext(DownwindContext);
  if (!ctx) throw new Error('useDownwind precisa estar dentro de DownwindProvider');
  return ctx;
}
