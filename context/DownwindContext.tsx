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
  obterStatusTrackingNativo,
  abrirConfiguracoesBateria,
  type TrackingStatus,
} from '../lib/downwindTracker';
import { useAoMudar } from '../lib/useAoMudar';
import { mapaMostraDownwind } from '../lib/activity';
import { useKiteData } from './KiteDataContext';
import { DISTANCIA_MINIMA_PARA_REGISTRO_KM } from '../lib/trilhaSessao';

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
  distanciaKm?: number;
  velocidadeMaxNos?: number;
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
  /**
   * A aba Mapa deve mostrar a tela do downwind em vez do mapa normal.
   *
   * Composto por `mapaMostraDownwind` (lib/activity.ts): travessia em
   * andamento entra sozinha; downwind agendado só entra a pedido. Vive no
   * contexto porque três telas dependem dele — app/page.tsx decide o que
   * renderizar, e MapView e EventsAndAlertsView é que pedem a abertura.
   */
  mostrarTelaDoDownwind: boolean;
  /** "Abrir downwind" / "Entrar no Downwind": leva o agendado para a tela. */
  abrirTelaDoDownwind: () => void;
  /** Sair da tela do downwind agendado e voltar ao mapa normal. */
  fecharTelaDoDownwind: () => void;
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
  /** Telemetria operacional nativa para exibição na UI (posições pendentes, último envio, status de bateria). */
  trackingTelemetry: TrackingStatus | null;
  /** Abre as configurações de bateria do Android para selecionar "Sem restrições". */
  abrirConfiguracoesBateria: () => Promise<boolean>;
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
    resumo?: {
      distanciaKm?: number;
      velocidadeMaxNos?: number;
      /** Pontos [lat, lng, tsMs] medidos pelo próprio aparelho — vão para
       *  `downwind_participantes.trilha_reduzida`, que alimenta o resumo. */
      trilhaReduzida?: Array<[number, number, number]>;
    }
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
  /*
   * DownwindProvider é montado DENTRO de KiteDataProvider (ver app/page.tsx),
   * então ler o logbook daqui é legítimo — e é o que permite registrar o
   * velejo de quem teve a travessia encerrada por outra pessoa.
   */
  const { abrirLoggerComResumo } = useKiteData();
  const [downwindAtivo, setDownwindAtivo] = useState<DownwindAtivo | null>(null);
  const [carregando, setCarregando] = useState(true);
  /*
   * Abertura DELIBERADA do downwind agendado.
   *
   * Antes não existia: qualquer downwind devolvido por /api/downwind/ativo
   * tomava a aba Mapa, inclusive um marcado para daqui a três dias. Agora
   * `aberto` só toma a tela quando alguém pediu — e o pedido é este booleano.
   */
  const [abertoDeliberadamente, setAbertoDeliberadamente] = useState(false);
  const mostrarTelaDoDownwind = mapaMostraDownwind({
    downwind: downwindAtivo,
    abertoDeliberadamente,
  });
  const abrirTelaDoDownwind = useCallback(() => setAbertoDeliberadamente(true), []);
  const fecharTelaDoDownwind = useCallback(() => setAbertoDeliberadamente(false), []);

  /*
   * Trocar de downwind (ou ficar sem nenhum) zera o pedido de abertura: o
   * "sim, quero ver" foi dado para AQUELE downwind, e herdá-lo traria de volta
   * o sequestro da aba que esta correção elimina. Chave primitiva (o id), como
   * exige lib/useAoMudar.ts — objeto ali entra em laço infinito.
   */
  useAoMudar(downwindAtivo?.id ?? null, () => {
    setAbertoDeliberadamente(false);
  });

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
  const [trackingTelemetry, setTrackingTelemetry] = useState<TrackingStatus | null>(null);
  // Evita iniciar duas vezes em corridas de re-render (ex.: `recarregar()`
  // disparando de novo antes do primeiro `startTracking` resolver) — só
  // chama o plugin nativo quando o estado ligado/desligado realmente muda.
  const trackingLigadoRef = useRef(false);

  /*
   * Diagnóstico legível do rastreio nativo, mostrado na tela do downwind.
   */
  const [diagnosticoTracking, setDiagnosticoTracking] = useState<string | null>(
    estaNoAppNativo() ? null : 'Rodando como PWA/navegador — sem serviço nativo.'
  );

  // Reconciliação ao abrir o app / retornar do background (visibilitychange)
  useEffect(() => {
    if (!estaNoAppNativo()) return;

    const reconciliar = async () => {
      const status = await obterStatusTrackingNativo();
      if (!status) return;
      setTrackingTelemetry(status);

      const downwindId = downwindAtivo?.id;
      if (status.isServiceRunning && downwindId && status.downwindId === downwindId) {
        trackingLigadoRef.current = true;
        setStatusTrackingNativo('ativo');
        setDiagnosticoTracking('Serviço nativo ativo. Posição sendo compartilhada.');
      } else if (!status.isServiceRunning && trackingLigadoRef.current) {
        trackingLigadoRef.current = false;
        setStatusTrackingNativo('inativo');
        if (status.lastStopReason) {
          setDiagnosticoTracking(`Rastreio encerrado: ${status.lastStopReason}`);
        }
      }
    };

    reconciliar();

    const onVisChange = () => {
      if (document.visibilityState === 'visible') {
        reconciliar();
      }
    };

    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, [downwindAtivo?.id]);

  // Polling moderado de telemetria (a cada 12 segundos) enquanto houver downwind ativo no app nativo
  useEffect(() => {
    if (!estaNoAppNativo() || !downwindAtivo?.id || downwindAtivo.status !== 'em_andamento') {
      return;
    }

    const interval = setInterval(async () => {
      const status = await obterStatusTrackingNativo();
      if (status) {
        setTrackingTelemetry(status);
        if (status.isServiceRunning) {
          setStatusTrackingNativo('ativo');
        } else if (trackingLigadoRef.current) {
          trackingLigadoRef.current = false;
          setStatusTrackingNativo('inativo');
          if (status.lastStopReason) {
            setDiagnosticoTracking(`Rastreio encerrado: ${status.lastStopReason}`);
          }
        }
      }
    }, 12_000);

    return () => clearInterval(interval);
  }, [downwindAtivo?.id, downwindAtivo?.status]);

  /*
   * Decisão de rastreio derivada no RENDER, não recalculada dentro do efeito.
   * Assim ela também alimenta o texto de diagnóstico sem precisar virar
   * estado — ver `motivoNaoLigar` logo abaixo.
   */
  const idDw = downwindAtivo?.id ?? null;
  const papelDw = downwindAtivo?.minhaParticipacao.papel ?? null;
  const estadoDw = downwindAtivo?.minhaParticipacao.estado ?? null;
  const statusDw = downwindAtivo?.status ?? null;

  const deveRastrear = decidirTracking({
    isAuthenticated,
    papel: papelDw,
    downwindStatus: statusDw,
    participanteEstado: estadoDw,
    appNativo: estaNoAppNativo(),
  });

  /**
   * Por que o rastreio nativo NÃO deve ligar agora. Texto derivado, não
   * estado: depende só de valores que já estão no render, então guardá-lo em
   * `useState` significaria mantê-lo sincronizado à mão — e era isso que
   * obrigava a chamar `setDiagnosticoTracking` dentro do efeito.
   */
  const motivoNaoLigar = (() => {
    if (!estaNoAppNativo()) return 'Rodando como PWA/navegador — sem serviço nativo.';
    if (deveRastrear) return null;
    const motivo = !isAuthenticated
      ? 'sem sessão iniciada'
      : statusDw !== 'em_andamento'
        ? `downwind está "${statusDw ?? 'nenhum'}", não "em_andamento"`
        : papelDw !== 'velejador'
          ? `seu papel é "${papelDw}", e só velejador rastreia`
          : `sua participação está "${estadoDw}", precisa ser "confirmado" ou "navegando"`;
    return `Rastreio nativo não deve ligar agora: ${motivo}.`;
  })();

  // "Pedindo token…" é ajuste síncrono e vai no render; a chamada ao plugin
  // fica no efeito. Ver lib/useAoMudar.ts.
  useAoMudar(deveRastrear && idDw !== null, (antes) => {
    if (!antes && deveRastrear && idDw) {
      setDiagnosticoTracking('Pedindo token de rastreio ao servidor…');
    } else if (!deveRastrear) {
      // Limpa o diagnóstico da tentativa anterior; o texto de "não deve
      // ligar" passa a vir de `motivoNaoLigar`, derivado.
      setDiagnosticoTracking(null);
    }
  });

  useEffect(() => {
    if (!estaNoAppNativo()) return;

    const downwindId = idDw;

    if (deveRastrear && downwindId && !trackingLigadoRef.current) {
      trackingLigadoRef.current = true;
      iniciarTrackingNativo({
        downwindId,
        baseUrl: window.location.origin,
        obterToken: () => api<{ token: string }>(`/api/downwind/${downwindId}/tracking-token`, { method: 'POST' }),
      }).then((resultado) => {
        if (resultado.ok) {
          setStatusTrackingNativo('ativo');
          setDiagnosticoTracking('Serviço nativo iniciado. Procure a notificação "Rastreando downwind".');
          obterStatusTrackingNativo().then((st) => {
            if (st) setTrackingTelemetry(st);
          });
        } else {
          // Falhou: libera o ref para permitir nova tentativa
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
      obterStatusTrackingNativo().then((st) => {
        setStatusTrackingNativo('inativo');
        setDiagnosticoTracking('Rastreio nativo encerrado (travessia terminou ou você saiu).');
        if (st) setTrackingTelemetry(st);
      });
    }
  }, [deveRastrear, idDw]);

  /**
   * Guarda o último `downwindAtivo` visto, para reparar a TRANSIÇÃO.
   *
   * Ref e não estado: isto é memória entre duas respostas de `recarregar`,
   * não algo que a tela desenha. Como estado, entraria na cascata de renders
   * que o comentário de `recarregar` abaixo descreve.
   */
  const ultimoAtivoRef = useRef<DownwindAtivo | null>(null);

  /**
   * Downwind cuja participação EU encerrei — para não oferecer o logbook duas
   * vezes.
   *
   * O último participante a encerrar fecha o downwind inteiro (ver o UPDATE em
   * app/api/downwind/[id]/participantes/[userId]/route.ts). Nesse caso, a
   * mesma ação faz `/ativo` devolver null com a minha participação ainda
   * 'navegando' no snapshot anterior — o gatilho de "encerraram por mim"
   * dispararia por cima do logbook que a própria tela já abriu.
   */
  const encerradoPorMimRef = useRef<string | null>(null);

  /**
   * O organizador encerrou a travessia — e o meu velejo não pode sumir com ela.
   *
   * Busca o resumo (que `resumirEPurgar` acabou de gravar no servidor a partir
   * de `downwind_posicoes`), acha a minha linha e abre o logbook já preenchido,
   * exatamente como acontece para quem encerra a própria participação.
   *
   * NÃO abre para qualquer um: só para quem estava 'navegando' (apoio em terra
   * nunca chega a esse estado) e só acima da distância mínima de registro — a
   * mesma trava de `valePenaRegistrarSessao`, para um toque acidental no
   * Iniciar não virar um rascunho de velejo de 40 metros.
   *
   * Silencioso quando falha: quem acabou de sair da água não pode receber um
   * erro de rede no lugar do mapa. O resumo continua acessível pelo card do
   * evento.
   */
  const oferecerRegistroDoVelejo = useCallback(
    async (anterior: DownwindAtivo) => {
      try {
        const dados = await api<{
          downwind: {
            nome: string;
            iniciadoEm: string | null;
            encerradoEm: string | null;
            saida: { nome: string } | null;
            chegada: { nome: string } | null;
          };
          participantes: Array<{
            userId: string;
            distanciaKm: number | null;
            velocidadeMaxNos: number | null;
            trilhaReduzida: Array<[number, number, number]>;
          }>;
        }>(`/api/downwind/${anterior.id}/resumo`);

        const meu = dados.participantes.find((p) => p.userId === user?.id);
        const distanciaKm = meu?.distanciaKm ?? 0;
        if (!meu || distanciaKm < DISTANCIA_MINIMA_PARA_REGISTRO_KM) return;

        const inicio = dados.downwind.iniciadoEm
          ? new Date(dados.downwind.iniciadoEm)
          : new Date();
        const fim = dados.downwind.encerradoEm ? new Date(dados.downwind.encerradoEm) : new Date();
        const pad2 = (n: number) => String(n).padStart(2, '0');
        const saida = dados.downwind.saida?.nome || anterior.nome;
        const chegada = dados.downwind.chegada?.nome;

        abrirLoggerComResumo({
          distanceKm: Math.round(distanciaKm * 10) / 10,
          maxSpeedKnots: Math.round((meu.velocidadeMaxNos ?? 0) * 10) / 10,
          durationMinutes: Math.max(1, Math.round((fim.getTime() - inicio.getTime()) / 60000)),
          date: [inicio.getFullYear(), pad2(inicio.getMonth() + 1), pad2(inicio.getDate())].join('-'),
          startTime: `${pad2(inicio.getHours())}:${pad2(inicio.getMinutes())}`,
          trilhaReduzida: meu.trilhaReduzida ?? [],
          spotId: undefined,
          customSpotName: chegada ? `${saida} \u2192 ${chegada}` : saida,
          notes: `Downwind em grupo: ${dados.downwind.nome}`,
        });
      } catch {
        // Ver o bloco acima: falhar aqui não pode virar erro na cara de quem
        // acabou de sair da água.
      }
    },
    [abrirLoggerComResumo, user?.id]
  );

  const recarregar = useCallback(async () => {
    // Sem sessão não há o que buscar. O RESET de estado desse caso não mora
    // mais aqui: virou ajuste no render (`useAoMudar` de `isAuthenticated`),
    // porque como setState síncrono dentro desta função ele fazia qualquer
    // efeito que a chamasse cair na cascata de renders. Ver lib/useAoMudar.ts.
    if (!isAuthenticated) return;
    const minhaVersao = ++versaoRef.current;
    try {
      const data = await api<{ downwind: DownwindAtivo | null }>('/api/downwind/ativo');
      if (minhaVersao !== versaoRef.current) return;
      /*
       * O downwind sumiu enquanto eu ainda estava NAVEGANDO?
       *
       * Então quem encerrou foi outra pessoa — o organizador, ou o cancelamento
       * — e o meu velejo estava prestes a ir para o lixo. `/api/downwind/ativo`
       * só devolve 'aberto' e 'em_andamento', então quando o organizador
       * encerra, na varredura seguinte a tela do downwind simplesmente sai do
       * ar e volta o mapa normal.
       *
       * Até aqui, SÓ quem segurava "Encerrar velejo" no próprio aparelho tinha
       * o velejo registrado. Numa travessia de grupo — que é o ponto de um
       * downwind — bastava o organizador encerrar primeiro para todo o resto do
       * grupo perder o registro de 20 km de água, sem aviso nenhum.
       */
      const anterior = ultimoAtivoRef.current;
      ultimoAtivoRef.current = data.downwind;
      if (
        anterior &&
        data.downwind?.id !== anterior.id &&
        anterior.minhaParticipacao?.estado === 'navegando' &&
        encerradoPorMimRef.current !== anterior.id
      ) {
        void oferecerRegistroDoVelejo(anterior);
      }
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
    // `oferecerRegistroDoVelejo` é estável na prática (depende de
    // `abrirLoggerComResumo`, que é useCallback sem deps, e do id do usuário,
    // que só muda com login/logout — quando `isAuthenticated` já muda junto).
  }, [isAuthenticated, oferecerRegistroDoVelejo]);

  // Dica de abertura: Neon free suspende por inatividade e a primeira consulta
  // demora visivelmente. Sem isto, reabrir o PWA na praia mostraria as abas
  // normais por 1-3s antes do mapa aparecer, e o velejador acharia que perdeu
  // o downwind. O cache só pinta pixel — o servidor confirma ou desfaz.
  // A pintura otimista pelo cache é ajuste SÍNCRONO (leitura de localStorage)
  // e vai no render; `recarregar()` é I/O e continua no efeito abaixo. Em
  // efeito, a tela chegava a mostrar as abas normais por um quadro antes de
  // aplicar a dica — exatamente o pisca que este cache existe para evitar.
  // Ver lib/useAoMudar.ts.
  useAoMudar(
    isAuthenticated,
    () => {
      if (!isAuthenticated) {
        // Deslogou: limpa na hora. Em efeito, o mapa ao vivo da conta
        // anterior ficaria visível por um quadro depois do logout.
        setDownwindAtivo(null);
        setCarregando(false);
        return;
      }
      const dica = lerDica();
      if (!dica) return;
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
    },
    { naMontagem: true }
  );

  useEffect(() => {
    /*
     * FALSO POSITIVO da regra, verificado à mão: `recarregar` é `async` e todo
     * `setState` dela acontece DEPOIS do primeiro `await` — ou seja, nunca
     * síncrono dentro do corpo deste efeito. O React Compiler não enxerga
     * através da fronteira `async` e assume o pior.
     *
     * O QUE TORNARIA ISTO UM ERRO DE VERDADE: alguém acrescentar um `setState`
     * em `recarregar` ANTES do primeiro `await`. Se este comentário sobreviver a uma
     * mudança dessas, ele passa a mentir — confira a função antes de confiar.
     * (Foi exatamente esse o caso de `recarregar`, que tinha um reset síncrono
     * no ramo sem sessão e foi movido para o render.)
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver acima
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
        // Entrar é um pedido explícito de ver o downwind — sem isto, entrar
        // num downwind AGENDADO levaria a pessoa para a aba Mapa normal, já
        // que agendado não toma a tela sozinho.
        setAbertoDeliberadamente(true);
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

  /**
   * Encerra a MINHA participação, mandando o que o meu aparelho mediu.
   *
   * O `trilhaReduzida` faltava aqui — e essa ausência não aparecia em lugar
   * nenhum. A rota PATCH aceita o campo e grava em
   * `downwind_participantes.trilha_reduzida`; `GET /api/downwind/[id]/resumo`
   * lê a coluna e monta o resumo estilo Strava da travessia. Só que **nada no
   * app jamais enviava o campo**, então a coluna ficava NULL para todo mundo e
   * o resumo de qualquer downwind saía sem trilha nenhuma, para sempre.
   *
   * Mesma família de defeito que já apareceu meia dúzia de vezes nesta base: a
   * ponta que grava existe, a ponta que lê existe, e no meio não passa nada.
   */
  const encerrarMinhaParticipacao = useCallback(
    async (
      motivo: 'encerrado' | 'desistiu',
      resumo?: {
        distanciaKm?: number;
        velocidadeMaxNos?: number;
        /** Pontos [lat, lng, tsMs] medidos pelo próprio aparelho. */
        trilhaReduzida?: Array<[number, number, number]>;
      }
    ) => {
      if (!downwindAtivo || !user) return { ok: false, error: 'Nenhum downwind ativo.' };
      // Antes da chamada, não depois: o `recarregar()` lá embaixo é o que
      // observa a transição, e ele roda dentro desta mesma função.
      encerradoPorMimRef.current = downwindAtivo.id;
      try {
        await api(`/api/downwind/${downwindAtivo.id}/participantes/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            estado: motivo,
            distanciaKm: resumo?.distanciaKm,
            velocidadeMaxNos: resumo?.velocidadeMaxNos,
            trilhaReduzida: resumo?.trilhaReduzida,
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
        trackingTelemetry,
        abrirConfiguracoesBateria,
        diagnosticoTracking: diagnosticoTracking ?? motivoNaoLigar,
        mostrarTelaDoDownwind,
        abrirTelaDoDownwind,
        fecharTelaDoDownwind,
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
