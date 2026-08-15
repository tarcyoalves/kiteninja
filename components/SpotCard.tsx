'use client';

import React from 'react';
import { Spot } from '../types';
import { Navigation, Sun, Moon, Cloud, CloudSun, CloudMoon, CloudRain, Star, MapPin, Compass, ShieldAlert, ArrowUpRight } from 'lucide-react';
import { useKiteData } from '../context/KiteDataContext';
import { getWindColorClass } from '../lib/windUtils';

interface SpotCardProps {
  spot: Spot;
  onSelect: (spot: Spot) => void;
  showFavoriteToggle?: boolean;
}

export const SpotCard: React.FC<SpotCardProps> = ({ spot, onSelect, showFavoriteToggle = true }) => {
  const { toggleFavorite, windUnit, convertWind, beachMode } = useKiteData();

  const currentConverted = convertWind(spot.currentKnots);
  const maxConverted = convertWind(spot.maxKnots);
  const windColors = getWindColorClass(spot.currentKnots);

  const renderWeatherIcon = () => {
    const iconSize = 20;
    switch (spot.weatherIcon) {
      case 'sun':
        return <Sun size={iconSize} className="text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.5)]" />;
      case 'moon':
        return <Moon size={iconSize} className="text-cyan-300 drop-shadow-[0_0_6px_rgba(103,232,249,0.5)]" />;
      case 'cloud-sun':
        return <CloudSun size={iconSize} className="text-amber-300" />;
      case 'cloud-moon':
        return <CloudMoon size={iconSize} className="text-cyan-200" />;
      case 'rain':
        return <CloudRain size={iconSize} className="text-blue-400" />;
      case 'cloud':
      default:
        return <Cloud size={iconSize} className="text-slate-400" />;
    }
  };

  return (
    <div
      onClick={() => onSelect(spot)}
      className={`group relative flex items-center justify-between border-b transition-all cursor-pointer overflow-hidden ${
        beachMode
          ? 'bg-[#020617] hover:bg-[#0f172a] border-slate-800 text-white'
          : 'bg-[#0F172A] hover:bg-[#1E293B]/80 border-slate-800/80 text-white'
      }`}
    >
      {/* Left Wind Badge matching Screenshot 1 (Gradient glow + Arrow + Knots + Max) */}
      <div className="relative flex items-center min-w-[130px] sm:min-w-[150px] py-3.5 pl-3 pr-2">
        {/* Ambient colored gradient on the left edge */}
        <div
          className={`absolute left-0 top-0 bottom-0 w-28 bg-gradient-to-r ${windColors.gradient} opacity-90 pointer-events-none`}
        />

        <div className="relative flex items-center gap-2.5 z-10">
          {/* Direction Arrow (rotated) */}
          <div
            className="flex items-center justify-center w-6 h-6 text-white drop-shadow-sm"
            style={{ transform: `rotate(${spot.windDirectionDeg - 90}deg)` }}
            title={`Direção: ${spot.windDirectionText} (${spot.windDirectionDeg}°)`}
          >
            <Navigation
              size={18}
              className="fill-white text-white transform rotate-45"
            />
          </div>

          {/* Knots & Max Knots */}
          <div className="flex flex-col leading-none">
            <div className="flex items-baseline gap-0.5">
              <span className="text-xl sm:text-2xl font-black tracking-tight font-sans text-white drop-shadow-sm">
                {currentConverted.value}
              </span>
              <span className="text-xs font-bold text-cyan-300">
                {currentConverted.unitStr}
              </span>
            </div>
            <span className="text-[11px] text-slate-400 font-medium tracking-tight mt-0.5">
              max <strong className="font-extrabold text-slate-200">{maxConverted.value}{maxConverted.unitStr}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Middle: Weather Icon + Temp + Spot Name + Observation/Forecast status */}
      <div className="flex-1 flex items-center gap-3 px-2 py-3 min-w-0">
        {/* Weather Icon & Temp */}
        <div className="flex flex-col items-center justify-center shrink-0 w-10 text-center">
          {renderWeatherIcon()}
          <span className="text-[11px] font-bold text-slate-300 mt-0.5">
            {spot.temperature}°C
          </span>
        </div>

        {/* Spot Name & Location/Type */}
        <div className="flex-1 min-w-0 pr-1">
          <h3 className="text-sm sm:text-base font-extrabold text-white truncate group-hover:text-cyan-300 transition-colors">
            {spot.name}
          </h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className={`text-[11px] tracking-tight ${
                spot.isLiveObservation
                  ? 'text-cyan-400 font-extrabold flex items-center gap-1'
                  : 'text-slate-400 font-medium'
              }`}
            >
              {spot.isLiveObservation && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping inline-block" />}
              {spot.isLiveObservation ? 'Ao Vivo (Sensor)' : 'Previsão'}
            </span>
            <span className="text-[10px] text-slate-500">&bull;</span>
            <span className="text-[11px] text-slate-400 truncate">
              {spot.location}
            </span>
          </div>
        </div>
      </div>

      {/* Right Side: Map Icon in red outline matching Screenshot 1 + Favorite Star */}
      <div className="flex items-center gap-1.5 pr-3 shrink-0">
        {showFavoriteToggle && (
          <button
            onClick={e => {
              e.stopPropagation();
              toggleFavorite(spot.id);
            }}
            className="p-1.5 rounded-full hover:bg-slate-800 text-slate-500 hover:text-amber-400 transition-all active:scale-125"
            title={spot.isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          >
            <Star
              size={18}
              className={spot.isFavorite ? 'fill-yellow-400 text-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.6)]' : 'text-slate-600'}
            />
          </button>
        )}

        {/* Red Map button matching screenshot 1 */}
        <button
          onClick={e => {
            e.stopPropagation();
            onSelect(spot);
          }}
          className="w-8 h-8 rounded-full flex items-center justify-center border border-rose-500/50 bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white active:scale-95 transition-all shadow-sm"
          title="Ver previsão completa e marés"
        >
          <Compass size={17} className="stroke-[2.2]" />
        </button>
      </div>
    </div>
  );
};
