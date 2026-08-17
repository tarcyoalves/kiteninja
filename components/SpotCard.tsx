'use client';

import React from 'react';
import { Spot } from '../types';
import { Navigation, Sun, Moon, Cloud, CloudSun, CloudMoon, CloudRain, Star, Compass, Sparkles, Flame, Zap, Waves } from 'lucide-react';
import { useKiteData } from '../context/KiteDataContext';
import { getWindColorClass } from '../lib/windUtils';

/**
 * Etiqueta de condição: resume num rótulo o que o velejador levaria alguns
 * segundos lendo os números para concluir. Só um badge por card — competindo
 * por atenção, dois deixariam de ser atalho.
 *
 * A ordem importa e é deliberada: risco antes de oportunidade. Rajada forte
 * decide troca de kite (ou desistência), então vem antes de "vento perfeito".
 * Todos os campos usados vêm da Open-Meteo via /api/spots — nada estimado aqui.
 */
function smartConditionBadge(spot: Spot) {
  // Rajada muito acima do vento médio é o que arranca a pipa da mão.
  // Proporcional, não limiar fixo: 7 nós de spread pesam muito mais com 12 de
  // base do que com 30.
  const spread = spot.maxKnots - spot.currentKnots;
  if (spot.currentKnots >= 8 && spread >= Math.max(6, spot.currentKnots * 0.4)) {
    return {
      label: 'Rajadas Fortes',
      icon: <Zap size={10} className="text-rose-300" />,
      className: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
      title: `Vento ${spot.currentKnots} nós com rajada de ${spot.maxKnots}: ${spread} nós de variação`,
    };
  }

  if (spot.currentKnots >= 20 && spot.currentKnots <= 26) {
    return {
      label: 'Vento Perfeito',
      icon: <Flame size={10} className="text-amber-300" />,
      className: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      title: 'Faixa de 20 a 26 nós: vento cheio e constante',
    };
  }

  // Maré secando muda o banco de areia e a profundidade — só vale avisar se
  // há vento suficiente para velejar de fato.
  if (spot.currentTideTrend === 'descendo' && spot.currentKnots >= 12) {
    return {
      label: 'Maré Secando',
      icon: <Waves size={10} className="text-teal-300" />,
      className: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
      title: spot.nextTideInfo || 'Maré vazando',
    };
  }

  if (/Flat|Lagoa/i.test(spot.waterCondition) && spot.currentKnots >= 12) {
    return {
      label: 'Flat Clássico',
      icon: <Sparkles size={10} className="text-cyan-300" />,
      className: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
      title: `${spot.waterCondition} com ${spot.currentKnots} nós`,
    };
  }

  return null;
}

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
  const smartBadge = smartConditionBadge(spot);

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
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-sm sm:text-base font-extrabold text-white truncate group-hover:text-cyan-300 transition-colors">
              {spot.name}
            </h3>
            {smartBadge && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black border uppercase tracking-wider ${smartBadge.className}`}
                title={smartBadge.title}
              >
                {smartBadge.icon}
                <span>{smartBadge.label}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className={`text-[11px] tracking-tight ${
                spot.isLiveObservation
                  ? 'text-cyan-400 font-extrabold flex items-center gap-1'
                  : 'text-slate-400 font-medium'
              }`}
            >
              {/* Ping sobre um ponto sólido: o anel se expande e some, mas o
                  ponto permanece visível — só o ping sozinho pisca e "apaga". */}
              {spot.isLiveObservation && (
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
                </span>
              )}
              {/* Não dizemos "sensor ao vivo": a fonte é modelo de previsão
                  (Open-Meteo), não estação na praia. Mostrar a hora da última
                  leitura é honesto e mais útil que um rótulo genérico. */}
              {spot.isLiveObservation ? `Atualizado ${spot.lastUpdated}` : 'Sem dados'}
            </span>
            <span className="text-[10px] text-slate-400">&bull;</span>
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
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-all active:scale-125"
            aria-label={spot.isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
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
          className="w-8 h-8 rounded-full flex items-center justify-center border border-rose-500/50 bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white active:scale-95 transition-all shadow-sm min-w-11 min-h-11"
          aria-label="Ver previsão completa e marés"
        >
          <Compass size={17} className="stroke-[2.2]" />
        </button>
      </div>
    </div>
  );
};
