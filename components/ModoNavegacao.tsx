'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Lock, LogOut, LifeBuoy, Phone, Siren, Unlock } from 'lucide-react';
import { estadoSinal } from '../lib/downwind';
import { useWakeLock } from '../lib/useWakeLock';
import { useTrilhaSessao } from '../lib/useTrilhaSessao';
import { useSosHold } from '../lib/useSosHold';
import { useKiteData } from '../context/KiteDataContext';

/**
 * Tela preta de navegação — mantém o app em primeiro plano com Wake Lock
 * durante uma travessia longa (kitesurf downwind, 1-3h, celular no colete),
 * para que lib/usePositionBeacon.ts continue reportando posição em vez de o
 * iOS matar o JS quando a tela apaga.
 *
 * Todo iPhone recente é OLED: preto puro (#000) apaga o pixel de verdade,
 * não é só estética escura. Por isso NADA aqui pode virar cinza, gradiente,
 * sombra ou área clara — cada pixel aceso é bateria a menos na travessia.
 *
 * DECISÃO — bloqueio de toque por padrão: o celular vai dentro do colete, e
 * sem bloqueio o próprio corpo do velejador apertaria botões sozinho (trocar
 * de aba, abrir modais, no pior caso disparar alguma ação). O desbloqueio
 * exige segurar ~1,5s com feedback visual de progresso (anel), o mesmo
 * princípio de lib/useSosHold.ts: tempo alto o suficiente para não ser
 * acidente de colete, curto o suficiente para não frustrar quem quer sair.
 *
 * DECISÃO — SOS dentro do modo bloqueado: NÃO existe. O atalho de SOS só
 * aparece depois de desbloquear a tela, usando o MESMO gesto de segurar
 * 800ms de lib/useSosHold.ts — este componente reaproveita aquele hook
 * inteiro (captura de geolocalização, POST /api/sos, estado de envio) em vez
 * de reimplementar o disparo, para não criar uma segunda fonte de verdade
 * para "o que acontece quando alguém dispara um SOS". Ficou de fora do
 * estado bloqueado porque disparo acidental de SOS é o pior desfecho
 * possível deste componente — assustar a comunidade toda por um toque de
 * colete é estritamente pior que o velejador precisar de dois gestos
 * deliberados (desbloquear, depois segurar o SOS) numa emergência real. Uma
 * emergência de verdade tipicamente também bloqueia manualmente o celular
 * primeiro (ver aviso abaixo) ou o velejador consegue os ~2s extra — o botão
 * físico do iPhone e a central 193/185 continuam sempre acessíveis fora do
 * app, de qualquer forma.
 *
 * DECISÃO — sair do modo é sempre um botão simples (sem hold): uma vez
 * desbloqueado, sair não tem o mesmo risco de disparo acidental que o SOS
 * (só devolve para a UI normal), então exigir outro segurar seria fricção
 * sem ganho de segurança.
 */

/** Tempo de toque contínuo para desbloquear a tela. Ver decisão acima. */
const DESBLOQUEIO_HOLD_MS = 1500;

/** Recalcula "há quanto tempo" o sinal foi visto pela última vez. Não precisa
 * ser mais frequente que isso — é um indicador de leitura, não um alerta. */
const RELOGIO_TICK_MS = 15_000;

/**
 * Pequeno hook local de "segurar para confirmar", usado aqui só para o
 * desbloqueio da tela (1500ms). O SOS NÃO usa este hook: ele usa
 * lib/useSosHold.ts diretamente, que já embute seu próprio press-and-hold de
 * 800ms junto com o disparo real (geolocalização + POST /api/sos) — ver
 * decisão no topo do arquivo.
 */
function usePressAndHold(duracaoMs: number) {
  const [progresso, setProgresso] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inicio = useRef(0);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const iniciar = useCallback(
    (aoCompletar: () => void) => {
      inicio.current = Date.now();
      setProgresso(0);
      timer.current = setInterval(() => {
        const decorrido = Date.now() - inicio.current;
        const p = Math.min(decorrido / duracaoMs, 1);
        setProgresso(p);
        if (p >= 1) {
          if (timer.current) clearInterval(timer.current);
          timer.current = null;
          aoCompletar();
        }
      }, 16); // ~60fps para o anel de progresso ser fluido
    },
    [duracaoMs]
  );

  const cancelar = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    setProgresso(0);
  }, []);

  return { progresso, iniciar, cancelar };
}

/** Anel de progresso minúsculo — SVG puro, sem preenchimento sólido, para
 * acender o mínimo de pixel possível enquanto ainda comunica "está
 * funcionando, continue segurando". */
function AnelProgresso({ progresso, tamanho = 64 }: { progresso: number; tamanho?: number }) {
  const raio = tamanho / 2 - 4;
  const circunferencia = 2 * Math.PI * raio;
  return (
    <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} className="rotate-[-90deg]">
      <circle
        cx={tamanho / 2}
        cy={tamanho / 2}
        r={raio}
        fill="none"
        stroke="#1e293b"
        strokeWidth={3}
      />
      <circle
        cx={tamanho / 2}
        cy={tamanho / 2}
        r={raio}
        fill="none"
        stroke="#22d3ee"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={circunferencia}
        strokeDashoffset={circunferencia * (1 - progresso)}
        style={{ transition: progresso === 0 ? 'stroke-dashoffset 0.15s ease-out' : undefined }}
      />
    </svg>
  );
}

interface ModoNavegacaoProps {
  /**
   * Sai do modo e devolve à UI normal. Sempre disponível após desbloquear.
   *
   * "UI normal" depende de quem monta este componente: a partir da aba Mapa
   * (views/MapView.tsx) é o mapa geral; a partir do mapa ao vivo do downwind
   * (views/DownwindAoVivoView.tsx) é ESSE mapa, não as abas do app — o
   * velejador continua "preso" na travessia (ver context/DownwindContext.tsx)
   * até encerrar de fato, só o Modo Navegação abre e fecha por cima.
   */
  onSair: () => void;
  /** Rótulo do botão "Sair". Default mantém o texto original do mapa geral. */
  rotuloSair?: string;
  /**
   * Instante do último POST de posição CONFIRMADO pelo servidor, quando o
   * downwind ao vivo está alimentando o indicador (em vez da trilha da sessão
   * local, `useTrilhaSessao`). É esse dado que quem acompanha em terra vê no
   * mapa — por isso o indicador de sinal aqui deve refletir o mesmo instante,
   * não um relógio local que pode estar adiantado em relação ao que o
   * servidor de fato recebeu. Sem esta prop, comportamento inalterado (usa a
   * trilha local, como sempre foi no mapa geral).
   */
  ultimaPosicaoConfirmadaEm?: Date | null;
}

export const ModoNavegacao: React.FC<ModoNavegacaoProps> = ({
  onSair,
  rotuloSair = 'Sair',
  ultimaPosicaoConfirmadaEm,
}) => {
  const { ativo: wakeLockAtivo, suportado: wakeLockSuportado } = useWakeLock(true);
  const trilha = useTrilhaSessao(true);

  // `myActiveSos`/`fetchActiveSos` vêm direto do contexto (mesma fonte que
  // components/SidebarDrawer.tsx usa), em vez de MapView.tsx repassar por
  // prop: MapView não precisa desse dado para nada além de montar este
  // componente, então receber por prop só criaria prop drilling sem
  // propósito. Ler do contexto aqui é o caminho mais curto e o mais
  // consistente com o resto do app.
  const { myActiveSos, fetchActiveSos } = useKiteData();
  const hasActiveSos = Boolean(myActiveSos);

  const sos = useSosHold({
    hasActiveSos,
    onSosTriggered: () => {
      fetchActiveSos();
    },
  });

  const [desbloqueado, setDesbloqueado] = useState(false);

  // A "tarja escura no rodapé" é um bug recorrente deste projeto e a causa é
  // sempre a mesma: `.app-shell` é `position: fixed` ancorado na viewport, e
  // quando `window.scrollY` sai de zero o shell fica preso a uma viewport
  // deslocada, sobrando uma faixa vazia embaixo — que persiste ao trocar de
  // aba, porque a rolagem é do documento e não da tela.
  //
  // Este overlay é um candidato natural a provocar isso: cobre a tela inteira
  // e é montado/desmontado no meio da navegação. Zeramos na ENTRADA (para não
  // herdar um deslocamento que já existia) e na SAÍDA (para não devolver o app
  // a uma viewport torta). É a mesma defesa que lib/useKeyboardVisible.ts já
  // aplica quando o teclado fecha.
  useEffect(() => {
    const zerarScroll = () => {
      if (typeof window === 'undefined') return;
      if (window.scrollY !== 0 || window.pageYOffset !== 0) {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      }
      if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
      if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
    };
    zerarScroll();
    return zerarScroll;
  }, []);
  const desbloqueio = usePressAndHold(DESBLOQUEIO_HOLD_MS);

  // Relógio próprio só para recalcular "há quanto tempo" sem depender de re-render
  // externo — o modo pode ficar aberto por horas sem nenhuma outra prop mudar.
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), RELOGIO_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // `ultimaPosicaoConfirmadaEm` (downwind ao vivo) tem prioridade sobre a
  // trilha local: é o instante que o SERVIDOR confirmou, e é isso que quem
  // acompanha em terra está vendo — ver comentário da prop acima.
  const { estado, minutosSemReportar } = estadoSinal(
    ultimaPosicaoConfirmadaEm !== undefined ? ultimaPosicaoConfirmadaEm : trilha.ultimaPosicaoEm,
    agora
  );

  const corSinal =
    estado === 'ok' ? 'text-emerald-400' : estado === 'atrasado' ? 'text-amber-400' : 'text-rose-400';
  const textoSinal =
    minutosSemReportar === null
      ? 'aguardando primeiro sinal'
      : minutosSemReportar < 1
        ? 'há poucos segundos'
        : `há ${Math.floor(minutosSemReportar)} min`;

  const confirmarDesbloqueio = () => {
    try {
      navigator.vibrate?.(200);
    } catch {
      // vibração é cortesia, nunca crítica
    }
    setDesbloqueado(true);
  };

  return (
    <div
      className="fixed inset-0 z-splash bg-black flex flex-col items-center justify-between overlay-safe-top overlay-safe-bottom select-none overflow-hidden"
      // `touchAction: none` mata rolagem e zoom por gesto; `overscrollBehavior`
      // impede que um arrasto aqui vire rolagem do documento por trás. As duas
      // coisas juntas são o que garante que este overlay NÃO desloque a
      // viewport — se `window.scrollY` sair de zero, o `.app-shell` (que é
      // `position: fixed`) fica ancorado numa viewport deslocada e sobra a
      // faixa escura no rodapé do iPhone, bug que já voltou mais de uma vez
      // neste projeto. Ver também o `zerarScroll` no efeito acima.
      style={{ touchAction: 'none', overscrollBehavior: 'none' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Topo: status do rastreamento — o essencial, nada além disso. */}
      <div className="flex flex-col items-center gap-1 pt-6 text-center px-6">
        <span className="text-[11px] font-bold tracking-wide text-slate-500">
          RASTREAMENTO {wakeLockAtivo ? 'ATIVO' : 'EM RISCO'}
        </span>
        <span className={`text-xs font-mono ${corSinal}`}>último sinal: {textoSinal}</span>

        {/* Honestidade obrigatória: se o wake lock não está garantido, o
            usuário não pode achar que está protegido por engano. */}
        {!wakeLockSuportado && (
          <p className="mt-2 max-w-[260px] text-[11px] leading-snug text-amber-400 flex items-start gap-1.5">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            Este iPhone não consegue travar a tela ligada automaticamente
            (precisa de iOS 16.4+). Ela pode apagar sozinha e o rastreamento
            para até você reabrir o app.
          </p>
        )}
        {wakeLockSuportado && !wakeLockAtivo && (
          <p className="mt-2 max-w-[260px] text-[11px] leading-snug text-amber-400 flex items-start gap-1.5">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            A trava de tela ainda não foi confirmada pelo navegador. Mantenha
            o app em primeiro plano.
          </p>
        )}
        {/* Honestidade obrigatória #2: se não há GPS, os números abaixo (e o
            sinal para quem acompanha em terra) não valem nada. A pessoa está
            confiando na tela, então isto precisa ser tão visível quanto os
            avisos de wake lock acima — não um detalhe discreto. */}
        {trilha.indisponivel && (
          <p className="mt-2 max-w-[260px] text-[11px] leading-snug text-rose-400 flex items-start gap-1.5">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            GPS indisponível ou permissão negada. Velocidade e distância
            abaixo não estão sendo medidas, e ninguém em terra sabe onde você
            está.
          </p>
        )}
        <p className="mt-1 max-w-[260px] text-[10px] leading-snug text-slate-600">
          O botão físico de bloquear o iPhone interrompe o rastreamento de
          qualquer forma — este modo só evita que a tela apague sozinha.
        </p>
      </div>

      {/* Centro: velocidade + distância (sempre visíveis, bloqueado ou não —
          é a informação que a pessoa entrou aqui para ver) e, abaixo, o
          cadeado (bloqueado) ou os atalhos pequenos (desbloqueado). Só
          tipografia, sem caixas nem fundo: cada pixel aceso é bateria a
          menos numa travessia de 3h. */}
      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-baseline gap-2 tabular-nums">
            <span className="text-7xl font-black text-slate-50 leading-none">
              {trilha.velocidadeNos === null ? '--' : trilha.velocidadeNos.toFixed(1)}
            </span>
            <span className="text-lg font-bold text-slate-500">nós</span>
          </div>

          <div className="flex items-center gap-5 text-center tabular-nums">
            <div className="flex flex-col items-center">
              <span className="text-xl font-bold text-slate-200">
                {trilha.distanciaKm.toFixed(1)}
              </span>
              <span className="text-[10px] font-bold tracking-wide text-slate-600">
                KM PERCORRIDOS
              </span>
            </div>
            <div className="w-px h-7 bg-slate-800" />
            <div className="flex flex-col items-center">
              <span className="text-xl font-bold text-slate-200">
                {trilha.velocidadeMaxNos.toFixed(1)}
              </span>
              <span className="text-[10px] font-bold tracking-wide text-slate-600">
                MÁX. NÓS
              </span>
            </div>
          </div>
        </div>

        {!desbloqueado ? (
          // O gesto de desbloqueio vive AQUI, no anel, e não no container da
          // tela inteira. Uma versão anterior ouvia o pointerdown no overlay
          // todo: qualquer toque prolongado em qualquer canto destravava — o
          // que anula o propósito do bloqueio, já que o celular prensado
          // dentro do colete mantém pressão contínua sobre a tela e
          // destravaria sozinho, expondo os botões (inclusive o de sair) a
          // toques acidentais no meio da navegação.
          <button
            type="button"
            className="relative flex items-center justify-center rounded-full"
            style={{ touchAction: 'none' }}
            aria-label="Segure para desbloquear a tela"
            onPointerDown={(e) => {
              // `preventDefault` evita que o iOS trate o segurar como seleção
              // de texto ou callout de contexto.
              e.preventDefault();
              desbloqueio.iniciar(confirmarDesbloqueio);
            }}
            onPointerUp={() => desbloqueio.cancelar()}
            onPointerCancel={() => desbloqueio.cancelar()}
            onPointerLeave={() => desbloqueio.cancelar()}
          >
            <AnelProgresso progresso={desbloqueio.progresso} />
            <Lock size={20} className="absolute text-slate-600" />
          </button>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-2 text-slate-500 text-[11px]">
              <Unlock size={13} />
              desbloqueado
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onSair}
                onPointerDown={(e) => e.stopPropagation()}
                className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 active:scale-95 transition-all"
                aria-label={rotuloSair}
              >
                <LogOut size={16} />
                <span className="text-[10px] font-bold">{rotuloSair}</span>
              </button>

              <button
                type="button"
                onClick={() => setDesbloqueado(false)}
                onPointerDown={(e) => e.stopPropagation()}
                className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 active:scale-95 transition-all"
                aria-label="Travar a tela novamente"
              >
                <Lock size={16} />
                <span className="text-[10px] font-bold">Travar</span>
              </button>

              {!hasActiveSos && (
                <div className="relative">
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      sos.startHold();
                    }}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      sos.cancelHold();
                    }}
                    onPointerCancel={(e) => {
                      e.stopPropagation();
                      sos.cancelHold();
                    }}
                    onPointerLeave={(e) => {
                      e.stopPropagation();
                      sos.cancelHold();
                    }}
                    disabled={sos.sending}
                    className={`relative flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl border active:scale-95 transition-all ${
                      sos.sending
                        ? 'bg-rose-950 border-rose-800/60 text-rose-400 cursor-wait'
                        : 'bg-rose-950 border-rose-700/60 text-rose-300'
                    }`}
                    aria-label="Segurar para disparar SOS"
                  >
                    <LifeBuoy size={16} className={sos.sending ? 'animate-pulse' : undefined} />
                    <span className="text-[10px] font-bold">{sos.sending ? '...' : 'SOS'}</span>
                  </button>
                  {sos.holdProgress > 0 && (
                    <div className="absolute -inset-1 pointer-events-none flex items-center justify-center">
                      <AnelProgresso progresso={sos.holdProgress} tamanho={72} />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Estado do SOS: já ativo, enviando, ou pronto para segurar.
                Só tipografia + um ícone pequeno — nada de card ou bloco de
                cor grande, para preservar o baixo consumo da tela preta. */}
            {hasActiveSos ? (
              <div className="flex items-center gap-1.5 text-rose-400">
                <Siren size={13} className="animate-pulse shrink-0" />
                <span className="text-[10px] font-bold">
                  SOS ativo — ajuda pode estar a caminho
                </span>
              </div>
            ) : sos.sending ? (
              <span className="text-[9px] text-rose-400">enviando SOS...</span>
            ) : (
              <span className="text-[9px] text-slate-700">segure o SOS para confirmar</span>
            )}

            {/* Erro de rede ao disparar: números de emergência para discagem
                direta, igual ao tratamento em components/SidebarDrawer.tsx. */}
            {sos.error && (
              <div className="flex flex-col items-center gap-1.5">
                <span className="max-w-[220px] text-center text-[10px] leading-snug text-rose-300">
                  {sos.error}
                </span>
                <div className="flex items-center gap-3">
                  <a
                    href="tel:193"
                    onPointerDown={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 text-[10px] font-bold text-rose-300"
                  >
                    <Phone size={11} />
                    193
                  </a>
                  <a
                    href="tel:185"
                    onPointerDown={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 text-[10px] font-bold text-amber-300"
                  >
                    <Phone size={11} />
                    185
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Rodapé: dica só enquanto bloqueado — depois de desbloquear, os
          botões já falam por si. */}
      <div className="pb-6 h-8 flex items-center justify-center">
        {!desbloqueado && (
          <span className="text-[10px] text-slate-700">segure para desbloquear</span>
        )}
      </div>
    </div>
  );
};
