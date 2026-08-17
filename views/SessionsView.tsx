'use client';

import React, { useState } from 'react';
import { useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';
import {
  Compass,
  Calendar,
  Clock,
  Wind,
  Waves,
  Star,
  Plus,
  Trash2,
  Share2,
  Gauge,
  ArrowUpCircle,
  ShieldCheck,
  TrendingUp,
  MapPin,
  Sparkles,
} from 'lucide-react';
import { PhotoLightboxModal } from '../components/PhotoLightboxModal';
import { SessionLog, Discipline } from '../types';

export const SessionsView: React.FC = () => {
  const { sessions, deleteSession, setIsLoggerOpen, beachMode } = useKiteData();
  const { user } = useAuth();

  const [disciplineFilter, setDisciplineFilter] = useState<string>('ALL');
  const [lightbox, setLightbox] = useState<{
    imageUrl: string;
    title?: string;
    spotName?: string;
    windKnots?: number;
    date?: string;
  } | null>(null);

  const filteredSessions = sessions.filter(s => {
    if (disciplineFilter === 'ALL') return true;
    return s.discipline === disciplineFilter;
  });

  // Calculate user stats
  const totalSessionsCount = sessions.length;
  const totalMinutes = sessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);
  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
  const totalKm = Math.round(sessions.reduce((acc, s) => acc + (s.distanceKm || 0), 0) * 10) / 10;
  const highestJump = Math.max(0, ...sessions.map(s => s.highestJumpM || 0));
  const maxSpeed = Math.max(0, ...sessions.map(s => s.maxSpeedKnots || 0));

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Tem certeza que deseja excluir esta sessão do seu logbook?')) {
      deleteSession(id);
    }
  };

  return (
    <div className="flex flex-col min-h-full pb-24 p-3 space-y-4 max-w-lg mx-auto w-full">
      {/* Top Banner KPI Cards */}
      <div
        className={`p-4 rounded-2xl border shadow-xl transition-colors ${
          beachMode
            ? 'bg-[#020617] border-slate-800 text-white'
            : 'bg-[#1E293B] border-slate-700/80 text-slate-100'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-black text-base text-white flex items-center gap-2">
              <Compass size={20} className="text-cyan-400" />
              <span>Histórico de Navegações</span>
            </h2>
            <p className="text-xs text-slate-400">
              Banco de dados de sessões sincronizado na nuvem.
            </p>
          </div>

          <button
            onClick={() => setIsLoggerOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-black active:scale-95 transition-all shadow-md shadow-cyan-500/20"
          >
            <Plus size={15} className="stroke-[3]" />
            <span>Novo Velejo</span>
          </button>
        </div>

        {/* 4 Stats Grid */}
        <div className="grid grid-cols-4 gap-2 text-center pt-2 border-t border-slate-800">
          <div className="p-2.5 rounded-xl bg-[#0F172A] border border-slate-700/60 shadow-xs">
            <span className="block text-[10px] text-slate-400 font-black uppercase">Sessões</span>
            <span className="text-lg font-black text-emerald-400 font-sans">{totalSessionsCount}</span>
          </div>
          <div className="p-2.5 rounded-xl bg-[#0F172A] border border-slate-700/60 shadow-xs">
            <span className="block text-[10px] text-slate-400 font-black uppercase">Horas</span>
            <span className="text-lg font-black text-cyan-400 font-sans">{totalHours}h</span>
          </div>
          <div className="p-2.5 rounded-xl bg-[#0F172A] border border-slate-700/60 shadow-xs">
            <span className="block text-[10px] text-slate-400 font-black uppercase">Distância</span>
            <span className="text-lg font-black text-blue-400 font-sans">{totalKm}km</span>
          </div>
          <div className="p-2.5 rounded-xl bg-[#0F172A] border border-slate-700/60 shadow-xs">
            <span className="block text-[10px] text-slate-400 font-black uppercase">Max Salto</span>
            <span className="text-lg font-black text-amber-400 font-sans">{highestJump}m</span>
          </div>
        </div>
      </div>

      {/* Filter Tabs by Discipline */}
      <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-black pb-1">
        {[
          { id: 'ALL', label: 'Todas' },
          { id: 'Kitesurf Twintip', label: 'Twintip' },
          { id: 'Big Air', label: 'Big Air' },
          { id: 'Hydrofoil', label: 'Hydrofoil' },
          { id: 'Wingfoil', label: 'Wingfoil' },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setDisciplineFilter(f.id)}
            className={`px-3.5 py-1.5 rounded-xl whitespace-nowrap transition-all ${
              disciplineFilter === f.id
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                : 'bg-[#1E293B] text-slate-300 border border-slate-700/70 hover:bg-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Sessions List */}
      <div className="space-y-3">
        {filteredSessions.length > 0 ? (
          filteredSessions.map(session => (
            <div
              key={session.id}
              className={`p-4 rounded-2xl border shadow-xl transition-colors space-y-3 ${
                beachMode
                  ? 'bg-[#020617] border-slate-800 text-white'
                  : 'bg-[#1E293B] border-slate-700/80 text-slate-100'
              }`}
            >
              {/* Card Header: Spot Name & Date */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-black text-base text-white">
                      {session.spotName}
                    </h3>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                      {session.discipline}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5 font-medium">
                    <Calendar size={12} className="text-rose-400" />
                    <span>{session.date} às {session.startTime}</span>
                    <span>&bull;</span>
                    <Clock size={12} className="text-cyan-400" />
                    <span>{session.durationMinutes} minutos</span>
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <div className="flex text-amber-400">
                    {[...Array(session.rating)].map((_, i) => (
                      <Star key={i} size={13} className="fill-current drop-shadow-[0_0_4px_rgba(251,191,36,0.5)]" />
                    ))}
                  </div>
                  <button
                    onClick={e => handleDelete(session.id, e)}
                    className="p-2 min-w-11 min-h-11 rounded text-slate-400 hover:text-rose-500 transition-colors ml-2 flex items-center justify-center"
                    aria-label="Excluir sessão"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {/* Photo preview if present */}
              {session.photoUrl && (
                <button
                  type="button"
                  onClick={() =>
                    setLightbox({
                      imageUrl: session.photoUrl!,
                      title: session.spotName,
                      spotName: session.spotLocation,
                      windKnots: session.avgWindKnots,
                      date: session.date,
                    })
                  }
                  className="relative block w-full aspect-video rounded-xl overflow-hidden bg-black ring-1 ring-slate-700 cursor-zoom-in"
                  aria-label={`Ampliar foto da sessão em ${session.spotName}`}
                >
                  <img
                    src={session.photoUrl}
                    alt={session.spotName}
                    className="w-full h-full object-cover"
                  />
                </button>
              )}

              {/* Session Metrics Bar */}
              <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-[#0F172A] border border-slate-700/60 text-xs">
                <div>
                  <span className="block text-[10px] text-slate-400 font-bold">Pipa & Vento</span>
                  <span className="font-black text-emerald-400">
                    {session.kiteSizeM2}m² &bull; {session.avgWindKnots} nós
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-400 font-bold">Distância / Vel</span>
                  <span className="font-black text-cyan-400">
                    {session.distanceKm ? `${session.distanceKm} km` : `${session.durationMinutes}m`}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-400 font-bold">Salto Máx (WOO)</span>
                  <span className="font-black text-amber-400">
                    {session.highestJumpM ? `${session.highestJumpM}m` : 'Flat / Cruising'}
                  </span>
                </div>
              </div>

              {/* Notes */}
              {session.notes && (
                <p className="text-xs text-slate-300 italic border-l-2 border-cyan-400 pl-2.5">
                  &ldquo;{session.notes}&rdquo;
                </p>
              )}

              {/* Card Footer */}
              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800">
                <span>Maré: {session.tideCondition} &bull; {session.waterCondition}</span>
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <ShieldCheck size={13} />
                  <span>Sincronizado</span>
                </span>
              </div>
            </div>
          ))
        ) : (
          <div className="p-8 text-center bg-[#1E293B] rounded-2xl border border-slate-700 text-slate-400 space-y-3 shadow-xl">
            <Compass size={36} className="mx-auto text-slate-500" />
            <p className="text-sm font-bold text-slate-300">Nenhuma sessão registrada nesta categoria.</p>
            <button
              onClick={() => setIsLoggerOpen(true)}
              className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-black shadow-md shadow-cyan-500/20"
            >
              Registrar Meu Primeiro Velejo
            </button>
          </div>
        )}
      </div>

      <PhotoLightboxModal
        isOpen={lightbox !== null}
        onClose={() => setLightbox(null)}
        imageUrl={lightbox?.imageUrl ?? ''}
        title={lightbox?.title}
        authorName={user?.name}
        spotName={lightbox?.spotName}
        windKnots={lightbox?.windKnots}
        date={lightbox?.date}
      />
    </div>
  );
};
