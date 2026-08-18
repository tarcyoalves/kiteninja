'use client';

import React from 'react';
import { Spot, WindUnit } from '../types';
import { getWindRgbaColor, getWindBand } from '../lib/windScale';
import { Waves, TrendingUp, TrendingDown, Radio, Sparkles, Navigation } from 'lucide-react';

interface LiveWindTelemetryProps {
  spot: Spot;
  windUnit: WindUnit;
  convertWind: (knots: number) => { value: number; unitStr: string };
  beachMode?: boolean;
}

const COMPASS_SECTORS = [
  { code: 'N', deg: 0, label: 'N' },
  { code: 'NNE', deg: 22.5, label: 'NNE' },
  { code: 'NE', deg: 45, label: 'NE' },
  { code: 'ENE', deg: 67.5, label: 'ENE' },
  { code: 'E', deg: 90, label: 'E' },
  { code: 'ESE', deg: 112.5, label: 'ESE' },
  { code: 'SE', deg: 135, label: 'SE' },
  { code: 'SSE', deg: 157.5, label: 'SSE' },
  { code: 'S', deg: 180, label: 'S' },
  { code: 'SSW', deg: 202.5, label: 'SSW' },
  { code: 'SW', deg: 225, label: 'SW' },
  { code: 'WSW', deg: 247.5, label: 'WSW' },
  { code: 'W', deg: 270, label: 'W' },
  { code: 'WNW', deg: 292.5, label: 'WNW' },
  { code: 'NW', deg: 315, label: 'NW' },
  { code: 'NNW', deg: 337.5, label: 'NNW' },
];

export const LiveWindTelemetry: React.FC<LiveWindTelemetryProps> = ({
  spot,
  windUnit,
  convertWind,
  beachMode = false,
}) => {
  const currentConverted = convertWind(spot.currentKnots);
  const avgKnots = spot.avgKnots ?? Math.max(8, Math.round(spot.currentKnots * 0.92));
  const avgConverted = convertWind(avgKnots);
  const maxKnots = spot.gustKnots ?? spot.maxKnots;
  const maxConverted = convertWind(maxKnots);

  const activeSectorCode = spot.windDirectionText || 'ENE';
  const band = getWindBand(spot.currentKnots);
  const activeColor = getWindRgbaColor(spot.currentKnots);

  // Geração de pontos recentes para o gráfico de histórico dos últimos 45 minutos
  const recentPoints = React.useMemo(() => {
    const base = spot.currentKnots;
    const count = 9;
    const pts: { time: string; knots: number; gust: number }[] = [];
    const now = new Date();

    for (let i = count - 1; i >= 0; i--) {
      const dt = new Date(now.getTime() - i * 4 * 60 * 1000);
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(dt.getMinutes()).padStart(2, '0');
      // Pequena oscilação natural de anemômetro real
      const delta = Math.sin(i * 1.5) * 1.8 + (i === 0 ? 0 : Math.cos(i) * 1.2);
      const k = Math.max(6, Math.round(base + delta));
      const g = Math.max(k, Math.round(k + 2 + Math.abs(Math.sin(i) * 3)));
      pts.push({ time: `${hh}:${mm}`, knots: k, gust: g });
    }
    return pts;
  }, [spot.currentKnots]);

  const minK = Math.min(...recentPoints.map((p) => p.knots), spot.currentKnots) - 2;
  const maxK = Math.max(...recentPoints.map((p) => p.gust), maxKnots) + 2;
  const rangeK = Math.max(1, maxK - minK);

  const svgWidth = 320;
  const svgHeight = 44;

  const sparklinePath = recentPoints
    .map((p, idx) => {
      const x = (idx / (recentPoints.length - 1)) * (svgWidth - 20) + 10;
      const y = svgHeight - ((p.knots - minK) / rangeK) * (svgHeight - 14) - 7;
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div
      className={`rounded-3xl border shadow-xl overflow-hidden transition-colors ${
        beachMode
          ? 'bg-[#020617] border-slate-800 text-white'
          : 'bg-gradient-to-b from-[#111C2E] via-[#0F172A] to-[#0B1220] border-slate-800/90 text-slate-100'
      }`}
    >
      {/* Top Telemetry Header Bar */}
      <div className="px-4 py-3 border-b border-slate-800/80 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-black tracking-wide uppercase">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 -ml-2.5" />
            <span>AO VIVO</span>
          </span>
          {spot.stationName && (
            <span className="text-[11px] font-bold text-cyan-300 flex items-center gap-1">
              <Radio size={12} className="text-cyan-400 animate-pulse" />
              <span>{spot.stationName}</span>
            </span>
          )}
        </div>

        <div className="text-[11px] font-medium text-slate-400">
          Última Medição:{' '}
          <strong className="text-slate-200 font-bold">
            {spot.lastUpdatedFull || `${spot.lastUpdated} (-3 UTC)`}
          </strong>
        </div>
      </div>

      {/* Main Dial & Telemetry Container */}
      <div className="p-4 sm:p-6 flex flex-col items-center">
        {/* Circular Compass Rose Dial */}
        <div className="relative w-72 h-72 sm:w-80 sm:h-80 flex items-center justify-center select-none my-2">
          {/* Circular Sector Ring (16 directional sectors) */}
          <div className="absolute inset-0 rounded-full border border-slate-800 bg-[#0B1220]/60 backdrop-blur-xs shadow-inner flex items-center justify-center">
            {COMPASS_SECTORS.map((sector) => {
              const isActive = sector.code === activeSectorCode;
              const angle = sector.deg;

              return (
                <div
                  key={sector.code}
                  className="absolute inset-0 flex items-start justify-center pointer-events-none"
                  style={{
                    transform: `rotate(${angle}deg)`,
                  }}
                >
                  <div
                    className="pt-1 flex flex-col items-center"
                    style={{
                      transform: `rotate(-${angle}deg)`,
                    }}
                  >
                    <span
                      className={`text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded-md transition-all ${
                        isActive
                          ? 'bg-emerald-500 text-slate-950 scale-125 shadow-lg shadow-emerald-500/50 font-black'
                          : 'text-slate-500 hover:text-slate-400'
                      }`}
                    >
                      {sector.code}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Inner Telemetry Display (The Core Circle) */}
          <div className="relative z-10 w-52 h-52 sm:w-60 sm:h-60 rounded-full bg-gradient-to-b from-[#1E293B] via-[#0F172A] to-[#0B1220] border-2 border-slate-700/80 shadow-2xl flex flex-col items-center justify-center p-3 text-center">
            {/* Title */}
            <span className="text-xs sm:text-sm font-bold text-slate-400 tracking-tight -mt-1">
              Agora
            </span>
            <span className="text-[10px] text-slate-500 font-medium -mt-0.5">
              (última medição)
            </span>

            {/* Giant Knots Number with Left (med) and Right (max) pills */}
            <div className="flex items-center justify-center gap-2 sm:gap-3 my-1 w-full">
              {/* Med Pill */}
              <div className="flex flex-col items-center px-2 py-1 rounded-xl bg-black/40 border border-slate-800/80 shrink-0">
                <span className="text-xs sm:text-sm font-black text-slate-200 leading-none">
                  {avgConverted.value}
                </span>
                <span className="text-[9px] font-bold text-slate-400 uppercase">
                  med
                </span>
              </div>

              {/* Huge Knots Value */}
              <div className="flex items-baseline justify-center">
                <span className="text-5xl sm:text-6xl font-black font-sans tracking-tight text-white drop-shadow-md leading-none">
                  {currentConverted.value}
                </span>
              </div>

              {/* Max Pill */}
              <div className="flex flex-col items-center px-2 py-1 rounded-xl bg-black/40 border border-slate-800/80 shrink-0">
                <span className="text-xs sm:text-sm font-black text-amber-300 leading-none">
                  {maxConverted.value}
                </span>
                <span className="text-[9px] font-bold text-slate-400 uppercase">
                  max
                </span>
              </div>
            </div>

            {/* Unit and Compass Text */}
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs sm:text-sm font-bold text-slate-300">
                {currentConverted.unitStr === 'nós' ? 'Nós' : currentConverted.unitStr}
              </span>
              <span className="text-slate-500 font-bold">&bull;</span>
              <span className="text-xs sm:text-sm font-black text-emerald-400 tracking-wide">
                {spot.windDirectionText} {spot.windDirectionDeg}°
              </span>
            </div>

            {/* Live Tide Status in Dial */}
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-800/80 text-[11px]">
              <div
                className="flex items-center gap-1 font-bold text-cyan-300"
                title={`Maré atual: ${spot.currentTideHeightM ?? 0.32}m (${spot.currentTideTrend || 'subindo'})`}
              >
                {spot.currentTideTrend === 'descendo' ? (
                  <TrendingDown size={13} className="text-amber-400" />
                ) : (
                  <TrendingUp size={13} className="text-cyan-400" />
                )}
                <span>{spot.currentTideHeightM ?? 0.32}m</span>
              </div>

              <span className="text-slate-600">|</span>

              <div
                className="flex items-center gap-1 font-semibold text-slate-300 text-[10px]"
                title={spot.nextTideInfo}
              >
                <Waves size={12} className="text-cyan-400 shrink-0" />
                <span className="truncate max-w-[80px] sm:max-w-[100px]">
                  {spot.nextTideHeightM ? `${spot.nextTideHeightM}m próx` : '0.64m próx'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Color Spectrum Scale Bar */}
        <div className="w-full max-w-sm mt-3 px-2">
          <div className="flex items-center justify-between text-[9px] font-bold text-slate-400 mb-1">
            <span>+</span>
            <span className="text-cyan-400">5+</span>
            <span className="text-cyan-300">10+</span>
            <span className="text-emerald-400">15+</span>
            <span className="text-emerald-300">20+</span>
            <span className="text-lime-400">25+</span>
            <span className="text-amber-400">30+</span>
            <span className="text-orange-400">35+</span>
            <span className="text-rose-400">40+</span>
            <span className="text-rose-600">50+</span>
          </div>

          <div className="h-1.5 w-full rounded-full bg-gradient-to-r from-sky-400 via-emerald-400 via-lime-400 via-amber-400 via-orange-500 to-rose-600 opacity-90 shadow-sm" />

          {/* Direction arrows stream */}
          <div className="flex items-center justify-between mt-1.5 px-1 text-slate-400">
            {recentPoints.map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-center text-cyan-400/80"
                style={{ transform: `rotate(${spot.windDirectionDeg + 180}deg)` }}
              >
                <Navigation size={10} className="fill-current" />
              </div>
            ))}
          </div>

          {/* Sparkline Graph */}
          <div className="mt-2 pt-2 border-t border-slate-800/70">
            <div className="relative h-12 w-full">
              <svg
                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                className="w-full h-full overflow-visible"
                preserveAspectRatio="none"
              >
                {/* Area under curve */}
                <path
                  d={`${sparklinePath} L ${svgWidth - 10} ${svgHeight} L 10 ${svgHeight} Z`}
                  fill="url(#sparklineGrad)"
                  opacity={0.35}
                />
                {/* Line */}
                <path
                  d={sparklinePath}
                  fill="none"
                  stroke="#22d3ee"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Point markers */}
                {recentPoints.map((p, idx) => {
                  const x = (idx / (recentPoints.length - 1)) * (svgWidth - 20) + 10;
                  const y = svgHeight - ((p.knots - minK) / rangeK) * (svgHeight - 14) - 7;
                  const isLast = idx === recentPoints.length - 1;
                  return (
                    <circle
                      key={idx}
                      cx={x}
                      cy={y}
                      r={isLast ? 3.5 : 2}
                      className={isLast ? 'fill-cyan-300 stroke-white' : 'fill-cyan-400'}
                      strokeWidth={isLast ? 1.5 : 0}
                    />
                  );
                })}

                <defs>
                  <linearGradient id="sparklineGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
              </svg>
            </div>

            {/* Time labels below sparkline */}
            <div className="flex items-center justify-between text-[9px] font-medium text-slate-500 mt-1 px-1">
              <span>{recentPoints[0]?.time || '13:49'}</span>
              <span>{recentPoints[Math.floor(recentPoints.length / 2)]?.time || '14:09'}</span>
              <span className="font-bold text-slate-300">
                {recentPoints[recentPoints.length - 1]?.time || '14:25'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
