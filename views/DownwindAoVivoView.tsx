'use client';

import React, { useCallback, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Ban, Car, Check, Copy, LifeBuoy, LogOut, Loader2, MessageCircle, Navigation, Octagon, Route, X } from 'lucide-react';
import { useDownwind } from '../context/DownwindContext';
import { useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';
import { useSosHold } from '../lib/useSosHold';
import { estadoDeSaidaVelejo } from '../lib/downwind';
import { useSplitArrastavel } from '../lib/useSplitArrastavel';
import { SplitDragHandle } from '../components/SplitDragHandle';
import { useDownwindBeacon } from '../lib/useDownwindBeacon';
import { useDownwindPosicoes } from '../lib/useDownwindPosicoes';
import { DownwindChat } from '../components/DownwindChat';
import { ModoNavegacao } from '../components/ModoNavegacao';
import { DownwindFaixaInfo } from '../components/DownwindFaixaInfo';
import { DownwindParticipanteSheet } from '../components/DownwindParticipanteSheet';

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
 * Tela de takeover do mapa ao vivo do downwind.
 *
 * O mapa em si (marcadores, trilha) chega na Fase 5 — este componente já
 * carrega a estrutura definitiva: cabeçalho, ações de ciclo de vida (iniciar,
 * encerrar minha travessia, encerrar/cancelar o downwind do grupo pelo
 * organizador) e o chat privado do grupo (única saída sem encerrar).
 *
 * app/page.tsx renderiza isto NO LUGAR das abas normais, sem BottomNav,
 * enquanto `downwindAtivo` existir — ver a decisão de produto documentada em
 * context/DownwindContext.tsx.
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
    iniciarDownwind,
    encerrarMinhaParticipacao,
    encerrarDownwind,
    cancelarDownwind,
    definirApoio,
  } = useDownwind();
  const [participanteSelecionado, setParticipanteSelecionado] = useState<string | null>(null);
  const { myActiveSos, fetchActiveSos } = useKiteData();
  const { user } = useAuth();
  const [chatAberto, setChatAberto] = useState(false);
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
  // Tela preta do Modo Navegação, sobreposta a este mapa — ver o botão
  // "Iniciar" abaixo. Sair dela volta para ESTE componente, não para o app
  // normal (é o pedido do dono: "ao destravar a tela, continua no mapa ao
  // vivo").
  const [modoNavegacaoAtivo, setModoNavegacaoAtivo] = useState(false);
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
  const beacon = useDownwindBeacon(downwindAtivo?.id ?? null, emAndamento);
  const { participantes, minhaTrilha } = useDownwindPosicoes(
    downwindAtivo?.id ?? null,
    !emAndamento || modoNavegacaoAtivo
  );

  const iniciarTravessia = useCallback(async () => {
    // Nunca bloqueia a entrada no Modo Navegação por erro de rede — o
    // velejador está indo para a água. Se a transição para em_andamento
    // falhar (ex.: já foi iniciado por outro velejador um instante antes,
    // que é no-op e não erro real), o poll seguinte já traz o estado certo.
    await iniciarDownwind();
    setModoNavegacaoAtivo(true);
  }, [iniciarDownwind]);

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

  // BUG CORRIGIDO (achado em produção): mandar sempre 'encerrado' fazia quem
  // ainda não tinha navegado (estado 'confirmado' — TODO apoio_terra, que
  // nunca tem botão Iniciar, e um velejador que entrou mas não tocou Iniciar)
  // receber 409 e ficar PRESO no takeover para sempre: essa transição só é
  // válida a partir de 'navegando'. estadoDeSaidaVelejo (lib/downwind.ts)
  // escolhe o alvo certo a partir do estado atual.
  const encerrarVelejo = useCallback(async () => {
    const alvo = estadoDeSaidaVelejo(downwindAtivo?.minhaParticipacao.estado ?? 'confirmado');
    setProcessando(true);
    const res = await encerrarMinhaParticipacao(alvo);
    setProcessando(false);
    if (!res.ok) setErro(res.error ?? 'Falha ao encerrar.');
  }, [downwindAtivo, encerrarMinhaParticipacao]);

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
    <div className="flex flex-col app-viewport relative overflow-hidden bg-[#090e1a]">
      {/* Cabeçalho: nome do downwind + status, sempre visível — é o que
          lembra o velejador de que ele está preso nesta tela e por quê. */}
      <div className="shrink-0 px-4 py-3 bg-[#0F172A] border-b border-slate-800 flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="font-black text-sm text-white truncate">{downwindAtivo.nome}</h2>
          <p className="text-[11px] text-slate-400">
            {downwindAtivo.status === 'aberto' ? 'Ainda não começou' : 'Downwind em andamento'} ·{' '}
            {minhaParticipacao.papel === 'velejador' ? 'Velejador' : 'Apoio em terra'}
            {souOrganizador ? ' · Organizador' : ''}
          </p>
        </div>
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

      <div className="flex-1 min-h-0 relative">
        {downwindAtivo.status === 'aberto' ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-slate-500 bg-[#090e1a]">
            <Route size={40} className="opacity-40" />
            <p className="text-xs max-w-[240px] text-center">
              O downwind ainda não começou. O mapa ao vivo liga assim que a
              travessia iniciar.
            </p>
          </div>
        ) : user ? (
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
            className="flex flex-col items-center gap-1 px-5 py-2.5 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-slate-950 active:scale-95 transition-all shadow-md shadow-cyan-500/20"
            aria-label="Iniciar travessia e travar a tela"
          >
            <Navigation size={16} className="fill-current stroke-[1.5]" />
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
              disabled={processando}
              className="relative flex flex-col items-center gap-1 px-5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 active:scale-95 transition-all overflow-hidden"
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

      {/* Sobreposto ao mapa inteiro (fixed inset-0 dentro do próprio
          componente). O mapa continua montado por baixo — sair daqui é
          instantâneo, sem remontar Leaflet nem recarregar tiles. */}
      {modoNavegacaoAtivo && (
        <ModoNavegacao
          rotuloSair="Voltar ao mapa"
          onSair={() => setModoNavegacaoAtivo(false)}
          ultimaPosicaoConfirmadaEm={beacon.ultimaPosicaoEm}
          downwindId={downwindAtivo.id}
        />
      )}
    </div>
  );
};
