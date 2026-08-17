'use client';

import React, { useState } from 'react';
import { useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';
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
} from 'lucide-react';

export const EventsAndAlertsView: React.FC = () => {
  const { safetyAlerts, addSafetyAlert, events, toggleEventRegistration, spots, beachMode } = useKiteData();
  const { user, openAuthModal } = useAuth();

  const [activeSubTab, setActiveSubTab] = useState<'alertas' | 'eventos'>('alertas');
  const [isReportingAlert, setIsReportingAlert] = useState(false);

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

  return (
    <div className="flex flex-col min-h-full pb-24 p-3 space-y-4 max-w-lg mx-auto w-full">
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
                      onChange={e => setAlertSeverity(e.target.value as any)}
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
                <h3 className="font-black text-base text-white leading-tight">
                  {event.title}
                </h3>

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
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
