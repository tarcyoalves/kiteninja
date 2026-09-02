'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ESTADO_INICIAL_TRILHA,
  EstadoTrilha,
  marcarIndisponivel,
  processarAmostra,
} from './trilhaSessao';
import type { PontoTrilha } from './trilhaDownwind';
import { useAoMudar } from './useAoMudar';
import {
  CHAVE_TRILHA_EM_ANDAMENTO,
  desserializarTrilha,
  serializarTrilha,
  valePenaRecuperar,
} from './trilhaPersistida';

/**
 * Casca fina sobre `watchPosition`: toda decisão (aceitar/rejeitar amostra,
 * acumular distância, calcular velocidade) mora em `lib/trilhaSessao.ts`,
 * que é testável em Node puro. Este hook só liga o evento do navegador à
 * função pura `processarAmostra`.
 *
 * `enableHighAccuracy: true` aqui, ao contrário de `usePositionBeacon.ts`
 * (que usa `false` de propósito para poupar bateria, pois só precisa saber
 * a região para o SOS e roda o tempo todo). Aqui a conta é diferente:
 * velocidade e distância exigem precisão, e este hook só liga
 * `watchPosition` de alta precisão enquanto `ativo` é true — ou seja,
 * enquanto o Modo Navegação está de fato na tela. Isso é exatamente quando
 * a tela já está ligada por causa do Wake Lock (ver `useWakeLock.ts`) e o
 * velejador pediu para ver esses números: não há bateria extra sendo gasta
 * "de graça", o custo de `enableHighAccuracy` já está coberto pelo consumo
 * que a própria tela acesa da feature já implica.
 */
export interface TrilhaSessao {
  /** Distância acumulada em km desde o início da sessão. */
  distanciaKm: number;
  /** Velocidade atual em nós. `null` quando ainda não há leitura confiável. */
  velocidadeNos: number | null;
  /** Maior velocidade em nós observada na sessão. 0 se nenhuma ainda. */
  velocidadeMaxNos: number;
  /** Instante da última posição aceita. `null` se nenhuma ainda. */
  ultimaPosicaoEm: Date | null;
  /** true se o GPS não está disponível ou a permissão foi negada. */
  indisponivel: boolean;
  /**
   * Geometria da trilha (pontos aceitos, na ordem em que chegaram) — ver
   * `EstadoTrilha.pontos` em `lib/trilhaSessao.ts`. É o que `ModoNavegacao`
   * repassa em `ResumoNavegacao.trilha` ao sair, para o registro no logbook
   * (`paraPrefillLogbook`) ter uma geometria para reduzir e enviar.
   */
  pontos: PontoTrilha[];
  /**
   * Trilha de uma sessão anterior que ficou salva no aparelho porque o app
   * fechou antes de registrar — `null` quando não há nada a recuperar.
   *
   * NÃO é aplicada sozinha, de propósito. Retomar por conta própria correria
   * o risco de somar o velejo de ontem ao de hoje, e a distância errada iria
   * parar no histórico do velejador. Quem decide é ele, pelo aviso na tela.
   */
  recuperavel: { distanciaKm: number; velocidadeMaxNos: number; pontos: PontoTrilha[] } | null;
  /** Adota a trilha recuperada e continua dali. */
  retomar: () => void;
  /** Joga fora a trilha salva e segue com a sessão do zero. */
  descartar: () => void;
}

type TelemetriaTrilha = Omit<TrilhaSessao, 'recuperavel' | 'retomar' | 'descartar'>;

function paraTrilhaSessao(estado: EstadoTrilha): TelemetriaTrilha {
  const { distanciaKm, velocidadeNos, velocidadeMaxNos, ultimaPosicaoEm, indisponivel, pontos } = estado;
  return { distanciaKm, velocidadeNos, velocidadeMaxNos, ultimaPosicaoEm, indisponivel, pontos };
}

/**
 * De quanto em quanto tempo a trilha viva é copiada para o localStorage.
 *
 * Dez segundos, não a cada ponto: `localStorage.setItem` é síncrono e
 * bloqueia a thread principal, e o GPS entrega amostra a cada poucos
 * segundos. O custo de perder os últimos 10 s de trilha num fechamento
 * abrupto é irrelevante perto de travar a tela de telemetria durante o
 * velejo.
 */
const INTERVALO_SALVAR_MS = 10_000;

export function useTrilhaSessao(ativo: boolean): TrilhaSessao {
  const [estado, setEstado] = useState<EstadoTrilha>(ESTADO_INICIAL_TRILHA);
  // Guarda o estado bruto (com `ultimaReferencia`, que não faz parte do
  // retorno público) fora do React state para não expor esse campo interno
  // via `paraTrilhaSessao` a cada leitura, mantendo a interface pública
  // exatamente como especificada.
  const [recuperado, setRecuperado] = useState<EstadoTrilha | null>(null);
  const estadoRef = useRef(estado);
  // Em efeito, não no render — ver o mesmo caso comentado em
  // components/WindParticleLayer.tsx. O ref só é lido dentro do callback de
  // `watchPosition`, que roda bem depois do commit, então atualizar aqui não
  // atrasa nada.
  useEffect(() => {
    estadoRef.current = estado;
  }, [estado]);

  /*
   * Os dois ajustes SÍNCRONOS de estado saíram do efeito e vieram para o
   * render — ver lib/useAoMudar.ts.
   *
   * O reinício da trilha é o que mais importa aqui: em efeito, o Modo
   * Navegação reaberto pintava um quadro com a distância e a velocidade máxima
   * da sessão ANTERIOR antes de zerar. Numa tela cuja função é mostrar
   * telemetria de velejo, esse quadro é informação errada na cara do
   * velejador, não só um detalhe de performance.
   */
  useAoMudar(
    ativo,
    () => {
      if (!ativo) return;
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setEstado((atual) => marcarIndisponivel(atual));
        return;
      }
      // Sessão nova de navegação não herda distância/velocidade máxima de uma
      // sessão anterior que ficou fechada no meio do caminho. Se houver uma
      // trilha salva, ela fica em `recuperavel` e só entra se o velejador
      // mandar — ver o comentário do campo.
      setEstado(ESTADO_INICIAL_TRILHA);
      estadoRef.current = ESTADO_INICIAL_TRILHA;
      setRecuperado(lerTrilhaSalva());
    },
    { naMontagem: true }
  );

  /*
   * Cópia periódica para o aparelho.
   *
   * Sem isto, fechar o app apagava o velejo inteiro — e fechar o app não é
   * acidente raro nesse cenário, é o cenário: 2 h de GPS ativo drenam
   * bateria, o navegador de celular descarta aba em segundo plano, o celular
   * vive molhado no bolso. Ver lib/trilhaPersistida.ts.
   */
  useEffect(() => {
    if (!ativo || typeof window === 'undefined') return;

    const id = setInterval(() => {
      const atual = estadoRef.current;
      if (atual.pontos.length === 0) return;
      try {
        window.localStorage.setItem(
          CHAVE_TRILHA_EM_ANDAMENTO,
          serializarTrilha(atual, Date.now())
        );
      } catch {
        // Cota estourada ou storage bloqueado (janela anônima): perder o
        // backup é ruim, travar o velejo em andamento é pior.
      }
    }, INTERVALO_SALVAR_MS);

    return () => clearInterval(id);
  }, [ativo]);

  useEffect(() => {
    if (!ativo) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (posicao) => {
        const novoEstado = processarAmostra(estadoRef.current, {
          lat: posicao.coords.latitude,
          lng: posicao.coords.longitude,
          accuracy: posicao.coords.accuracy,
          speedMps: posicao.coords.speed,
          timestampMs: posicao.timestamp,
        });
        estadoRef.current = novoEstado;
        setEstado(novoEstado);
      },
      () => {
        // Permissão negada, sinal perdido de forma persistente, timeout: sinaliza
        // indisponibilidade sem apagar a distância já acumulada (ver
        // `marcarIndisponivel`).
        const novoEstado = marcarIndisponivel(estadoRef.current);
        estadoRef.current = novoEstado;
        setEstado(novoEstado);
      },
      // Sem `maximumAge`: aceitar fix em cache aqui reintroduziria o mesmo
      // problema que este hook existe para evitar (posições velhas
      // maquiadas de novas, inflando ou zerando velocidade). `timeout`
      // generoso porque um GPS de alta precisão em mar aberto pode demorar
      // mais para fechar um fix do que em terra.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [ativo]);

  const retomar = useCallback(() => {
    setRecuperado((salvo) => {
      if (salvo) {
        setEstado(salvo);
        estadoRef.current = salvo;
      }
      return null;
    });
    limparTrilhaSalva();
  }, []);

  const descartar = useCallback(() => {
    setRecuperado(null);
    limparTrilhaSalva();
  }, []);

  return {
    ...paraTrilhaSessao(estado),
    recuperavel: valePenaRecuperar(recuperado)
      ? {
          distanciaKm: recuperado!.distanciaKm,
          velocidadeMaxNos: recuperado!.velocidadeMaxNos,
          pontos: recuperado!.pontos,
        }
      : null,
    retomar,
    descartar,
  };
}

/** Leitura defensiva: storage bloqueado não pode derrubar o Modo Navegação. */
function lerTrilhaSalva(): EstadoTrilha | null {
  if (typeof window === 'undefined') return null;
  try {
    return desserializarTrilha(
      window.localStorage.getItem(CHAVE_TRILHA_EM_ANDAMENTO),
      Date.now()
    );
  } catch {
    return null;
  }
}

export function limparTrilhaSalva(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CHAVE_TRILHA_EM_ANDAMENTO);
  } catch {
    // idem
  }
}
