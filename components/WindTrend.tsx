'use client';

import React, { useId, useMemo } from 'react';
import type { WindForecastHour } from '../types';

interface WindTrendProps {
  hours: WindForecastHour[];
  currentHour?: number;
}

const W = 400;
const H = 90;
const PAD_Y = 10;

/**
 * Tendência de vento das próximas horas, com a faixa de rajada.
 *
 * O que o velejador procura aqui é a forma da curva, não o número exato: onde a
 * térmica entra, quando o vento cai no fim da tarde, e se a distância entre
 * média e rajada abre (sinal de vento instável). Por isso desenhamos rajada e
 * média juntas — a área entre as duas É a informação.
 */
export const WindTrend: React.FC<WindTrendProps> = ({ hours, currentHour }) => {
  const gradientId = useId();

  const chart = useMemo(() => {
    if (hours.length === 0) return null;

    const gusts = hours.map((h) => h.gustKnots);
    const knots = hours.map((h) => h.knots);
    const max = Math.max(...gusts, ...knots, 1);
    // Escala sempre do zero: começar do mínimo exageraria variações pequenas e
    // faria 12 nós parecer calmaria ao lado de 14.
    const toX = (i: number) => (i / Math.max(1, hours.length - 1)) * W;
    const toY = (v: number) => H - PAD_Y - (v / max) * (H - PAD_Y * 2);

    const line = (vals: number[]) =>
      `M ${vals.map((v, i) => `${toX(i)},${toY(v)}`).join(' L ')}`;

    // Área entre rajada e média: rajada na ida, média invertida na volta.
    const band =
      `M ${gusts.map((v, i) => `${toX(i)},${toY(v)}`).join(' L ')} ` +
      `L ${knots
        .map((v, i) => ({ v, i }))
        .reverse()
        .map(({ v, i }) => `${toX(i)},${toY(v)}`)
        .join(' L ')} Z`;

    const peakIdx = gusts.indexOf(Math.max(...gusts));
    const nowIdx =
      currentHour == null
        ? -1
        : hours.findIndex((h) => Number(h.hour.replace('h', '')) === currentHour);

    return {
      gustLine: line(gusts),
      knotLine: line(knots),
      band,
      max,
      peak: { x: toX(peakIdx), y: toY(gusts[peakIdx]), value: gusts[peakIdx], hour: hours[peakIdx].hour },
      now: nowIdx >= 0 ? { x: toX(nowIdx) } : null,
      labels: hours
        .map((h, i) => ({ hour: h.hour, x: toX(i), i }))
        // Uma marca a cada 4h: mais que isso vira borrão no celular.
        .filter(({ i }) => i % 4 === 0),
    };
  }, [hours, currentHour]);

  if (!chart) return null;

  return (
    <div className="relative w-full bg-[#0F172A] rounded-2xl p-3 border border-slate-700/70 overflow-hidden shadow-inner">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
          Tendência de vento
        </span>
        <span className="text-[11px] font-bold text-slate-300">
          pico <strong className="text-cyan-300 font-black">{chart.peak.value} nós</strong> às{' '}
          {chart.peak.hour}
        </span>
      </div>

      <svg
        className="w-full h-24 overflow-visible"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Tendência de vento das próximas horas, pico de rajada ${chart.peak.value} nós às ${chart.peak.hour}.`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        <path d={chart.band} fill={`url(#${gradientId})`} />
        <path
          d={chart.gustLine}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
          opacity="0.85"
        />
        <path
          d={chart.knotLine}
          fill="none"
          stroke="#06b6d4"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
          className="drop-shadow-[0_0_6px_rgba(6,182,212,0.6)]"
        />

        {chart.now && (
          <line
            x1={chart.now.x}
            y1="0"
            x2={chart.now.x}
            y2={H}
            stroke="#f43f5e"
            strokeWidth="1.5"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
            opacity="0.8"
          />
        )}
      </svg>

      <div className="flex justify-between text-[10px] font-bold text-slate-400 mt-0.5">
        {chart.labels.map((l) => (
          <span key={l.hour}>{l.hour}</span>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-800 text-[10px] font-bold">
        <span className="flex items-center gap-1.5 text-cyan-300">
          <span className="w-3 h-0.5 bg-cyan-400 rounded-full" aria-hidden="true" />
          média
        </span>
        <span className="flex items-center gap-1.5 text-amber-300">
          <span
            className="w-3 h-0.5 rounded-full border-t-2 border-dashed border-amber-400"
            aria-hidden="true"
          />
          rajada
        </span>
      </div>
    </div>
  );
};
