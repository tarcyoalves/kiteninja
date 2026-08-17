'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Spot, DayForecast, WindForecastHour } from '../types';
import {
  ChevronLeft,
  Share2,
  MapPin,
  Star,
  Info,
  Navigation,
  Sun,
  Moon,
  Cloud,
  CloudSun,
  CloudMoon,
  CloudRain,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  Waves,
  Compass,
  AlertTriangle,
  CheckCircle2,
  Video,
  Wind,
  Shield,
  Clock,
  Sparkles,
  Calculator,
} from 'lucide-react';
import { useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';
import { getWindColorClass, calculateKiteSize, getSafetyBadgeColor } from '../lib/windUtils';
import { TideCurve } from './TideCurve';
import { WindTrend } from './WindTrend';

interface SpotDetailModalProps {
  spot: Spot | null;
  onClose: () => void;
}

export const SpotDetailModal: React.FC<SpotDetailModalProps> = ({ spot, onClose }) => {
  const { toggleFavorite, windUnit, convertWind, beachMode, setIsCalculatorOpen } = useKiteData();
  const { user } = useAuth();

  const [activeSubTab, setActiveSubTab] = useState<'previsao' | 'mares' | 'webcams' | 'info'>('previsao');
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!spot) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      // Prende o Tab dentro do modal: sem isso o foco escapa para a página
      // atrás, que está visualmente coberta mas continua alcançável.
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, [spot, onClose]);

  if (!spot) return null;

  const currentConverted = convertWind(spot.currentKnots);
  const maxConverted = convertWind(spot.maxKnots);
  const windColors = getWindColorClass(spot.currentKnots);
  const safetyBadge = getSafetyBadgeColor(spot.windSafety);

  // Recommended kite size for current user weight
  const userWeight = user?.weightKg || 78;
  const kiteRecommendation = calculateKiteSize(userWeight, spot.currentKnots, 'Kitesurf Twintip');

  const selectedDay: DayForecast = spot.daysForecast[selectedDayIndex] || spot.daysForecast[0];

  // Hora local do velejador (fuso do Nordeste, mesmo do índice da série da
  // API). Só marca "agora" no dia de hoje — nos próximos dias não existe agora.
  const nowHour = Number(
    new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Fortaleza',
      hour: '2-digit',
      hour12: false,
    })
  );

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: `KiteNinja - ${spot.name}`,
        text: `Condições de vento agora em ${spot.name}: ${spot.currentKnots} nós (rajadas ${spot.maxKnots} nós), direção ${spot.windDirectionText}.`,
        url: window.location.href,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(
        `KiteNinja: ${spot.name} agora com ${spot.currentKnots} nós (${spot.windDirectionText}), maré ${spot.currentTideHeightM}m!`
      );
      alert('Link e resumo do spot copiados para a área de transferência!');
    }
  };

  const renderWeatherIcon = (iconType: string, size = 18) => {
    switch (iconType) {
      case 'sun':
        return <Sun size={size} className="text-amber-500" />;
      case 'moon':
        return <Moon size={size} className="text-sky-400" />;
      case 'cloud-sun':
        return <CloudSun size={size} className="text-amber-400" />;
      case 'cloud-moon':
        return <CloudMoon size={size} className="text-sky-300" />;
      case 'rain':
        return <CloudRain size={size} className="text-blue-400" />;
      case 'cloud':
      default:
        return <Cloud size={size} className="text-zinc-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0F172A]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Previsão de vento em ${spot.name}`}
        className="relative h-full max-h-[92dvh] flex flex-col rounded-t-3xl bg-[#0F172A] border border-slate-800 shadow-2xl overflow-hidden safe-area-inset"
      >
        {/* Vibrant Red Header Bar matching Screenshot 2 */}
        <div
          className={`sticky top-0 z-20 flex items-center justify-between px-3 py-3 shadow-lg ${
            beachMode
              ? 'bg-[#020617] border-b border-slate-800'
              : 'bg-gradient-to-r from-[#e11d48] via-[#d61924] to-[#be123c] border-b border-rose-900/60'
          }`}
        >
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-2 -ml-1 rounded-full hover:bg-white/20 active:scale-95 text-white transition-all flex items-center gap-1 min-w-11 min-h-11"
            aria-label="Voltar"
          >
            <ChevronLeft size={28} className="stroke-[2.5]" />
          </button>

          <h1 className="font-black text-lg sm:text-xl text-white tracking-tight truncate max-w-[220px] sm:max-w-xs text-center drop-shadow-sm">
            {spot.name}
          </h1>

          <div className="flex items-center gap-2">
            {/* Favorite button */}
            <button
              onClick={() => toggleFavorite(spot.id)}
              className="p-2 rounded-full hover:bg-white/20 active:scale-95 text-white transition-all min-w-11 min-h-11"
              aria-label={spot.isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
            >
              <Star
                size={20}
                className={spot.isFavorite ? 'fill-yellow-300 text-yellow-300 drop-shadow-[0_0_6px_rgba(253,224,71,0.6)]' : 'text-white/80'}
              />
            </button>

            {/* Share Button */}
            <button
              onClick={handleShare}
              className="p-2 rounded-full hover:bg-white/20 active:scale-95 text-white transition-all min-w-11 min-h-11"
              aria-label="Compartilhar spot"
            >
              <Share2 size={20} className="stroke-[2.2]" />
            </button>
          </div>
        </div>

      {/* Sub-tabs Navigation Bar matching Screenshot 2 */}
      <div className="bg-[#b91c1c] border-t border-white/15 px-2 flex items-center justify-around overflow-x-auto text-xs font-black tracking-tight shadow-md">
        <button
          onClick={() => setActiveSubTab('previsao')}
          className={`py-2.5 px-3 whitespace-nowrap transition-all border-b-2 ${
            activeSubTab === 'previsao'
              ? 'border-cyan-300 text-white font-black scale-105 drop-shadow-[0_0_6px_rgba(103,232,249,0.6)]'
              : 'border-transparent text-white/70 hover:text-white'
          }`}
        >
          Previsão
        </button>

        <button
          onClick={() => setActiveSubTab('mares')}
          className={`py-2.5 px-3 whitespace-nowrap transition-all border-b-2 ${
            activeSubTab === 'mares'
              ? 'border-cyan-300 text-white font-black scale-105 drop-shadow-[0_0_6px_rgba(103,232,249,0.6)]'
              : 'border-transparent text-white/70 hover:text-white'
          }`}
        >
          Tábua de Marés
        </button>

        <button
          onClick={() => setActiveSubTab('webcams')}
          className={`py-2.5 px-3 whitespace-nowrap transition-all border-b-2 ${
            activeSubTab === 'webcams'
              ? 'border-cyan-300 text-white font-black scale-105 drop-shadow-[0_0_6px_rgba(103,232,249,0.6)]'
              : 'border-transparent text-white/70 hover:text-white'
          }`}
        >
          Webcams
        </button>

        <button
          onClick={() => setActiveSubTab('info')}
          className={`py-2.5 px-3 whitespace-nowrap transition-all border-b-2 ${
            activeSubTab === 'info'
              ? 'border-cyan-300 text-white font-black scale-105 drop-shadow-[0_0_6px_rgba(103,232,249,0.6)]'
              : 'border-transparent text-white/70 hover:text-white'
          }`}
        >
          Informação do Spot
        </button>
      </div>

      {/* Content Area with custom scrollbar */}
      <div
        className={`flex-1 overflow-y-auto ${
          beachMode ? 'bg-[#020617] text-white' : 'bg-[#0F172A] text-slate-100'
        }`}
      >
        {/* Kiter Beach Glance Bar (Instant one-look summary for kiters on the sand) */}
        <div
          className={`p-3.5 border-b shadow-md transition-colors ${
            beachMode
              ? 'bg-[#020617] border-slate-800 text-white'
              : 'bg-[#1E293B]/80 backdrop-blur border-slate-800 text-slate-100'
          }`}
        >
          {/* Micro status line: Atualizado / Próxima */}
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2.5">
            <span>
              Atualizado: <strong className="font-bold text-slate-200">{spot.lastUpdated}</strong> &bull; Próxima: {spot.nextUpdate}
            </span>
            <button
              onClick={() => setActiveSubTab('info')}
              className="flex items-center gap-1 text-xs font-bold text-cyan-400 hover:text-cyan-300 min-w-11 min-h-11 p-2 rounded-full hover:bg-slate-800/40 transition-colors"
              aria-label="Abrir info do spot"
            >
              <span>Info</span>
              <Info size={14} />
            </button>
          </div>

          {/* Main glanceable kite box */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {/* Wind Knots + Direction */}
            <div className="p-3 rounded-2xl bg-[#0F172A] border border-slate-700/80 flex flex-col justify-between relative overflow-hidden shadow-sm">
              <div
                className={`absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl ${windColors.gradient} opacity-60 pointer-events-none`}
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                  Vento Agora
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-black border ${safetyBadge.bg} ${safetyBadge.text} ${safetyBadge.border}`}>
                  {spot.windSafety}
                </span>
              </div>
              <div className="flex items-baseline gap-1 my-1">
                <span className="text-3xl font-black font-sans leading-none text-white">
                  {currentConverted.value}
                </span>
                <span className="text-sm font-bold text-cyan-300">
                  {currentConverted.unitStr}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-300">
                <div
                  className="w-4 h-4 flex items-center justify-center text-cyan-400"
                  style={{ transform: `rotate(${spot.windDirectionDeg - 90}deg)` }}
                >
                  <Navigation size={13} className="fill-current transform rotate-45" />
                </div>
                <span className="font-bold">{spot.windDirectionText} ({spot.windDirectionDeg}°)</span>
                <span className="text-slate-400">&bull;</span>
                <span className="text-slate-400 text-[11px]">max {maxConverted.value}{maxConverted.unitStr}</span>
              </div>
            </div>

            {/* Smart Kite Recommendation for user weight */}
            <div className="p-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-emerald-300 flex items-center gap-1">
                  <Sparkles size={12} className="text-emerald-400" />
                  <span>Pipa Ideal</span>
                </span>
                <button
                  onClick={() => setIsCalculatorOpen(true)}
                  className="text-[10px] text-emerald-400 font-black underline hover:text-emerald-300"
                >
                  {userWeight}kg
                </button>
              </div>
              <div className="flex items-baseline gap-1 my-1">
                <span className="text-3xl font-black text-emerald-400 leading-none">
                  {kiteRecommendation.recommendedSize}
                </span>
                <span className="text-sm font-bold text-emerald-300">m²</span>
                <span className="text-xs text-emerald-400 ml-1 font-semibold">
                  ({kiteRecommendation.minSize} - {kiteRecommendation.maxSize}m)
                </span>
              </div>
              <span className="text-[11px] text-emerald-200 font-medium truncate">
                {kiteRecommendation.statusMessage}
              </span>
            </div>

            {/* Tide Status */}
            <div className="p-3 rounded-2xl bg-[#0F172A] border border-slate-700/80 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                  Maré Atual
                </span>
                <span className="flex items-center gap-0.5 text-[10px] font-black text-cyan-400">
                  {spot.currentTideTrend === 'subindo' ? (
                    <>
                      <TrendingUp size={12} /> Enchendo
                    </>
                  ) : (
                    <>
                      <TrendingDown size={12} /> Vazando
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-baseline gap-1 my-1">
                <span className="text-3xl font-black text-cyan-400 leading-none">
                  {spot.currentTideHeightM}
                </span>
                <span className="text-sm font-bold text-slate-300">m</span>
              </div>
              <span className="text-[11px] text-slate-300 font-medium truncate">
                {spot.nextTideInfo}
              </span>
            </div>

            {/* Waves & Water condition */}
            <div className="p-3 rounded-2xl bg-[#0F172A] border border-slate-700/80 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                  Ondas / Água
                </span>
                <Waves size={14} className="text-cyan-400" />
              </div>
              <div className="flex items-baseline gap-1 my-1">
                <span className="text-2xl font-black text-cyan-300 leading-none">
                  {spot.waveHeightM}m
                </span>
                <span className="text-xs font-bold text-slate-400">
                  {spot.wavePeriodS}s período
                </span>
              </div>
              <span className="text-[11px] text-slate-300 font-medium truncate">
                {spot.waterCondition}
              </span>
            </div>
          </div>
        </div>

        {/* TAB 1: PREVISÃO (Hour by hour forecast matching Screenshot 2) */}
        {activeSubTab === 'previsao' && (
          <div className="p-3 space-y-3">
            {/* Days Selector */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {spot.daysForecast.map((day, idx) => (
                <button
                  key={day.shortDate}
                  onClick={() => setSelectedDayIndex(idx)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-black whitespace-nowrap transition-all ${
                    selectedDayIndex === idx
                      ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                      : 'bg-[#1E293B] text-slate-300 border border-slate-700/70 hover:bg-slate-700'
                  }`}
                >
                  {day.shortDate}
                </button>
              ))}
            </div>

            {/* Date Headline matching screenshot 2: "SEXTA-FEIRA, 14/08" */}
            <div className="flex items-center justify-between pt-1">
              <h2 className="text-sm font-black uppercase tracking-wide text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                <span>{selectedDay.dateStr}</span>
              </h2>
                <span className="text-[11px] text-slate-400 font-medium">
                Hora a hora
              </span>
            </div>

            {/* Forma da curva antes da tabela: a rampa da térmica e a queda do
                fim de tarde aparecem de relance, sem ler 24 linhas. */}
            <WindTrend
              hours={selectedDay.hours}
              currentHour={selectedDayIndex === 0 ? nowHour : undefined}
            />

            {/* Forecast Table matching screenshot 2 */}
            <div className="bg-[#1E293B] rounded-2xl border border-slate-700/80 overflow-hidden shadow-xl">
              {/* Table Header Columns */}
              <div className="grid grid-cols-6 text-center text-[10px] font-black text-slate-400 uppercase tracking-wider py-2.5 bg-[#0F172A]/80 border-b border-slate-700/80">
                <span>Hora</span>
                <span className="text-left pl-3">Vento</span>
                <span>Céu</span>
                <span>Ar</span>
                <span>Ondas</span>
                <span>Marés</span>
              </div>

              {/* Rows */}
              <div className="divide-y divide-slate-800">
                {selectedDay.hours.map((row, hIdx) => {
                  const rowKnots = convertWind(row.knots);
                  const rowGusts = convertWind(row.gustKnots);
                  const rowWindColors = getWindColorClass(row.knots);

                  return (
                    <div
                      key={hIdx}
                      className="grid grid-cols-6 items-center py-2.5 text-center text-xs hover:bg-slate-700/30 transition-colors"
                    >
                      {/* Col 1: Tempo / Hora in pill */}
                      <div className="flex justify-center">
                        <span className="px-2.5 py-1 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-black text-[11px]">
                          {row.hour}
                        </span>
                      </div>

                      {/* Col 2: Vento (Arrow + Knots + Max + Color bar beneath) */}
                      <div className="text-left pl-2 pr-1 relative">
                        <div className="flex items-center gap-1.5">
                          <div
                            className="w-4 h-4 flex items-center justify-center shrink-0 text-white"
                            style={{ transform: `rotate(${row.directionDeg - 90}deg)` }}
                          >
                            <Navigation size={13} className="fill-white transform rotate-45" />
                          </div>
                          <div className="flex flex-col leading-none">
                            <span className="font-black text-xs text-white">
                              {rowKnots.value}{rowKnots.unitStr}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              max{rowGusts.value}{rowGusts.unitStr}
                            </span>
                          </div>
                        </div>
                        {/* Colored Speed Bar matching screenshot 2 */}
                        <div className="mt-1.5 w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${rowWindColors.bg}`}
                            style={{ width: `${Math.min(100, (row.knots / 30) * 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Col 3: Sky Condition Icon */}
                      <div className="flex justify-center">
                        {renderWeatherIcon(row.conditionIcon, 20)}
                      </div>

                      {/* Col 4: Ar (Orange temp box + hPa matching screenshot 2) */}
                      <div className="flex flex-col items-center justify-center">
                        <div className="px-2 py-0.5 rounded-md bg-amber-500 text-slate-950 font-black text-[11px] leading-tight shadow-xs">
                          {row.temperature}°C
                        </div>
                <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {row.pressureHpa}hPa
                        </span>
                      </div>

                      {/* Col 5: Ondas (direction arrow + height + period) */}
                      <div className="flex flex-col items-center leading-none">
                        <div className="flex items-center gap-0.5">
                          <div
                            className="w-3 h-3 flex items-center justify-center text-slate-300"
                            style={{ transform: `rotate(${row.waveDirDeg - 90}deg)` }}
                          >
                            <Navigation size={10} className="fill-slate-300 transform rotate-45" />
                          </div>
                          <span className="font-black text-[11px] text-white">
                            {row.waveHeightM}m
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 mt-0.5">{row.wavePeriodS}s</span>
                      </div>

                      {/* Col 6: Marés (Arrow + Height + Peak Time if high/low) */}
                      <div className="flex flex-col items-center justify-center leading-tight">
                        {row.tidePeakTime ? (
                          <div className="flex flex-col items-center">
                            <span className="text-emerald-400 font-black text-sm">
                              {row.tideTrend === 'peak_high' ? '⇈' : '⇊'}
                            </span>
                            <span className="text-[10px] font-bold text-white">
                              {row.tidePeakTime}
                            </span>
                            <span className="text-[10px] font-extrabold text-emerald-400">
                              {row.tidePeakHeight}
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center">
                            <span
                              className={`text-xs font-black ${
                                row.tideTrend === 'up' ? 'text-teal-400' : 'text-amber-400'
                              }`}
                            >
                              {row.tideTrend === 'up' ? '↗' : '↘'}
                            </span>
                            <span className="text-[11px] font-bold text-white">
                              {row.tideHeightM}m
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: TÁBUA DE MARÉS */}
        {activeSubTab === 'mares' && (
          <div className="p-4 space-y-4">
            <div className="bg-[#1E293B] p-4 rounded-2xl border border-slate-700/80 shadow-xl">
              <h3 className="font-extrabold text-base mb-1 flex items-center gap-2 text-white">
                <Waves className="text-cyan-400" size={20} />
                <span>Ciclo das Marés & Lua</span>
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                Fundamental para kite no Nordeste: praias com lagunas secas x maré cheia.
              </p>

              {/* Curva e marcos vêm das alturas horárias reais do dia
                  selecionado. Antes havia horários e alturas fixos no código
                  (05:22 / 3.6m etc.) que não correspondiam a nenhum spot. */}
              <TideCurve
                hours={selectedDay.hours}
                currentHour={selectedDayIndex === 0 ? nowHour : undefined}
                currentHeightM={selectedDayIndex === 0 ? spot.currentTideHeightM : undefined}
                trend={selectedDayIndex === 0 ? spot.currentTideTrend : undefined}
              />
            </div>
          </div>
        )}

        {/* TAB 3: WEBCAMS */}
        {activeSubTab === 'webcams' && (
          <div className="p-4 space-y-4">
            <div className="bg-[#1E293B] p-4 rounded-2xl border border-slate-700/80 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-extrabold text-base flex items-center gap-2 text-white">
                  <Video className="text-rose-500" size={20} />
                  <span>Câmera Ao Vivo da Praia</span>
                </h3>
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-black uppercase tracking-wider animate-pulse shadow-md shadow-rose-500/40">
                  Ao Vivo
                </span>
              </div>

              {/* Webcam Video Simulation Frame */}
              <div className="relative aspect-video rounded-xl overflow-hidden bg-black ring-1 ring-slate-700 shadow-xl">
                <img
                  src={spot.webcamUrl || spot.coverImage}
                  alt={spot.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/50 flex flex-col justify-between p-3.5">
                  <div className="flex justify-between items-center text-xs font-mono text-white/95">
                    <span>CAM 01 &bull; {spot.name.toUpperCase()}</span>
                    <span>1080p HD &bull; 30 FPS</span>
                  </div>

                  <div className="flex items-center justify-between text-white">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur font-black text-emerald-400 text-xs border border-emerald-500/40">
                        {spot.currentKnots} NÓS
                      </span>
                      <span className="text-xs font-bold text-white">{spot.windDirectionText}</span>
                    </div>
                    <span className="text-[11px] text-slate-300 font-mono">
                      {new Date().toLocaleTimeString('pt-BR')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3.5 flex items-center justify-between text-xs text-slate-400">
                <span>Transmissão fornecida por Kite Point Club & Guarderia</span>
                <button
                  onClick={() => alert('Abrindo stream de alta taxa de quadros...')}
                  className="text-xs font-black text-cyan-400 hover:underline"
                >
                  Tela Cheia
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: INFO DO SPOT */}
        {activeSubTab === 'info' && (
          <div className="p-4 space-y-4">
            {/* Spot Header Card */}
            <div className="bg-[#1E293B] p-4 rounded-2xl border border-slate-700/80 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-black text-lg text-white">{spot.name}</h3>
                  <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                    <MapPin size={13} className="text-rose-500" />
                    <span>{spot.location}</span>
                  </p>
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-black bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  Nível: {spot.difficulty}
                </span>
              </div>

              {/* Ideal Wind Direction Compass & Water info */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-700/80 text-xs">
                <div>
                  <span className="text-slate-400 block font-bold mb-1">Ventos Ideais:</span>
                  <div className="flex flex-wrap gap-1">
                    {spot.idealWindDirections.map(dir => (
                      <span key={dir} className="px-2.5 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 font-black border border-emerald-500/30">
                        {dir}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-slate-400 block font-bold mb-1">Tipo de Fundo / Água:</span>
                  <p className="font-bold text-slate-200">{spot.bottomType} &bull; {spot.waterCondition}</p>
                </div>
              </div>
            </div>

            {/* Hazards & Safety Alert */}
            <div className="bg-amber-950/40 p-4 rounded-2xl border border-amber-500/40 shadow-xl">
              <h4 className="font-black text-sm text-amber-300 flex items-center gap-2 mb-2">
                <AlertTriangle size={17} className="text-amber-400" />
                <span>Atenção & Perigos Locais</span>
              </h4>
              <ul className="space-y-1.5 text-xs text-amber-200">
                {spot.hazards.map((h, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="text-amber-400 font-bold">&bull;</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Amenities & Infrastructure */}
            <div className="bg-[#1E293B] p-4 rounded-2xl border border-slate-700/80 shadow-xl">
              <h4 className="font-black text-sm mb-3 flex items-center gap-2 text-white">
                <CheckCircle2 size={17} className="text-emerald-400" />
                <span>Infraestrutura & Serviços no Local</span>
              </h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {spot.amenities.map((am, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-slate-300">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-xs shadow-emerald-400" />
                    <span className="font-medium">{am}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  );
};
