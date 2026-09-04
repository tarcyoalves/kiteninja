'use client';

import React, { useCallback, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Ban, Car, Check, Copy, LifeBuoy, LogOut, Loader2, MessageCircle, Navigation, Octagon, Route, UserPlus, X, ChevronDown, ChevronUp, ChevronLeft, Settings, Radio } from 'lucide-react';
import { useDownwind } from '../context/DownwindContext';
import { useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';
import { useSosHold } from '../lib/useSosHold';
import { estadoDeSaidaVelejo } from '../lib/downwind';
import { useSplitArrastavel } from '../lib/useSplitArrastavel';
import { SplitDragHandle } from '../components/SplitDragHandle';
import { useDownwindPosicoes } from '../lib/useDownwindPosicoes';
import { DownwindChat } from '../components/DownwindChat';
import { ModoNavegacao } from '../components/ModoNavegacao';
import { DownwindFaixaInfo } from '../components/DownwindFaixaInfo';
import { DownwindParticipanteSheet } from '../components/DownwindParticipanteSheet';
import { derivarEstadoCompartilhamento } from '../lib/downwindStatusVisual';
import { ConvidarVelejadoresSheet } from '@/components/activity/ConvidarVelejadoresSheet';

// Leaflet é client-only — mesmo padrão de views/MapView.tsx.
const DownwindMapa = dynamic(
  () => import('../components/DownwindMapa').then((m) => m.DownwindMapa),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center bg-[#090e1a] text-cyan-400">
        <Loader2 size={28} className="animate-spin" />
      </div>
    ),
  }
);

/**
 * Tela do mapa ao vivo do downwind.
 *
 * Durante um downwind ativo, app/page.tsx mostra este componente dentro da aba
 * Mapa. O BottomNav permanece disponível e o beacon continua no provider
 * global, portanto trocar de aba não interrompe o rastreamento.
 */

/** Tempo de hold para confirmar "Encerrei o velejo" — mesmo padrão de
 * lib/useSosHold.ts, mas mais longo: sair da água é decisão, não reflexo. */
const HOLD_ENCERRAR_MS = 1500;

function usePressAndHold(duracaoMs: number, aoCompletar: () => void) {
  const [progresso, setProgresso] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inicio = useRef(0);
  const disparado = useRef(false);

  const iniciar = useCallback(() => {
    disparado.current = false;
    inicio.current = Date.now();
    setProgresso(0);
    timer.current = setInterval(() => {
      const p = Math.min((Date.now() - inicio.current) / duracaoMs, 1);
      setProgresso(p);
      if (p >= 1 && !disparado.current) {
        disparado.current = true;
        if (timer.current) clearInterval(timer.current);
        aoCompletar();
      }
    }, 16);
  }, [duracaoMs, aoCompletar]);

  const cancelar = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (!disparado.current) setProgresso(0);
  }, []);

  return { progresso, iniciar, cancelar };
}

export const DownwindAoVivoView: React.FC = () => {
  const {
    downwindAtivo,
    ultimaPosicaoEm,
    telaTravadaLigada,
    statusTrackingNativo,
    trackingTelemetry,
    abrirConfiguracoesBateria,
    diagnosticoTracking,
    iniciarDownwind,
    encerrarMinhaParticipacao,
    encerrarDownwind,
    cancelarDownwind,
    definirApoio,
    fecharTelaDoDownwind,
  } = useDownwind();
  const [participanteSelecionado, setParticipanteSelecionado] = useState<string | null>(null);
  const { myActiveSos, fetchActiveSos, abrirLoggerComResumo } = useKiteData();
  const { user, isAdmin, canModerateEvents } = useAuth();
  const [chatAberto, setChatAberto] = useState(false);
  const [convidarRidersAberto, setConvidarRidersAberto] = useState(false);
  // Link de 12h para apoio em terra sem conta (pedido do dono). O token só
  // existe nesta resposta e nesta tela — o banco guarda só o hash (mesmo
  // padrão de invites/downwind_convites em geral).
  const [convidarAberto, setConvidarAberto] = useState(false);
  const [gerandoLink, setGerandoLink] = useState(false);
  const [linkApoio, setLinkApoio] = useState<string | null>(null);
  const [erroLink, setErroLink] = useState<string | null>(null);
  const [linkCopiado, setLinkCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);
  const [mostrarDiagnostico, setMostrarDiagnostico] = useState(false);
  // Tela preta do Modo Navegação, sobreposta a este mapa — ver o botão
  // "Iniciar" abaixo. Sair dela volta para ESTE componente, não para o app
  // normal (é o pedido do dono: "ao destravar a tela, continua no mapa ao
  // vivo").
  const [modoNavegacaoAtivo, setModoNavegacaoAtivo] = useState(false);
  /** Ida ao servidor do botão "Iniciar" em curso — ver `iniciarTravessia`. */
  const [iniciandoTravessia, setIniciandoTravessia] = useState(false);
  /** Idem para "Tentar de novo" do rastreamento. */
  const [retomandoRastreio, setRetomandoRastreio] = useState(false);
  // Split mapa/chat exclusivo do apoio_terra (motorista), arrastável — ver
  // lib/useSplitArrastavel.ts. O velejador nunca usa isto.
  const splitApoio = useSplitArrastavel(50);

  // Só reporta/consulta posição quando o downwind de fato está em andamento
  // (aberto ainda não tem ninguém navegando) — ver lib/downwindAcesso.ts. O
  // GET de posições também pausa com o Modo Navegação por cima: ninguém está
  // olhando o mapa nesse estado, e manter o poll só gastaria invocação e
  // bateria numa travessia de horas. O POST do beacon NÃO pausa por isso —
  // é segurança, não UI.
  const emAndamento = downwindAtivo?.status === 'em_andamento';
  const { participantes, minhaTrilha } = useDownwindPosicoes(
    downwindAtivo?.id ?? null,
    !emAndamento || modoNavegacaoAtivo
  );

  const iniciarTravessia = useCallback(async () => {
    /*
     * TRAVA ENQUANTO ESPERA — o botão mais importante do app não pode ficar
     * mudo.
     *
     * `iniciarDownwind()` faz DUAS idas ao servidor (POST de status +
     * recarregar), o que no 4G da praia é segundos. Até aqui, durante esse
     * tempo o botão continuava com a cara de sempre: nada girava, nada
     * desabilitava, a tela não mudava. O dedo repete — e cada toque era outro
     * par de requisições, na hora em que a pessoa está entrando na água.
     *
     * O `if` no começo é a trava de verdade; o `disabled` do botão é o que
     * conta para quem está olhando. Os dois precisam existir: o estado do
     * React não muda antes do fim do clique atual, então dois toques muito
     * rápidos podem chegar os dois com o botão ainda habilitado.
     */
    if (iniciandoTravessia) return;
    setIniciandoTravessia(true);
    // Nunca bloqueia a entrada no Modo Navegação por erro de rede — o
    // velejador está indo para a água. Se a transição para em_andamento
    // falhar (ex.: já foi iniciado por outro velejador um instante antes,
    // que é no-op e não erro real), o poll seguinte já traz o estado certo.
    try {
      await iniciarDownwind();
    } finally {
      setIniciandoTravessia(false);
    }
    setModoNavegacaoAtivo(true);
  }, [iniciarDownwind, iniciandoTravessia]);

  const sos = useSosHold({
    hasActiveSos: Boolean(myActiveSos),
    onSosTriggered: () => fetchActiveSos(),
  });

  const gerarLinkApoio = useCallback(async () => {
    if (!downwindAtivo) return;
    setConvidarAberto(true);
    setGerandoLink(true);
    setErroLink(null);
    setLinkCopiado(false);
    try {
      const res = await fetch(`/api/downwind/${downwindAtivo.id}/convites`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? 'Não foi possível gerar o link.');
      const url = `${window.location.origin}/dw-motorista/${body.token}`;
      setLinkApoio(url);
    } catch (err) {
      setErroLink(err instanceof Error ? err.message : 'Falha de conexão.');
    } finally {
      setGerandoLink(false);
    }
  }, [downwindAtivo]);

  const copiarLinkApoio = useCallback(() => {
    if (!linkApoio) return;
    navigator.clipboard?.writeText(linkApoio).then(
      () => {
        setLinkCopiado(true);
        setTimeout(() => setLinkCopiado(false), 2000);
      },
      () => {
        // Clipboard indisponível (contexto não-seguro, permissão negada): o
        // link continua selecionável na tela, só a cópia automática falha.
      }
    );
  }, [linkApoio]);

  const calcularMetricasTrilha = (trilha: Array<[number, number, number]>) => {
    if (!trilha || trilha.length < 2) {
      return { distanciaKm: 0, velocidadeMaxNos: 0, duracaoMinutos: 0, iniciadoEm: null };
    }
    let distTotalKm = 0;
    let maxSpeedKnots = 0;
    for (let i = 1; i < trilha.length; i++) {
      const [lat1, lng1, t1] = trilha[i - 1];
      const [lat2, lng2, t2] = trilha[i];
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const dKm = R * c;
      distTotalKm += dKm;

      const dtHours = (t2 - t1) / 3_600_000;
      if (dtHours > 0 && dtHours <= 0.5) {
        const speedKnots = (dKm / 1.852) / dtHours;
        if (speedKnots < 50 && speedKnots > maxSpeedKnots) {
          maxSpeedKnots = speedKnots;
        }
      }
    }
    const tInicio = trilha[0][2];
    const tFim = trilha[trilha.length - 1][2];
    const duracaoMinutos = Math.max(1, Math.round((tFim - tInicio) / 60000));
    return {
      distanciaKm: Math.round(distTotalKm * 10) / 10,
      velocidadeMaxNos: Math.round(maxSpeedKnots * 10) / 10,
      duracaoMinutos,
      iniciadoEm: new Date(tInicio),
    };
  };

  // BUG CORRIGIDO (achado em produção): mandar sempre 'encerrado' fazia quem
  // ainda não tinha navegado (estado 'confirmado' — TODO apoio_terra, que
  // nunca tem botão Iniciar, e um velejador que entrou mas não tocou Iniciar)
  // receber 409 e ficar PRESO no takeover para sempre: essa transição só é
  // válida a partir de 'navegando'. estadoDeSaidaVelejo (lib/downwind.ts)
  // escolhe o alvo certo a partir do estado atual.
  const encerrarVelejo = useCallback(async () => {
    if (!downwindAtivo) return;
    const snapshotDownwind = { ...downwindAtivo };
    const alvo = estadoDeSaidaVelejo(snapshotDownwind.minhaParticipacao.estado ?? 'confirmado');
    const metricas = calcularMetricasTrilha(minhaTrilha ?? []);

    setProcessando(true);
    const res = await encerrarMinhaParticipacao(alvo);
    setProcessando(false);
    if (!res.ok) {
      setErro(res.error ?? 'Falha ao encerrar.');
      return;
    }

    // Se concluiu a travessia de fato, abre o logbook com dados reais de GPS
    if (alvo === 'encerrado') {
      const dataInicio = metricas.iniciadoEm || (snapshotDownwind.iniciadoEm ? new Date(snapshotDownwind.iniciadoEm) : new Date());
      const pad2 = (n: number) => String(n).padStart(2, '0');
      const date = [dataInicio.getFullYear(), pad2(dataInicio.getMonth() + 1), pad2(dataInicio.getDate())].join('-');
      const startTime = `${pad2(dataInicio.getHours())}:${pad2(dataInicio.getMinutes())}`;
      const spotSaida = snapshotDownwind.saida?.nome || 'Downwind';
      const spotChegada = snapshotDownwind.chegada?.nome;
      const duracaoCalculada = metricas.duracaoMinutos || Math.max(1, Math.round((Date.now() - dataInicio.getTime()) / 60000));

      abrirLoggerComResumo({
        distanceKm: metricas.distanciaKm || Math.round((snapshotDownwind.minhaParticipacao.distanciaKm || 0) * 10) / 10,
        maxSpeedKnots: metricas.velocidadeMaxNos || Math.round((snapshotDownwind.minhaParticipacao.velocidadeMaxNos || 0) * 10) / 10,
        durationMinutes: duracaoCalculada,
        date,
        startTime,
        trilhaReduzida: minhaTrilha ?? [],
        spotId: undefined,
        customSpotName: spotChegada ? `${spotSaida} → ${spotChegada}` : spotSaida,
        notes: `Downwind em grupo: ${snapshotDownwind.nome}`,
      });
    }
  }, [downwindAtivo, encerrarMinhaParticipacao, abrirLoggerComResumo, minhaTrilha]);

  const holdEncerrar = usePressAndHold(HOLD_ENCERRAR_MS, () => {
    try {
      navigator.vibrate?.(200);
    } catch {
      // vibração é cortesia
    }
    encerrarVelejo();
  });

  if (!downwindAtivo) return null;
  const { minhaParticipacao } = downwindAtivo;
  const souOrganizador = minhaParticipacao.ehOrganizador;

  return (
    <div className="flex flex-col app-viewport relative overflow-hidden bg-[#090e1a] pb-[var(--nav-h)]">
      {/* Cabeçalho: nome do downwind + status, sempre visível — é o que
          lembra o velejador de que ele está preso nesta tela e por quê. */}
      <div className="shrink-0 px-4 py-3 bg-[#0F172A] border-b border-slate-800 flex items-center justify-between">
        <div className="min-w-0 flex items-center gap-2">
          {/*
            * SAÍDA DO DOWNWIND AGENDADO.
            *
            * Só existe enquanto `aberto`. Antes não precisava: qualquer
            * downwind sequestrava a aba Mapa e não havia de onde sair. Agora
            * o agendado só entra a pedido, então precisa de porta de volta —
            * abrir para conferir o ponto de encontro não pode custar o mapa.
            *
            * Em andamento o botão some de propósito: sair da travessia é
            * outra coisa (o botão de segurar "Sair do downwind", que muda a
            * participação de verdade), e oferecer uma saída fácil aqui faria
            * o velejador achar que largou o downwind quando não largou.
            */}
          {downwindAtivo.status === 'aberto' && (
            <button
              type="button"
              onClick={fecharTelaDoDownwind}
              className="shrink-0 p-2 -ml-1 rounded-full text-slate-400 hover:text-white hover:bg-white/5 active:scale-95 transition-all"
              aria-label="Voltar ao mapa"
              title="Voltar ao mapa"
            >
              <ChevronLeft size={20} />
            </button>
          )}
        <div className="min-w-0">
          <h2 className="font-black text-sm text-white truncate">{downwindAtivo.nome}</h2>
          <p className="text-[11px] text-slate-400">
            {downwindAtivo.status === 'aberto' ? 'Ainda não começou' : 'Downwind em andamento'} ·{' '}
            {minhaParticipacao.papel === 'velejador' ? 'Velejador' : 'Apoio em terra'}
            {souOrganizador ? ' · Organizador' : ''}
          </p>
        </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={`/dw-live/${downwindAtivo.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 active:scale-95 transition-all flex items-center justify-center"
            title="Abrir Telão Ao Vivo / Replay"
            aria-label="Abrir Telão Ao Vivo e Replay"
          >
            <Radio size={18} className="text-cyan-400 animate-pulse" />
          </a>

          {/* Apoio em terra não abre/fecha chat — ele já fica sempre visível
              na metade de baixo da tela (ver o split abaixo). Este botão só
              existe para o velejador. */}
          {minhaParticipacao.papel === 'velejador' && (
            <button
              type="button"
              onClick={() => setChatAberto(true)}
              className="shrink-0 p-2.5 rounded-full bg-slate-800 text-cyan-400 active:scale-95 transition-all"
              aria-label="Abrir chat do grupo"
            >
              <MessageCircle size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {downwindAtivo.status === 'aberto' && (
          <div className="absolute top-3 inset-x-4 z-[500] flex justify-center pointer-events-none">
            <div className="pointer-events-auto px-3.5 py-1.5 rounded-full bg-amber-500 text-slate-950 text-xs font-bold shadow-lg flex items-center gap-1.5 border border-amber-300">
              <Radio size={13} className="animate-pulse" />
              <span>Downwind agendado • Toque em Iniciar para começar a travessia</span>
            </div>
          </div>
        )}
        {user ? (
          (() => {
            const painelSheet =
              participanteSelecionado &&
              (() => {
                const alvo = participantes.find((p) => p.userId === participanteSelecionado);
                const eu = participantes.find((p) => p.userId === user.id);
                if (!alvo) return null;
                return (
                  <DownwindParticipanteSheet
                    participante={alvo}
                    meuUserId={user.id}
                    minhaPosicao={eu?.lat !== null && eu?.lat !== undefined && eu?.lng !== null && eu?.lng !== undefined ? { lat: eu.lat, lng: eu.lng } : null}
                    onFechar={() => setParticipanteSelecionado(null)}
                    onDefinirComoMeuApoio={async () => {
                      const res = await definirApoio(user.id, alvo.userId);
                      if (res.ok) setParticipanteSelecionado(null);
                      else setErro(res.error ?? 'Falha ao definir apoio.');
                    }}
                  />
                );
              })();

            const mapaEFaixa = (
              <>
                <DownwindMapa
                  meuUserId={user.id}
                  saida={downwindAtivo.saida}
                  chegada={downwindAtivo.chegada}
                  participantes={participantes}
                  minhaTrilha={minhaTrilha}
                  onSelecionarParticipante={setParticipanteSelecionado}
                  escondidoPeloModoNavegacao={modoNavegacaoAtivo}
                />
                <DownwindFaixaInfo
                  meuUserId={user.id}
                  saida={downwindAtivo.saida}
                  chegada={downwindAtivo.chegada}
                  participantes={participantes}
                />
                {painelSheet}
              </>
            );

            // Só o apoio_terra (motorista) ganha o split fixo — ele não tem
            // as mãos livres do velejador pra abrir/fechar um painel por
            // cima do mapa, então o chat fica sempre visível embaixo. O
            // velejador mantém o comportamento de sempre (mapa cheio +
            // chat como overlay opcional, ver chatAberto abaixo).
            if (minhaParticipacao.papel !== 'apoio_terra') return mapaEFaixa;

            return (
              <div ref={splitApoio.containerRef} className="w-full h-full flex flex-col">
                <div
                  className="relative overflow-hidden shrink-0"
                  style={{ height: `${splitApoio.alturaMapaPct}%` }}
                >
                  {mapaEFaixa}
                </div>

                <SplitDragHandle
                  handleProps={splitApoio.handleProps}
                  onAtalho={(alvo) => splitApoio.setAlturaMapaPct(alvo)}
                />

                <div className="relative flex-1 min-h-0">
                  <DownwindChat downwindId={downwindAtivo.id} />
                </div>
              </div>
            );
          })()
        ) : null}
      </div>

      {erro && (
        <div className="shrink-0 px-4 py-2 bg-rose-950/60 border-t border-rose-800/50 text-rose-300 text-xs">
          {erro}
        </div>
      )}

      {/* Faixa de ações fixa. SOS sempre acessível (segurar 800ms), Encerrar
          velejo exige segurar 1500ms — decisão de produto (ver useSosHold e
          o comentário de trava real em context/DownwindContext.tsx). */}
      <div className="shrink-0 px-4 py-3 bg-[#0F172A] border-t border-slate-800 flex items-center justify-center gap-3 overlay-safe-bottom">
        {!myActiveSos && (
          <button
            type="button"
            onPointerDown={sos.startHold}
            onPointerUp={sos.cancelHold}
            onPointerCancel={sos.cancelHold}
            onPointerLeave={sos.cancelHold}
            disabled={sos.sending}
            className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-rose-950 border border-rose-700/60 text-rose-300 active:scale-95 transition-all"
            aria-label="Segurar para disparar SOS"
          >
            <LifeBuoy size={16} className={sos.sending ? 'animate-pulse' : undefined} />
            <span className="text-[10px] font-bold">{sos.sending ? '...' : 'SOS'}</span>
          </button>
        )}

        {/* "Iniciar" só existe para quem vai velejar — apoio em terra não
            entra na água, então a trava de tela não faz sentido para ele (ver
            docs/PLANO-DOWNWIND-MAPA.md). Some depois de acionado: reabrir o
            Modo Navegação é o botão de dentro dele mesmo (Travar). */}
        {minhaParticipacao.papel === 'velejador' && !modoNavegacaoAtivo && (
          <button
            type="button"
            onClick={iniciarTravessia}
            disabled={iniciandoTravessia}
            aria-busy={iniciandoTravessia}
            className="flex flex-col items-center gap-1 px-5 py-2.5 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-slate-950 active:scale-95 transition-all shadow-md shadow-cyan-500/20 disabled:opacity-70 disabled:active:scale-100"
            aria-label="Iniciar travessia e travar a tela"
          >
            {iniciandoTravessia ? (
              <Loader2 size={16} className="animate-spin stroke-[2.5]" />
            ) : (
              <Navigation size={16} className="fill-current stroke-[1.5]" />
            )}
            {/* Rótulo fixo: trocar o texto mudaria a largura do botão embaixo
                do dedo, que é como se perde um toque. Quem gira é o ícone. */}
            <span className="text-[10px] font-black">Iniciar</span>
          </button>
        )}

        {/* Rótulo e ícone dependem do estado real: quem já está 'navegando'
            está terminando a travessia (Navigation); quem ainda está
            'confirmado' — todo apoio_terra, ou velejador que não tocou
            Iniciar — está desistindo antes de sair (LogOut). O alvo enviado
            (estadoDeSaidaVelejo) segue a mesma distinção — ver o bug corrigido
            no comentário de encerrarVelejo acima. */}
        {(() => {
          const navegando = minhaParticipacao.estado === 'navegando';
          return (
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                holdEncerrar.iniciar();
              }}
              onPointerUp={holdEncerrar.cancelar}
              onPointerCancel={holdEncerrar.cancelar}
              onPointerLeave={holdEncerrar.cancelar}
              onContextMenu={(e) => e.preventDefault()}
              disabled={processando}
              // select-none (Tailwind) não cobre o menu de "Copiar/Buscar" que
              // o iOS abre num toque-e-segure — só -webkit-touch-callout
              // resolve isso (mesmo padrão de components/ModoNavegacao.tsx,
              // que já usa select-none + onContextMenu, mas nunca precisou
              // do callout porque é tela cheia sem texto por perto).
              style={{ WebkitTouchCallout: 'none' }}
              className="relative flex flex-col items-center gap-1 px-5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 active:scale-95 transition-all overflow-hidden select-none"
              aria-label={navegando ? 'Segurar para encerrar o velejo' : 'Segurar para sair do downwind'}
            >
              <div
                className="absolute inset-0 bg-cyan-500/30 origin-left transition-transform"
                style={{ transform: `scaleX(${holdEncerrar.progresso})` }}
              />
              {navegando ? <Navigation size={16} className="relative" /> : <LogOut size={16} className="relative" />}
              <span className="text-[10px] font-bold relative">
                {navegando ? 'Encerrar velejo' : 'Sair do downwind'}
              </span>
            </button>
          );
        })()}

        {/* Convidar velejadores: disponível apenas para organizadores e moderadores */}
        {(souOrganizador || isAdmin || canModerateEvents) &&
          downwindAtivo.status !== 'encerrado' &&
          downwindAtivo.status !== 'cancelado' && (
            <button
              type="button"
              onClick={() => setConvidarRidersAberto(true)}
              className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-cyan-300 hover:text-white active:scale-95 transition-all"
              aria-label="Convidar velejadores para o downwind"
            >
              <UserPlus size={16} />
              <span className="text-[10px] font-bold">Convidar</span>
            </button>
          )}

        {/* Link de 12h para apoio em terra sem conta — pedido do dono.
            Disponível enquanto o downwind ainda não terminou (aberto ou
            em_andamento); qualquer organizador pode gerar, reutilizável para
            vários motoristas com o MESMO link. */}
        {souOrganizador && (
          <button
            type="button"
            onClick={gerarLinkApoio}
            className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 active:scale-95 transition-all"
            aria-label="Gerar link de convite para apoio em terra"
          >
            <Car size={16} />
            <span className="text-[10px] font-bold">Convidar apoio</span>
          </button>
        )}

        {souOrganizador && downwindAtivo.status === 'aberto' && (
          // Cancelar só faz sentido ANTES de sair da praia: uma vez
          // 'em_andamento' há gente na água, e o caminho correto passa a ser
          // "Encerrar DW" (que exige todo mundo fora d'água primeiro).
          <button
            type="button"
            onClick={async () => {
              setProcessando(true);
              const res = await cancelarDownwind();
              setProcessando(false);
              if (!res.ok) setErro(res.error ?? 'Falha ao cancelar o downwind.');
            }}
            disabled={processando}
            className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 active:scale-95 transition-all"
            aria-label="Cancelar o downwind antes de começar"
          >
            <Ban size={16} />
            <span className="text-[10px] font-bold">Cancelar</span>
          </button>
        )}

        {souOrganizador && downwindAtivo.status === 'em_andamento' && (
          <button
            type="button"
            onClick={async () => {
              setProcessando(true);
              const res = await encerrarDownwind();
              setProcessando(false);
              if (!res.ok) setErro(res.error ?? 'Falha ao encerrar o downwind.');
            }}
            disabled={processando}
            className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-amber-950/60 border border-amber-700/50 text-amber-300 active:scale-95 transition-all"
            aria-label="Encerrar o downwind para todo o grupo"
          >
            <Octagon size={16} />
            <span className="text-[10px] font-bold">Encerrar DW</span>
          </button>
        )}
      </div>

      {/*
        Aviso honesto sobre o limite real do rastreamento. Enquanto o Wake
        Lock estiver ativo a tela não apaga e a posição continua saindo com o
        celular no colete; sem ele (navegador antigo, política do sistema,
        economia de bateria agressiva) o aparelho vai apagar a tela sozinho e
        o rastreamento pode parar. Em nenhum dos dois casos o app rastreia
        com o app FECHADO — isso exige Foreground Service nativo
        (docs/ANTIGRAVITY-FINDINGS.md, ANT-003). Dizer isso aqui é melhor do
        que deixar quem está na água acreditar numa cobertura que não existe.
      */}
      {downwindAtivo.status === 'em_andamento' && (() => {
        const estadoVisual = derivarEstadoCompartilhamento({
          isServiceRunning: statusTrackingNativo === 'ativo',
          statusTrackingNativo,
          telaTravadaLigada,
          telemetry: trackingTelemetry,
        });

        return (
          <div
            className={`mx-3 mb-3 p-3 rounded-2xl border text-xs leading-relaxed transition-all ${
              estadoVisual.cor === 'verde'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : estadoVisual.cor === 'amarelo'
                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
                  : estadoVisual.cor === 'vermelho'
                    ? 'bg-rose-500/10 border-rose-500/40 text-rose-200'
                    : 'bg-slate-800/60 border-slate-700 text-slate-300'
            }`}
            role="status"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    estadoVisual.cor === 'verde'
                      ? 'bg-emerald-400 animate-pulse'
                      : estadoVisual.cor === 'amarelo'
                        ? 'bg-amber-400'
                        : estadoVisual.cor === 'vermelho'
                          ? 'bg-rose-400'
                          : 'bg-slate-400'
                  }`}
                />
                <div className="min-w-0">
                  <p className="font-bold text-xs truncate text-white">{estadoVisual.titulo}</p>
                  {estadoVisual.detalhe && (
                    <p className="text-[11px] opacity-80 truncate">{estadoVisual.detalhe}</p>
                  )}
                </div>
              </div>

              {/* Botões discretos de ação / diagnóstico */}
              <div className="flex items-center gap-1.5 shrink-0">
                {estadoVisual.cor === 'vermelho' && (
                  <button
                    type="button"
                    // Mesma história do "Iniciar": ida ao servidor sem trava
                    // nem sinal na tela virava fila de requisições repetidas
                    // justamente quando a rede já está ruim (é por isso que o
                    // estado está vermelho).
                    onClick={async () => {
                      if (retomandoRastreio) return;
                      setRetomandoRastreio(true);
                      const res = await iniciarDownwind();
                      setRetomandoRastreio(false);
                      // Falhou de novo: agora diz. Antes o resultado era
                      // descartado e o botão parecia não ter feito nada.
                      if (!res.ok) setErro(res.error ?? 'Não foi possível retomar o rastreamento.');
                    }}
                    disabled={retomandoRastreio}
                    aria-busy={retomandoRastreio}
                    className="px-2 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 rounded-lg text-[10px] font-semibold transition-colors disabled:opacity-60 disabled:cursor-wait flex items-center gap-1"
                  >
                    {retomandoRastreio && <Loader2 size={10} className="animate-spin" />}
                    <span>Tentar de novo</span>
                  </button>
                )}
                {trackingTelemetry && !trackingTelemetry.batteryOptimizationIgnored && (
                  <button
                    type="button"
                    onClick={() => abrirConfiguracoesBateria()}
                    className="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 rounded-lg text-[10px] font-semibold transition-colors"
                    aria-label="Configurar bateria"
                  >
                    Bateria
                  </button>
                )}
                {trackingTelemetry && (
                  <button
                    type="button"
                    onClick={() => setMostrarDiagnostico(!mostrarDiagnostico)}
                    className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                    aria-label="Ver diagnóstico de rastreamento"
                  >
                    {mostrarDiagnostico ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                )}
              </div>
            </div>

            {/* Diagnóstico técnico colapsável */}
            {mostrarDiagnostico && trackingTelemetry && (
              <div className="mt-2.5 pt-2.5 border-t border-current/20 grid grid-cols-2 gap-1.5 text-[10px] font-mono opacity-90 animate-in fade-in">
                <div>
                  Fila offline:{' '}
                  <span className={trackingTelemetry.pendingCount > 0 ? 'text-amber-300 font-bold' : ''}>
                    {trackingTelemetry.pendingCount} pts
                  </span>
                </div>
                <div>
                  Último envio:{' '}
                  {trackingTelemetry.lastSuccessfulSendAt > 0
                    ? new Date(trackingTelemetry.lastSuccessfulSendAt).toLocaleTimeString()
                    : 'Aguardando'}
                </div>
                {trackingTelemetry.lastError && (
                  <div className="col-span-2 text-rose-300">
                    Status: {trackingTelemetry.lastError}
                  </div>
                )}
                {trackingTelemetry.droppedCount > 0 && (
                  <div className="col-span-2 text-amber-300">
                    Descartes (fila cheia): {trackingTelemetry.droppedCount}
                  </div>
                )}
                {diagnosticoTracking && (
                  <div className="col-span-2 text-slate-400">
                    {diagnosticoTracking}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {chatAberto && (
        <DownwindChat downwindId={downwindAtivo.id} onFechar={() => setChatAberto(false)} />
      )}

      {convidarAberto && (
        <div className="absolute inset-0 z-map-ui flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-xs p-3">
          <div className="w-full max-w-sm bg-[#0F172A] border border-slate-800 rounded-3xl shadow-2xl p-5 space-y-4 overlay-safe-bottom">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-sm text-white flex items-center gap-1.5">
                <Car size={16} className="text-cyan-400" />
                Link de apoio (12h)
              </h3>
              <button
                type="button"
                onClick={() => setConvidarAberto(false)}
                className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            {gerandoLink && (
              <div className="py-6 flex justify-center">
                <Loader2 size={24} className="animate-spin text-cyan-400" />
              </div>
            )}

            {!gerandoLink && erroLink && (
              <p className="text-xs text-rose-300">{erroLink}</p>
            )}

            {!gerandoLink && linkApoio && (
              <>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Compartilhe com quem for de carro. Válido por 12h, sem
                  precisar de conta — quem abrir vê o mapa ao vivo e o chat
                  do grupo, e o próprio carro aparece no mapa para os
                  velejadores.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={linkApoio}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-slate-200 text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={copiarLinkApoio}
                    className="shrink-0 w-11 h-11 rounded-xl bg-cyan-500 text-slate-950 flex items-center justify-center active:scale-95 transition-all"
                    aria-label="Copiar link"
                  >
                    {linkCopiado ? <Check size={18} /> : <Copy size={18} />}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {convidarRidersAberto && (
        <ConvidarVelejadoresSheet
          isOpen={convidarRidersAberto}
          onClose={() => setConvidarRidersAberto(false)}
          downwindId={downwindAtivo.id}
          downwindNome={downwindAtivo.nome}
        />
      )}

      {/* Sobreposto ao mapa inteiro (fixed inset-0 dentro do próprio
          componente). O mapa continua montado por baixo — sair daqui é
          instantâneo, sem remontar Leaflet nem recarregar tiles. */}
      {modoNavegacaoAtivo && (
        <ModoNavegacao
          rotuloSair="Voltar ao mapa"
          onSair={() => setModoNavegacaoAtivo(false)}
          ultimaPosicaoConfirmadaEm={ultimaPosicaoEm}
          downwindId={downwindAtivo.id}
        />
      )}
    </div>
  );
};
