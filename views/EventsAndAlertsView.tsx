'use client';

import React, { useState, useRef, useCallback } from 'react';
import { useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';
import { useDownwind } from '../context/DownwindContext';
import {
  AlertTriangle,
  Calendar,
  ShieldAlert,
  Users,
  MapPin,
  Plus,
  CheckCircle2,
  Clock,
  Sparkles,
  Info,
  ChevronRight,
  Route,
  Trophy,
  Waves,
  X,
  Loader2,
  Trash2,
  RefreshCw,
  Lock,
  Globe,
  Link2,
  Check,
  Megaphone,
} from 'lucide-react';
import { eventoCasaComUf, ufsPresentes } from '../lib/uf';
import type { DownwindVisibilidade } from '../lib/downwindVisibilidade';
import { DownwindResumoModal } from '../components/DownwindResumoModal';
import { ParticipantesEventoSheet } from '../components/activity/ParticipantesEventoSheet';
import { devePuxarAtualizar, progressoPull } from '../lib/pullToRefresh';

export const EventsAndAlertsView: React.FC = () => {
  const {
    safetyAlerts,
    addSafetyAlert,
    events,
    toggleEventRegistration,
    inscricoesEmAndamento,
    deleteEvent,
    spots,
    beachMode,
    createDownwind,
    setActiveTab,
    setRiderIdAberto,
    refreshEventsAndAlerts,
  } = useKiteData();
  const { user, openAuthModal, canModerateEvents } = useAuth();
  const { entrarNoDownwind } = useDownwind();
  const [entrandoEmId, setEntrandoEmId] = useState<string | null>(null);
  const [linkCopiadoId, setLinkCopiadoId] = useState<string | null>(null);
  const [erroEntrar, setErroEntrar] = useState<string | null>(null);
  /** Downwind com geração de link de convite em voo — ver copiarLinkConvite. */
  const [gerandoConviteId, setGerandoConviteId] = useState<string | null>(null);

  /** Abre o mapa ao vivo do downwind numa página própria. */
  const abrirDownwindAoVivo = useCallback((id: string) => {
    window.location.href = `/dw-live/${id}`;
  }, []);

  /**
   * Gera e copia o link de convite. Mesmo endpoint do ConvidarVelejadoresSheet
   * — aqui é o atalho de uma toque, para quem acabou de criar o downwind e só
   * quer mandar no grupo do WhatsApp.
   */
  /**
   * Gera um convite por link e copia.
   *
   * DOIS DEFEITOS QUE ISTO CORRIGE
   *
   * (1) Cada toque criava um convite NOVO no banco
   * (`INSERT INTO downwind_user_invites`, sem reaproveitar nada). Sem trava e
   * sem nada girando na tela, o segundo toque durante a espera virava um
   * segundo token válido — e a área de transferência ficava com o último,
   * enquanto o primeiro seguia por aí, válido, sem ninguém saber.
   *
   * (2) A falha era muda: `catch {}` e um `return` no `!res.ok`. Sem rede, o
   * botão não fazia absolutamente nada — que é exatamente a queixa de "cliquei
   * e não respondeu". Agora o motivo aparece no mesmo aviso que o resto da
   * aba já usa.
   */
  const copiarLinkConvite = useCallback(async (id: string) => {
    if (gerandoConviteId) return;
    setErroEntrar(null);
    setGerandoConviteId(id);
    try {
      const res = await fetch(`/api/downwind/${id}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createLink: true, role: 'velejador' }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.token) {
        setErroEntrar(body?.error ?? 'Não foi possível gerar o link de convite.');
        return;
      }
      try {
        await navigator.clipboard.writeText(`${window.location.origin}/?dw_invite=${body.token}`);
        setLinkCopiadoId(id);
      } catch {
        // O convite EXISTE — só a cópia automática falhou (contexto não
        // seguro, permissão negada). Dizer isso importa: senão a pessoa
        // acha que não gerou e toca de novo, criando outro token.
        setErroEntrar('O convite foi criado, mas não consegui copiar. Use "Convidar velejadores".');
      }
    } catch {
      setErroEntrar('Sem conexão para gerar o link. Tente de novo.');
    } finally {
      setGerandoConviteId(null);
    }
  }, [gerandoConviteId]);

  const [apagandoId, setApagandoId] = useState<string | null>(null);
  const [resumoDownwindId, setResumoDownwindId] = useState<string | null>(null);
  /** Evento cuja lista de confirmados está aberta ({id, titulo}), ou null. */
  const [participantesDe, setParticipantesDe] = useState<{ id: string; titulo: string } | null>(null);

  /**
   * Pull-to-refresh (ANT-003): eventos/downwind e alertas mudam por ação de
   * OUTRA pessoa (alguém criou um downwind, apagou um evento, reportou um
   * alerta) e esta tela não tinha nenhum jeito de revalidar sem trocar de aba
   * e voltar. Mesmo gesto e mesmo helper puro do feed (lib/pullToRefresh.ts) —
   * ver justificativa de não usar polling em KiteDataContext.tsx,
   * refreshEventsAndAlerts.
   */
  const [puxando, setPuxando] = useState(false);
  const [progressoPullVisual, setProgressoPullVisual] = useState(0);
  const [atualizandoManual, setAtualizandoManual] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const toqueInicialRef = useRef<{ y: number; scrollTopNoInicio: number } | null>(null);

  const aoTocar = useCallback((e: React.TouchEvent) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    toqueInicialRef.current = { y: e.touches[0].clientY, scrollTopNoInicio: scroller.scrollTop };
  }, []);

  const aoMoverToque = useCallback((e: React.TouchEvent) => {
    const inicio = toqueInicialRef.current;
    if (!inicio) return;
    const delta = e.touches[0].clientY - inicio.y;
    if (inicio.scrollTopNoInicio <= 0 && delta > 0) {
      setPuxando(true);
      setProgressoPullVisual(progressoPull(delta));
    }
  }, []);

  const aoSoltarToque = useCallback(
    (e: React.TouchEvent) => {
      const inicio = toqueInicialRef.current;
      toqueInicialRef.current = null;
      setPuxando(false);
      setProgressoPullVisual(0);
      if (!inicio) return;
      const delta = e.changedTouches[0].clientY - inicio.y;
      if (devePuxarAtualizar(inicio.scrollTopNoInicio, delta)) {
        setAtualizandoManual(true);
        refreshEventsAndAlerts().finally(() => setAtualizandoManual(false));
      }
    },
    [refreshEventsAndAlerts]
  );

  const handleApagarEvento = async (eventId: string, titulo: string) => {
    if (!confirm(`Apagar "${titulo}"? Esta ação não pode ser desfeita.`)) return;
    setApagandoId(eventId);
    const res = await deleteEvent(eventId);
    setApagandoId(null);
    if (!res.ok) setErroEntrar(res.error ?? 'Não foi possível apagar o evento.');
  };

  const [activeSubTab, setActiveSubTab] = useState<'alertas' | 'eventos'>('alertas');
  const [isReportingAlert, setIsReportingAlert] = useState(false);

  // New downwind form state
  const [isCreatingDownwind, setIsCreatingDownwind] = useState(false);
  const [dwTitle, setDwTitle] = useState('');
  const [dwSpotSaidaId, setDwSpotSaidaId] = useState('');
  const [dwSpotChegadaId, setDwSpotChegadaId] = useState('');
  const [dwDataHora, setDwDataHora] = useState('');
  const [dwLocation, setDwLocation] = useState('');
  const [dwDescription, setDwDescription] = useState('');
  const [dwSaving, setDwSaving] = useState(false);
  /*
   * Começa em 'comunidade' — o oposto do padrão do servidor, e de propósito.
   *
   * O servidor fecha por omissão porque um campo ausente nunca pode publicar
   * a localização de um grupo (ver lib/downwindVisibilidade.ts). Aqui a
   * situação é outra: a pessoa tocou "Criar Downwind" na aba de EVENTOS, que
   * é a agenda pública do app — a intenção declarada é convidar gente. Foi
   * exatamente essa intenção que o padrão fechado frustrou em silêncio.
   *
   * A escolha continua explícita e visível antes de salvar; só o pré-marcado
   * mudou de lado.
   */
  const [dwVisibilidade, setDwVisibilidade] = useState<DownwindVisibilidade>('comunidade');
  /** Filtro de estado da agenda. `null` = todos. Ver lib/uf.ts. */
  const [ufFiltro, setUfFiltro] = useState<string | null>(null);
  const [notificandoId, setNotificandoId] = useState<string | null>(null);
  const [avisoEnviadoId, setAvisoEnviadoId] = useState<string | null>(null);

  /*
   * Derivado direto no render, sem useMemo: React 19 com o React Compiler
   * memoriza isto sozinho — ver docs/REACT19-REGRAS-COMPILADOR.md. `?? null`
   * porque `uf` é opcional no tipo (evento antigo, spot sem estado) e as
   * funções de lib/uf.ts distinguem ausente de vazio de propósito.
   */
  const ufsDisponiveis = ufsPresentes(events.map(e => ({ uf: e.uf ?? null })));
  const eventosVisiveis = events.filter(e => eventoCasaComUf(e.uf ?? null, ufFiltro));

  /**
   * Avisa os seguidores de que este downwind existe.
   *
   * Disparo ÚNICO — a trava real está no banco (`downwinds.notificado_em`,
   * UPDATE condicional com RETURNING), não aqui: dois aparelhos tocando ao
   * mesmo tempo precisam colidir no servidor, e estado de tela não atravessa
   * aparelho. Este `notificandoId` só evita o toque duplo no mesmo botão.
   */
  const notificarComunidade = useCallback(
    async (downwindId: string) => {
      setNotificandoId(downwindId);
      setErroEntrar(null);
      try {
        const res = await fetch(`/api/downwind/${downwindId}/notificar`, { method: 'POST' });
        const body = await res.json().catch(() => null);
        if (res.ok) {
          /*
           * O NÚMERO IMPORTA. A versão anterior ignorava o corpo da resposta e
           * marcava "avisado" em qualquer 200 — inclusive quando o aviso não
           * chegou a ninguém, que é o caso de quem ainda não tem seguidores.
           * "Avisei e ninguém veio" é indistinguível de "o botão não
           * funciona", e foi assim que o defeito chegou como relato.
           */
          const seguidores = Number(body?.seguidores ?? 0);
          if (seguidores === 0) {
            setErroEntrar(
              'Você ainda não tem seguidores para avisar. O downwind está na agenda de todo mundo — compartilhe o link de convite.'
            );
            return;
          }
          setAvisoEnviadoId(downwindId);
          await refreshEventsAndAlerts();
        } else {
          setErroEntrar(body?.error ?? 'Não foi possível avisar a comunidade.');
        }
      } catch {
        // Sem rede: o botão volta ao normal e a pessoa tenta de novo. Não
        // marcamos como enviado — dizer "avisamos" sem ter avisado é pior
        // que não ter botão.
      } finally {
        setNotificandoId(null);
      }
    },
    [refreshEventsAndAlerts]
  );
  const [dwError, setDwError] = useState<string | null>(null);

  // New alert form state
  const [alertTitle, setAlertTitle] = useState('');
  const [alertSpotName, setAlertSpotName] = useState(spots[0]?.name || 'Praia Ponta do Mel');
  const [alertSeverity, setAlertSeverity] = useState<'alerta' | 'perigo' | 'informativo'>('alerta');
  const [alertDesc, setAlertDesc] = useState('');

  const handleReportAlert = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuthModal();
      return;
    }

    addSafetyAlert({
      title: alertTitle,
      spotName: alertSpotName,
      severity: alertSeverity,
      description: alertDesc,
      reportedBy: user.name,
    });

    setIsReportingAlert(false);
    setAlertTitle('');
    setAlertDesc('');
    alert('Ocorrência de segurança enviada para a comunidade de velejadores!');
  };

  const handleCreateDownwind = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuthModal();
      return;
    }
    if (!dwSpotSaidaId) {
      setDwError('Escolha o spot de saída.');
      return;
    }
    if (!dwDataHora) {
      setDwError('Escolha a data e hora do downwind.');
      return;
    }
    const previstoPara = new Date(dwDataHora);
    if (Number.isNaN(previstoPara.getTime())) {
      setDwError('Data e hora inválidas.');
      return;
    }

    setDwError(null);
    setDwSaving(true);
    const res = await createDownwind({
      title: dwTitle,
      location: dwLocation,
      description: dwDescription,
      spotSaidaId: dwSpotSaidaId,
      spotChegadaId: dwSpotChegadaId || undefined,
      previstoPara: previstoPara.toISOString(),
      visibilidade: dwVisibilidade,
    });
    setDwSaving(false);

    if (!res.ok) {
      setDwError(res.error ?? 'Não foi possível criar o downwind.');
      return;
    }

    setIsCreatingDownwind(false);
    setDwTitle('');
    setDwSpotSaidaId('');
    setDwSpotChegadaId('');
    setDwDataHora('');
    setDwLocation('');
    setDwDescription('');
    setDwVisibilidade('comunidade');
    setActiveSubTab('eventos');
  };

  /**
   * Entra num downwind pelo card do evento e abre a aba Mapa. O mapa ao vivo
   * substitui somente o mapa comum; o menu flutuante e as demais abas continuam
   * acessíveis durante toda a travessia.
   */
  const handleEntrarDownwind = async (downwindId: string) => {
    if (!user) {
      openAuthModal();
      return;
    }
    setErroEntrar(null);
    setEntrandoEmId(downwindId);
    const res = await entrarNoDownwind(downwindId, 'velejador');
    setEntrandoEmId(null);
    if (!res.ok) {
      setErroEntrar(res.error ?? 'Não foi possível entrar no downwind.');
      return;
    }
    setActiveTab('mapa');
  };

  return (
    <div
      ref={scrollerRef}
      onTouchStart={aoTocar}
      onTouchMove={aoMoverToque}
      onTouchEnd={aoSoltarToque}
      className="flex flex-col min-h-full pb-24 p-3 space-y-4 max-w-lg mx-auto w-full"
    >
      {/* Indicador de puxar-para-atualizar — mesmo padrão do feed (FeedView.tsx),
          só ocupa espaço durante o gesto para não empurrar o layout no dia a dia. */}
      {(puxando || atualizandoManual) && (
        <div
          className="flex items-center justify-center text-cyan-400 transition-opacity"
          style={{ opacity: atualizandoManual ? 1 : progressoPullVisual }}
        >
          <RefreshCw
            size={18}
            className={progressoPullVisual >= 1 || atualizandoManual ? 'animate-spin' : ''}
          />
        </div>
      )}

      {/* Top Toggle between Alertas de Segurança and Eventos */}
      <div className="grid grid-cols-2 gap-2 bg-[#0F172A] p-1.5 rounded-2xl border border-slate-700/80 text-xs font-black shadow-lg">
        <button
          onClick={() => setActiveSubTab('alertas')}
          className={`py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
            activeSubTab === 'alertas'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <AlertTriangle size={15} />
          <span>Ocorrências ({safetyAlerts.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('eventos')}
          className={`py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
            activeSubTab === 'eventos'
              ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Calendar size={15} />
          <span>Eventos & Downwinds ({events.length})</span>
        </button>
      </div>

      {/* SUB-TAB 1: ALERTAS E OCORRÊNCIAS */}
      {activeSubTab === 'alertas' && (
        <div className="space-y-3">
          {/* Header Action Card */}
          <div
            className={`p-4 rounded-2xl border shadow-xl flex items-center justify-between transition-colors ${
              beachMode
                ? 'bg-[#020617] border-slate-800 text-white'
                : 'bg-[#1E293B] border-slate-700/80 text-slate-100'
            }`}
          >
            <div>
              <h3 className="font-black text-sm text-white flex items-center gap-1.5">
                <ShieldAlert size={18} className="text-amber-400" />
                <span>Segurança no Mar</span>
              </h3>
              <p className="text-xs text-slate-400">
                Redes de pesca, bancos rasos e apoio de resgate.
              </p>
            </div>

            <button
              onClick={() => setIsReportingAlert(true)}
              className="flex items-center gap-1 px-3.5 py-1.5 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black active:scale-95 shadow-md shadow-amber-500/20 transition-all"
            >
              <Plus size={14} className="stroke-[3]" />
              <span>Reportar</span>
            </button>
          </div>

          {/* New Alert Form Modal */}
          {isReportingAlert && (
            <div className="p-4 rounded-2xl bg-[#0F172A] text-white border border-amber-500/50 shadow-2xl space-y-3 animate-in fade-in">
              <h4 className="font-black text-sm text-amber-400 flex items-center gap-1.5">
                <AlertTriangle size={16} />
                <span>Nova Ocorrência de Segurança na Praia</span>
              </h4>

              <form onSubmit={handleReportAlert} className="space-y-2.5 text-xs">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">Título do Alerta</label>
                  <input
                    type="text"
                    value={alertTitle}
                    onChange={e => setAlertTitle(e.target.value)}
                    placeholder="Ex: Rede de pesca a 200m da arrebentação"
                    className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-semibold focus:outline-hidden focus:border-amber-400"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-300 font-bold mb-1">Spot Afetado</label>
                    <select
                      value={alertSpotName}
                      onChange={e => setAlertSpotName(e.target.value)}
                      className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-semibold"
                    >
                      {spots.map(s => (
                        <option key={s.id} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1">Gravidade</label>
                    <select
                      value={alertSeverity}
                      onChange={e =>
                        setAlertSeverity(e.target.value as 'alerta' | 'perigo' | 'informativo')
                      }
                      className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-black"
                    >
                      <option value="alerta">Alerta ⚠️</option>
                      <option value="perigo">Perigo Imediato 🚨</option>
                      <option value="informativo">Informativo ℹ️</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">Descrição Detalhada</label>
                  <textarea
                    value={alertDesc}
                    onChange={e => setAlertDesc(e.target.value)}
                    placeholder="Informe a localização exata, referências visuais e recomendações para os velejadores..."
                    className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white h-20 resize-none focus:outline-hidden focus:border-amber-400"
                    required
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsReportingAlert(false)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black shadow-md shadow-amber-500/20"
                  >
                    Enviar Alerta
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* List of Alerts */}
          {safetyAlerts.length === 0 && (
            /* Aqui o vazio é boa notícia, e dizer isso é melhor que espaço em branco. */
            <div className="p-6 rounded-2xl border border-slate-800 bg-[#1E293B]/50 text-center">
              <p className="font-black text-emerald-400">Nenhum alerta ativo</p>
              <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
                Nenhum perigo relatado nos spots agora. Viu água-viva, corrente forte
                ou entulho na areia? Registre acima para avisar a galera.
              </p>
            </div>
          )}
          {safetyAlerts.map(alert => (
            <div
              key={alert.id}
              className={`p-4 rounded-2xl border shadow-xl transition-colors space-y-2.5 ${
                alert.severity === 'perigo'
                  ? 'bg-rose-950/40 border-rose-500/40'
                  : alert.severity === 'alerta'
                  ? 'bg-amber-950/40 border-amber-500/40'
                  : 'bg-[#1E293B] border-slate-700/80'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">
                    {alert.severity === 'perigo' ? '🚨' : alert.severity === 'alerta' ? '⚠️' : 'ℹ️'}
                  </span>
                  <div>
                    <h4 className="font-black text-sm text-white">
                      {alert.title}
                    </h4>
                    <p className="text-xs text-slate-400 font-medium">
                      Spot: <strong className="text-cyan-400 font-bold">{alert.spotName}</strong>
                    </p>
                  </div>
                </div>

                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  {alert.status}
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                {alert.description}
              </p>

              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800">
                <span>Reportado por: {alert.reportedBy}</span>
                <span>{alert.timestamp}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SUB-TAB 2: EVENTOS E DOWNWINDS */}
      {activeSubTab === 'eventos' && (
        <div className="space-y-4">
          {isCreatingDownwind && (
            <div className="p-4 rounded-2xl bg-[#0F172A] text-white border border-cyan-500/50 shadow-2xl space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <h4 className="font-black text-sm text-cyan-400 flex items-center gap-1.5">
                  <Route size={16} />
                  <span>Novo Downwind</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setIsCreatingDownwind(false)}
                  className="text-slate-400 hover:text-white"
                  aria-label="Fechar"
                >
                  <X size={18} />
                </button>
              </div>

              {dwError && (
                <div className="flex items-center gap-2 p-2.5 bg-red-950/40 border border-red-500/40 rounded-xl text-red-300 text-xs font-medium">
                  <AlertTriangle size={14} className="text-red-400 shrink-0" />
                  <span>{dwError}</span>
                </div>
              )}

              <form onSubmit={handleCreateDownwind} className="space-y-2.5 text-xs">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">Nome do Downwind</label>
                  <input
                    type="text"
                    value={dwTitle}
                    onChange={e => setDwTitle(e.target.value)}
                    placeholder="Ex: Downwind Touros -> Ponta do Mel"
                    className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-semibold focus:outline-hidden focus:border-cyan-400"
                    maxLength={200}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-300 font-bold mb-1">Spot de Saída</label>
                    <select
                      value={dwSpotSaidaId}
                      onChange={e => setDwSpotSaidaId(e.target.value)}
                      className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-semibold"
                      required
                    >
                      <option value="">Selecione...</option>
                      {spots.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1">Spot de Chegada</label>
                    <select
                      value={dwSpotChegadaId}
                      onChange={e => setDwSpotChegadaId(e.target.value)}
                      className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-semibold"
                    >
                      <option value="">Ainda não sei</option>
                      {spots.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">Data e Hora</label>
                  <input
                    type="datetime-local"
                    value={dwDataHora}
                    onChange={e => setDwDataHora(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-semibold focus:outline-hidden focus:border-cyan-400"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">Região / Localização</label>
                  <input
                    type="text"
                    value={dwLocation}
                    onChange={e => setDwLocation(e.target.value)}
                    placeholder="Ex: Litoral Norte / RN"
                    className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-semibold focus:outline-hidden focus:border-cyan-400"
                    maxLength={200}
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">Descrição</label>
                  <textarea
                    value={dwDescription}
                    onChange={e => setDwDescription(e.target.value)}
                    placeholder="Percurso, ponto de encontro, apoio em terra..."
                    className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white h-20 resize-none focus:outline-hidden focus:border-cyan-400"
                    maxLength={5000}
                    required
                  />
                </div>

                {/*
                  * O SELETOR QUE FALTAVA.
                  *
                  * Sem ele, todo downwind criado por aqui nascia fechado (o
                  * DEFAULT da coluna) e não aparecia para mais ninguém — o
                  * relato que originou esta correção. O texto de cada opção
                  * diz a CONSEQUÊNCIA, não o nome interno do valor: "privado"
                  * e "comunidade" só significam alguma coisa para quem leu o
                  * schema.
                  */}
                <div>
                  <label className="block text-slate-300 font-bold mb-1.5">Quem pode ver</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDwVisibilidade('comunidade')}
                      aria-pressed={dwVisibilidade === 'comunidade'}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        dwVisibilidade === 'comunidade'
                          ? 'bg-cyan-500/15 border-cyan-400 text-white'
                          : 'bg-[#1E293B] border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 font-black">
                        <Globe size={13} className="text-cyan-400" />
                        Comunidade
                      </span>
                      <span className="block mt-0.5 text-[11px] leading-snug opacity-80">
                        Aparece na agenda de todo mundo
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDwVisibilidade('privado')}
                      aria-pressed={dwVisibilidade === 'privado'}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        dwVisibilidade === 'privado'
                          ? 'bg-amber-500/15 border-amber-400 text-white'
                          : 'bg-[#1E293B] border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 font-black">
                        <Lock size={13} className="text-amber-400" />
                        Fechado
                      </span>
                      <span className="block mt-0.5 text-[11px] leading-snug opacity-80">
                        Só quem receber o link entra
                      </span>
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsCreatingDownwind(false)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={dwSaving}
                    className="flex-1 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black shadow-md shadow-cyan-500/20 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {dwSaving && <Loader2 size={14} className="animate-spin" />}
                    <span>{dwSaving ? 'Criando...' : 'Criar Downwind'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/*
            * A <ListaDownwinds> ficava aqui e foi removida.
            *
            * Ela nasceu certa: downwind privado não gerava evento, então sem
            * ela quem criasse um não via nada — nem o próprio criador. Só que
            * a partir do momento em que todo downwind passou a ter evento
            * (ver o comentário em POST /api/downwind), as duas listas
            * desenhavam a MESMA travessia, uma em cada card, na mesma tela.
            *
            * Agora a agenda é a única superfície, e o card de evento carrega
            * o que só a lista mostrava: visibilidade, convite e aviso.
            */}
          {/*
            * FILTRO POR ESTADO — o eixo por onde esta tela escala.
            *
            * Só aparece quando há mais de um estado na agenda: com tudo no RN
            * (a situação de hoje), uma barra de filtros com um botão só é
            * ruído. Ela nasce sozinha quando o app chegar a Cumbuco e Búzios.
            *
            * As opções vêm do que EXISTE (`ufsPresentes`), não das 27 siglas:
            * oferecer "Acre" numa agenda sem eventos no Acre é dar um botão
            * que só sabe devolver lista vazia. Ver lib/uf.ts.
            */}
          {ufsDisponiveis.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
              <button
                type="button"
                onClick={() => setUfFiltro(null)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-black border transition-all ${
                  ufFiltro === null
                    ? 'bg-cyan-500 border-cyan-400 text-slate-950'
                    : 'bg-[#1E293B] border-slate-700 text-slate-400'
                }`}
              >
                Todos
              </button>
              {ufsDisponiveis.map(uf => (
                <button
                  key={uf}
                  type="button"
                  onClick={() => setUfFiltro(uf)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-black border transition-all ${
                    ufFiltro === uf
                      ? 'bg-cyan-500 border-cyan-400 text-slate-950'
                      : 'bg-[#1E293B] border-slate-700 text-slate-400'
                  }`}
                >
                  {uf}
                </button>
              ))}
            </div>
          )}

          {eventosVisiveis.length === 0 && (
            <div className="p-6 rounded-2xl border border-slate-800 bg-[#1E293B]/50 text-center">
              <p className="font-black text-slate-100">
                {ufFiltro ? `Nenhum evento em ${ufFiltro}` : 'Nenhum evento marcado'}
              </p>
              <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
                {ufFiltro
                  ? 'Toque em "Todos" para ver a agenda inteira.'
                  : 'Downwinds e encontros aparecem aqui quando forem publicados.'}
              </p>
            </div>
          )}
          {eventosVisiveis.map(event => (
            <div
              key={event.id}
              className={`rounded-2xl border shadow-xl overflow-hidden transition-colors ${
                beachMode
                  ? 'bg-[#020617] border-slate-800 text-white'
                  : 'bg-[#1E293B] border-slate-700/80 text-slate-100'
              }`}
            >
              {/* Event Cover Photo */}
              {event.imageUrl && (
                <div className="relative aspect-video bg-black">
                  <img src={event.imageUrl} alt={event.title} className="w-full h-full object-cover" />
                  <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-rose-600 text-white text-xs font-black uppercase tracking-wider shadow-lg">
                    {event.type}
                  </div>
                </div>
              )}

              {/* Event Content */}
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-black text-base text-white leading-tight">
                    {event.title}
                  </h3>
                  {/* Apagar: moderação sempre, ou quem criou o downwind deste
                      evento (downwindCriadoPorMim, calculado no servidor —
                      GET /api/events). Eventos sem downwind só moderação
                      apaga, porque `organizer` é texto livre sem user_id. */}
                  {(canModerateEvents || event.downwindCriadoPorMim) && (
                    <button
                      type="button"
                      onClick={() => handleApagarEvento(event.id, event.title)}
                      disabled={apagandoId === event.id}
                      className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 active:scale-95 transition-all disabled:opacity-50"
                      aria-label={`Apagar ${event.title}`}
                      title="Apagar evento"
                    >
                      {apagandoId === event.id ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Trash2 size={15} />
                      )}
                    </button>
                  )}
                </div>

                {/*
                  * Ações do organizador — vinham da <ListaDownwinds> removida.
                  *
                  * Só aparecem para quem criou o downwind e enquanto ele ainda
                  * está aberto: convidar para uma travessia encerrada ou
                  * anunciar uma que já saiu é chamar gente para uma porta
                  * fechada.
                  */}
                {event.downwindId && event.downwindCriadoPorMim && event.downwindStatus === 'aberto' && (
                  <div className="flex gap-2 pt-2 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => copiarLinkConvite(event.downwindId as string)}
                      disabled={gerandoConviteId !== null}
                      aria-busy={gerandoConviteId === event.downwindId}
                      className="flex-1 py-2 rounded-xl text-xs font-black bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-60 disabled:active:scale-100 disabled:cursor-wait"
                    >
                      {gerandoConviteId === event.downwindId ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>Gerando...</span>
                        </>
                      ) : linkCopiadoId === event.downwindId ? (
                        <>
                          <Check size={14} className="text-emerald-400" />
                          <span>Link copiado</span>
                        </>
                      ) : (
                        <>
                          <Link2 size={14} />
                          <span>Convidar</span>
                        </>
                      )}
                    </button>

                    {/*
                      * "Avisar" existe porque criar o downwind não avisava
                      * ninguém: ele ficava na agenda esperando alguém abrir a
                      * aba por conta própria, e o organizador acabava
                      * chamando o pessoal por WhatsApp.
                      *
                      * Só para downwind de comunidade, e UMA VEZ (a trava real
                      * é `downwinds.notificado_em` no banco). Push repetido faz
                      * o usuário desligar todas as notificações do app —
                      * inclusive as de SOS.
                      */}
                    {event.downwindVisibilidade === 'comunidade' && (
                      <button
                        type="button"
                        onClick={() => notificarComunidade(event.downwindId as string)}
                        disabled={
                          notificandoId === event.downwindId ||
                          event.downwindJaNotificado ||
                          avisoEnviadoId === event.downwindId
                        }
                        className="flex-1 py-2 rounded-xl text-xs font-black bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-default"
                      >
                        {notificandoId === event.downwindId ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            <span>Avisando...</span>
                          </>
                        ) : event.downwindJaNotificado || avisoEnviadoId === event.downwindId ? (
                          <>
                            <Check size={14} />
                            <span>Comunidade avisada</span>
                          </>
                        ) : (
                          <>
                            <Megaphone size={14} />
                            <span>Avisar amigos</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}

                <div className="space-y-1 text-xs text-slate-300">
                  <p className="flex items-center gap-1.5 font-bold text-white">
                    <Calendar size={14} className="text-rose-400" />
                    <span>{event.date}</span>
                  </p>
                  <p className="flex items-center gap-1.5 text-slate-400">
                    <MapPin size={14} className="text-cyan-400" />
                    <span>{event.location} ({event.spotName})</span>
                  </p>
                  <p className="flex items-center gap-1.5 text-slate-400">
                    <Users size={14} className="text-amber-400" />
                    <span>Organizador: {event.organizer}</span>
                  </p>
                  {/*
                    * A visibilidade fica ESCRITA no card, não deduzida.
                    *
                    * "Criei e não apareceu para ninguém" foi um relato real, e
                    * a resposta estava justamente aqui — invisível. Um
                    * downwind fechado é fechado de propósito, mas quem o criou
                    * precisa LER isso, não descobrir pelo silêncio.
                    */}
                  {event.downwindVisibilidade && (
                    <p className="flex items-center gap-1.5">
                      {event.downwindVisibilidade === 'comunidade' ? (
                        <>
                          <Globe size={14} className="text-cyan-400" />
                          <span className="text-cyan-300 font-bold">Aberto à comunidade</span>
                        </>
                      ) : (
                        <>
                          <Lock size={14} className="text-amber-400" />
                          <span className="text-amber-300 font-bold">Fechado — só por convite</span>
                        </>
                      )}
                    </p>
                  )}
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  {event.description}
                </p>

                {/* Footer Action */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                  {/*
                    * O contador virou BOTÃO.
                    *
                    * Era texto morto: `event_registrations` sempre foi gravada
                    * certo e só era CONTADA — as duas únicas consultas à tabela
                    * em todo o app eram COUNT(*). Dava para ver que cinco
                    * pessoas confirmaram e não existia lugar nenhum que
                    * dissesse quem. Confirmar presença serve para o grupo se
                    * organizar; sem os nomes, o número é enfeite.
                    */}
                  <button
                    type="button"
                    onClick={() => setParticipantesDe({ id: event.id, titulo: event.title })}
                    className="text-xs font-bold text-emerald-400 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-300 active:scale-95 transition-all text-left"
                  >
                    {event.participantsCount}{' '}
                    {event.participantsCount === 1 ? 'rider confirmado' : 'riders confirmados'}
                  </button>

                  {event.type === 'Downwind' && (event.downwindStatus === 'encerrado' || event.downwindStatus === 'cancelado') ? (
                    <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700">
                      Encerrado
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleEventRegistration(event.id)}
                      // Travado enquanto o pedido está em voo. Sem isto, o
                      // segundo toque virava uma segunda requisição que
                      // desfazia a primeira — ver toggleEventRegistration.
                      disabled={inscricoesEmAndamento.has(event.id)}
                      aria-busy={inscricoesEmAndamento.has(event.id)}
                      className={`px-4 py-2 rounded-xl text-xs font-black transition-all active:scale-95 flex items-center gap-1.5 disabled:opacity-60 disabled:active:scale-100 disabled:cursor-wait ${
                        event.isRegistered
                          ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                          : 'bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/20'
                      }`}
                    >
                      {inscricoesEmAndamento.has(event.id) ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : event.isRegistered ? (
                        <CheckCircle2 size={15} />
                      ) : (
                        <Plus size={15} className="stroke-[3]" />
                      )}
                      {/* O rótulo NÃO muda durante o envio: trocar para
                          "Enviando..." mexeria na largura do botão embaixo do
                          dedo, que é exatamente o defeito que o chat teve. */}
                      <span>{event.isRegistered ? 'Presença Confirmada' : 'Quero Participar'}</span>
                    </button>
                  )}
                </div>

                {/* Entrada no mapa ao vivo do downwind — só em eventos tipo
                    Downwind com downwind vinculado (ver GET /api/events) e
                    ainda não encerrado/cancelado. */}
                {event.type === 'Downwind' &&
                  event.downwindId &&
                  event.downwindStatus !== 'encerrado' &&
                  event.downwindStatus !== 'cancelado' && (
                    <button
                      type="button"
                      onClick={() => handleEntrarDownwind(event.downwindId!)}
                      disabled={entrandoEmId === event.downwindId}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 text-xs font-black active:scale-95 transition-all shadow-md shadow-cyan-500/20 disabled:opacity-60"
                    >
                      {entrandoEmId === event.downwindId ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Waves size={15} className="stroke-[3]" />
                      )}
                      <span>
                        {event.downwindStatus === 'em_andamento'
                          ? 'Downwind AO VIVO — entrar'
                          : 'Entrar no Downwind'}
                      </span>
                    </button>
                  )}

                {/*
                  * ACOMPANHAR SEM ENTRAR — capacidade que a <ListaDownwinds>
                  * removida oferecia e que se perderia sem isto.
                  *
                  * "Entrar no Downwind" acima faz de você PARTICIPANTE, o que
                  * é outra coisa: quem está em terra querendo ver o grupo
                  * atravessar não quer entrar na contagem de quem está na
                  * água — nem no quórum de encerramento.
                  *
                  * Só em downwind de comunidade em andamento, que é
                  * exatamente o que `podeVerReplayAoVivo` libera para não
                  * participante (lib/downwindAcesso.ts). Oferecer o botão num
                  * downwind fechado levaria a pessoa a um 404.
                  */}
                {event.downwindId &&
                  event.downwindStatus === 'em_andamento' &&
                  event.downwindVisibilidade === 'comunidade' && (
                    <button
                      onClick={() => abrirDownwindAoVivo(event.downwindId as string)}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-black active:scale-95 transition-all"
                    >
                      <Route size={14} className="text-cyan-400" />
                      <span>Acompanhar de terra</span>
                    </button>
                  )}

                {/* Resumo estilo Strava: só depois que o downwind terminou —
                    é histórico, não convite para entrar em nada. */}
                {event.type === 'Downwind' &&
                  event.downwindId &&
                  event.downwindStatus === 'encerrado' && (
                    <button
                      onClick={() => setResumoDownwindId(event.downwindId!)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-black active:scale-95 transition-all"
                    >
                      <Trophy size={15} className="text-amber-400" />
                      <span>Ver Resumo</span>
                    </button>
                  )}
              </div>
            </div>
          ))}
          {erroEntrar && (
            <div className="flex items-center gap-2 p-2.5 bg-red-950/40 border border-red-500/40 rounded-xl text-red-300 text-xs font-medium">
              <AlertTriangle size={14} className="text-red-400 shrink-0" />
              <span>{erroEntrar}</span>
            </div>
          )}
        </div>
      )}

      {/* FAB "Criar Downwind" — mesmo padrão de posicionamento do botão
          Publicar em FeedView (publish-fab-bottom, globals.css).

          Visível para QUALQUER velejador logado. Era restrito a
          `canOrganizeDownwind`, mas combinar uma travessia com os amigos não é
          ato administrativo — e com a outra porta (modal do Mapa) liberada,
          esconder este botão só deixaria as duas discordando. Quem cria já é o
          organizador DAQUELE downwind, que é o que governa iniciar, encerrar e
          avisar os seguidores. Ver app/api/downwind/route.ts. */}
      {activeSubTab === 'eventos' && user && !isCreatingDownwind && (
        <div className="fixed publish-fab-bottom left-0 right-0 z-20 flex justify-center pointer-events-none">
          <button
            onClick={() => setIsCreatingDownwind(true)}
            className="pointer-events-auto flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm tracking-wide shadow-2xl shadow-cyan-500/30 active:scale-95 transition-all border border-cyan-300/40"
          >
            <Route size={18} className="stroke-[3]" />
            <span>Criar Downwind</span>
          </button>
        </div>
      )}

      {participantesDe && (
        <ParticipantesEventoSheet
          eventoId={participantesDe.id}
          titulo={participantesDe.titulo}
          onFechar={() => setParticipantesDe(null)}
          onAbrirPerfil={setRiderIdAberto}
        />
      )}

      {resumoDownwindId && user && (
        <DownwindResumoModal
          downwindId={resumoDownwindId}
          meuUserId={user.id}
          onFechar={() => setResumoDownwindId(null)}
        />
      )}
    </div>
  );
};
