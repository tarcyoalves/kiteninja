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
} from 'lucide-react';
import { DownwindResumoModal } from '../components/DownwindResumoModal';
import { devePuxarAtualizar, progressoPull } from '../lib/pullToRefresh';

export const EventsAndAlertsView: React.FC = () => {
  const {
    safetyAlerts,
    addSafetyAlert,
    events,
    toggleEventRegistration,
    deleteEvent,
    spots,
    beachMode,
    createDownwind,
    setActiveTab,
    refreshEventsAndAlerts,
  } = useKiteData();
  const { user, openAuthModal, canOrganizeDownwind, canModerateEvents } = useAuth();
  const { entrarNoDownwind } = useDownwind();
  const [entrandoEmId, setEntrandoEmId] = useState<string | null>(null);
  const [erroEntrar, setErroEntrar] = useState<string | null>(null);
  const [apagandoId, setApagandoId] = useState<string | null>(null);
  const [resumoDownwindId, setResumoDownwindId] = useState<string | null>(null);

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

          {events.length === 0 && (
            <div className="p-6 rounded-2xl border border-slate-800 bg-[#1E293B]/50 text-center">
              <p className="font-black text-slate-100">Nenhum evento marcado</p>
              <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
                Downwinds e encontros aparecem aqui quando forem publicados.
              </p>
            </div>
          )}
          {events.map(event => (
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
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  {event.description}
                </p>

                {/* Footer Action */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                  <span className="text-xs font-bold text-emerald-400">
                    {event.participantsCount} riders confirmados
                  </span>

                  <button
                    onClick={() => toggleEventRegistration(event.id)}
                    className={`px-4 py-2 rounded-xl text-xs font-black transition-all active:scale-95 flex items-center gap-1.5 ${
                      event.isRegistered
                        ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                        : 'bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/20'
                    }`}
                  >
                    {event.isRegistered ? (
                      <>
                        <CheckCircle2 size={15} />
                        <span>Presença Confirmada</span>
                      </>
                    ) : (
                      <>
                        <Plus size={15} className="stroke-[3]" />
                        <span>Quero Participar</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Entrada no mapa ao vivo do downwind — só em eventos tipo
                    Downwind com downwind vinculado (ver GET /api/events) e
                    ainda não encerrado/cancelado. */}
                {event.type === 'Downwind' &&
                  event.downwindId &&
                  event.downwindStatus !== 'encerrado' &&
                  event.downwindStatus !== 'cancelado' && (
                    <button
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
          Publicar em FeedView (publish-fab-bottom, globals.css), só visível
          na subaba Eventos e para quem tem canOrganizeDownwind (admin/
          moderator/instructor pelo role, ou rider com a liberação pontual). */}
      {activeSubTab === 'eventos' && canOrganizeDownwind && !isCreatingDownwind && (
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
