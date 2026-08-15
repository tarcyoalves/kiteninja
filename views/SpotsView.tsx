'use client';

import React, { useState } from 'react';
import { useKiteData } from '../context/KiteDataContext';
import { SpotCard } from '../components/SpotCard';
import { Spot } from '../types';
import { Search, SlidersHorizontal, Wind, Star, Compass, MapPin, Zap, Flame } from 'lucide-react';

interface SpotsViewProps {
  onSelectSpot: (spot: Spot) => void;
}

export const SpotsView: React.FC<SpotsViewProps> = ({ onSelectSpot }) => {
  const { spots, searchQuery, setSearchQuery, beachMode, selectedStateFilter, setSelectedStateFilter } = useKiteData();

  const [activeListTab, setActiveListTab] = useState<'favoritos' | 'todos'>('favoritos');
  const [minKnotsFilter, setMinKnotsFilter] = useState<number>(0);

  const favoriteSpots = spots.filter(s => s.isFavorite);

  // States available in spots
  const states = ['ALL', 'RN', 'CE', 'PI', 'RJ'];

  const filteredSpots = (activeListTab === 'favoritos' ? favoriteSpots : spots).filter(s => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.location.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesState = selectedStateFilter === 'ALL' || s.state === selectedStateFilter;
    const matchesKnots = s.currentKnots >= minKnotsFilter;
    return matchesSearch && matchesState && matchesKnots;
  });

  return (
    <div className="flex flex-col min-h-full pb-20">
      {/* Top Search & Filter Bar */}
      <div
        className={`sticky top-[86px] z-10 px-3 py-2.5 border-b shadow-md transition-colors ${
          beachMode
            ? 'bg-[#020617] border-slate-800 text-white'
            : 'bg-[#0F172A]/95 backdrop-blur border-slate-800/80 text-slate-200'
        }`}
      >
        {/* Search Input */}
        <div className="relative mb-2.5">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-400"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar spot, praia, estado (Ex: Ponta do Mel, Cumbuco, Galinhos)..."
            className="w-full pl-9 pr-8 py-2.5 rounded-xl text-xs font-semibold focus:outline-hidden transition-all bg-[#1E293B] border border-slate-700 text-white placeholder-slate-400 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-white p-1"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center justify-between gap-1 overflow-x-auto text-xs font-bold pb-0.5">
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Tab switch: Favoritos vs Todos */}
            <button
              onClick={() => setActiveListTab('favoritos')}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 text-xs font-black shadow-sm ${
                activeListTab === 'favoritos'
                  ? 'bg-cyan-500 text-slate-950 shadow-cyan-500/25'
                  : 'bg-[#1E293B] text-slate-300 hover:bg-slate-700/80 border border-slate-700/50'
              }`}
            >
              <Star size={13} className={activeListTab === 'favoritos' ? 'fill-current' : ''} />
              <span>Favoritos ({favoriteSpots.length})</span>
            </button>

            <button
              onClick={() => setActiveListTab('todos')}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 text-xs font-black shadow-sm ${
                activeListTab === 'todos'
                  ? 'bg-cyan-500 text-slate-950 shadow-cyan-500/25'
                  : 'bg-[#1E293B] text-slate-300 hover:bg-slate-700/80 border border-slate-700/50'
              }`}
            >
              <span>Todos ({spots.length})</span>
            </button>
          </div>

          {/* State Filter Buttons */}
          <div className="flex items-center gap-1 pl-2 border-l border-slate-700/80 shrink-0">
            {states.map(st => (
              <button
                key={st}
                onClick={() => setSelectedStateFilter(st)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-all ${
                  selectedStateFilter === st
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'bg-transparent text-slate-400 hover:text-white'
                }`}
              >
                {st === 'ALL' ? 'Todos' : st}
              </button>
            ))}

            {/* Quick Wind Filter: > 18 knots */}
            <button
              onClick={() => setMinKnotsFilter(prev => (prev === 0 ? 18 : 0))}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-all flex items-center gap-1 border ${
                minKnotsFilter > 0
                  ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm shadow-emerald-500/30'
                  : 'bg-[#1E293B] text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
              title="Filtrar apenas spots com vento forte (>18 nós)"
            >
              <Flame size={12} className={minKnotsFilter > 0 ? 'fill-current' : 'text-amber-400'} />
              <span>&gt;18 nós</span>
            </button>
          </div>
        </div>
      </div>

      {/* Spots List matching Screenshot 1 */}
      <div className="divide-y divide-slate-800/80 bg-[#0F172A]">
        {filteredSpots.length > 0 ? (
          filteredSpots.map(spot => (
            <SpotCard
              key={spot.id}
              spot={spot}
              onSelect={onSelectSpot}
              showFavoriteToggle={true}
            />
          ))
        ) : (
          <div className="p-12 text-center text-slate-400 space-y-4">
            <Compass size={40} className="mx-auto text-cyan-400 animate-pulse" />
            <p className="text-sm font-bold text-slate-200">Nenhum spot encontrado com estes filtros.</p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedStateFilter('ALL');
                setMinKnotsFilter(0);
                setActiveListTab('todos');
              }}
              className="px-5 py-2.5 rounded-xl bg-cyan-500 text-slate-950 text-xs font-black shadow-md shadow-cyan-500/25 active:scale-95 transition-all"
            >
              Ver Todos os Spots
            </button>
          </div>
        )}
      </div>

      {/* Beach Sponsor / Pro Banner (matching clean subtle banner at bottom of Screenshot 1 & 2) */}
      <div className="mx-3 my-4 p-3.5 rounded-2xl bg-[#1E293B] text-white border border-slate-700/70 flex items-center justify-between shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-rose-700 flex items-center justify-center font-black text-xs text-white shadow-md shadow-rose-600/30">
            KN
          </div>
          <div>
            <h4 className="text-xs font-extrabold text-white">KiteNinja Radar Pro</h4>
            <p className="text-[11px] text-slate-300 font-medium">Previsão em alta resolução ECMWF & GFS em tempo real.</p>
          </div>
        </div>
        <span className="px-3 py-1.5 rounded-xl bg-emerald-500 text-slate-950 text-[11px] font-black uppercase tracking-wider shrink-0 shadow-sm shadow-emerald-500/40">
          ATIVO
        </span>
      </div>
    </div>
  );
};
