'use client';

import React, { useState } from 'react';
import { useKiteData } from '../context/KiteDataContext';
import { Spot } from '../types';
import { MapPin, Navigation, Wind, Layers, Waves, CloudSun, Eye, Crosshair, ChevronRight } from 'lucide-react';
import { getWindColorClass } from '../lib/windUtils';

interface MapViewProps {
  onSelectSpot: (spot: Spot) => void;
}

export const MapView: React.FC<MapViewProps> = ({ onSelectSpot }) => {
  const { spots, convertWind, beachMode } = useKiteData();
  const [selectedMapSpot, setSelectedMapSpot] = useState<Spot>(spots[0]);
  const [activeLayer, setActiveLayer] = useState<'vento' | 'rajadas' | 'ondas' | 'satelite'>('vento');

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] relative overflow-hidden pb-16">
      {/* Top Map Layer Selector Controls */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-1.5 bg-[#0F172A]/90 backdrop-blur-md p-1.5 rounded-2xl border border-slate-700/80 pointer-events-auto shadow-2xl text-xs font-black text-white">
          <button
            onClick={() => setActiveLayer('vento')}
            className={`px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 ${
              activeLayer === 'vento'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Wind size={13} />
            <span>Vento</span>
          </button>
          <button
            onClick={() => setActiveLayer('rajadas')}
            className={`px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 ${
              activeLayer === 'rajadas'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>Rajadas</span>
          </button>
          <button
            onClick={() => setActiveLayer('ondas')}
            className={`px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 ${
              activeLayer === 'ondas'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Waves size={13} />
            <span>Ondas</span>
          </button>
        </div>

        {/* Locate Me button */}
        <button
          onClick={() => {
            alert('Localizando sua praia mais próxima via GPS...');
          }}
          className="p-2.5 rounded-2xl bg-[#0F172A]/90 backdrop-blur-md border border-slate-700/80 text-white pointer-events-auto hover:bg-slate-800 active:scale-95 shadow-xl"
          title="Minha localização na praia"
        >
          <Crosshair size={18} className="text-cyan-400" />
        </button>
      </div>

      {/* Map Interactive Canvas Representation with Wind Field Vectors */}
      <div className="flex-1 w-full h-full bg-[#090e1a] relative overflow-hidden flex items-center justify-center select-none">
        {/* Coastal Contour Background */}
        <div className="absolute inset-0 opacity-30 pointer-events-none">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.8" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
            {/* Coastline shape representation */}
            <path
              d="M 50,0 Q 150,120 220,240 T 400,500 L 500,500 L 500,0 Z"
              fill="#064e3b"
              opacity="0.3"
            />
          </svg>
        </div>

        {/* Animated Wind Particle Streamlines Overlay */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {[...Array(16)].map((_, i) => (
            <div
              key={i}
              className="absolute h-0.5 bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent rounded-full animate-pulse"
              style={{
                top: `${(i * 6.2) % 100}%`,
                left: `${(i * 11) % 80}%`,
                width: `${120 + (i % 5) * 30}px`,
                transform: `rotate(${75 + (i % 3) * 5}deg)`,
                opacity: 0.7,
              }}
            />
          ))}
        </div>

        {/* Interactive Spot Pins on Map */}
        <div className="relative w-full h-full max-w-lg p-6 flex flex-wrap items-center justify-around z-10">
          {spots.map((sp, idx) => {
            const windColors = getWindColorClass(sp.currentKnots);
            const isSelected = selectedMapSpot.id === sp.id;
            const converted = convertWind(sp.currentKnots);

            return (
              <button
                key={sp.id}
                onClick={() => setSelectedMapSpot(sp)}
                className={`group absolute transition-transform transform ${
                  isSelected ? 'scale-125 z-30' : 'hover:scale-110 z-20'
                }`}
                style={{
                  // Position spots geographically along simulated RN/CE/PI coast layout
                  top: `${18 + (idx * 13) % 68}%`,
                  left: `${15 + (idx * 21) % 72}%`,
                }}
              >
                {/* Ping animation for live wind */}
                {sp.isLiveObservation && (
                  <span className="absolute -inset-1 rounded-full bg-cyan-400 animate-ping opacity-60" />
                )}

                {/* Spot Pin Badge */}
                <div
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black shadow-2xl border-2 transition-all ${
                    isSelected
                      ? 'bg-white text-slate-950 ring-4 ring-cyan-500/50 border-cyan-400'
                      : `${windColors.bg} text-white ${windColors.border} shadow-lg`
                  }`}
                >
                  {/* Wind Arrow */}
                  <div
                    className="w-3.5 h-3.5 flex items-center justify-center shrink-0"
                    style={{ transform: `rotate(${sp.windDirectionDeg - 90}deg)` }}
                  >
                    <Navigation
                      size={11}
                      className={isSelected ? 'fill-cyan-600 text-cyan-600' : 'fill-white text-white'}
                    />
                  </div>

                  <span className="leading-none">{converted.value} {converted.unitStr}</span>
                </div>

                <span className="block mt-1 text-[10px] font-black text-white drop-shadow-lg bg-black/80 px-2 py-0.5 rounded-md truncate max-w-[110px] text-center border border-white/10">
                  {sp.name}
                </span>
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="absolute bottom-28 left-3 z-10 bg-[#0F172A]/90 backdrop-blur-md p-2.5 rounded-2xl border border-slate-700/80 text-[10px] text-white space-y-1 shadow-xl">
          <span className="font-black block text-slate-400 uppercase text-[9px] tracking-wider">Escala de Vento</span>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500 shadow-xs shadow-sky-500" />
            <span>&lt; 12 nós (Foil)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 shadow-xs shadow-cyan-500" />
            <span>12-16 nós</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500" />
            <span>17-22 nós (Ideal)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-xs shadow-amber-500" />
            <span>23-28 nós (Forte)</span>
          </div>
        </div>
      </div>

      {/* Selected Spot Bottom Floating Card */}
      {selectedMapSpot && (
        <div className="absolute bottom-2 left-3 right-3 z-20">
          <div
            onClick={() => onSelectSpot(selectedMapSpot)}
            className="bg-[#1E293B]/95 backdrop-blur-md text-white p-3.5 rounded-2xl border border-slate-700 shadow-2xl flex items-center justify-between cursor-pointer hover:bg-slate-800 active:scale-99 transition-all"
          >
            <div className="flex items-center gap-3 min-w-0">
              {/* Wind circle badge */}
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-rose-700 flex flex-col items-center justify-center shrink-0 shadow-md shadow-rose-600/30">
                <span className="text-base font-black leading-none">
                  {selectedMapSpot.currentKnots}
                </span>
                <span className="text-[9px] font-black uppercase tracking-tight opacity-95">
                  Nós
                </span>
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-sm text-white truncate">
                    {selectedMapSpot.name}
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {selectedMapSpot.windSafety}
                  </span>
                </div>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  {selectedMapSpot.location} &bull; Maré: {selectedMapSpot.currentTideHeightM}m ({selectedMapSpot.currentTideTrend})
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 pl-2 shrink-0 text-cyan-400 font-black text-xs">
              <span>Ver Previsão</span>
              <ChevronRight size={16} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
