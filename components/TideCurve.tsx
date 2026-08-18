'use client';

import React, { useId, useMemo } from 'react';
import type { WindForecastHour } from '../types';

interface TideCurveProps {
  hours: WindForecastHour[];
  /** Hora local "HH" do momento, para posicionar o marcador de agora. */
  currentHour?: number;
  currentHeightM?: number;
  trend?: string;
}

const W = 400;
const H = 90;
const PAD_Y = 12;

/**
 * Curva de maré desenhada a partir das alturas horárias reais (Open-Meteo
 * marine). Não é uma senoide decorativa: cada ponto é um dado medido, e os
 * marcadores de preia-mar/baixa-mar saem dos picos que a própria série indica.
 *
 * Por que interpolar com Catmull-Rom convertido para Bézier: ligar os pontos
 * com retas mostraria a maré em "degraus", o que não corresponde a como a água
 * sobe. A suavização é visual; os pontos-âncora continuam sendo os dados reais.
 */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length < 3) {
    return `M ${points.map((p) => `${p.x},${p.y}`).join(' L ')}`;
  }

  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    // Tensão 1/6 é o fator padrão que faz a Catmull-Rom passar exatamente
    // pelos pontos, sem "estufar" entre eles.
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

export const TideCurve: React.FC<TideCurveProps> = ({
  hours,
  currentHour,
  currentHeightM,
  trend,
}) => {
  // useId evita colisão de id de gradiente quando dois gráficos coexistem na
  // página — ids duplicados em SVG fazem um herdar o preenchimento do outro.
  const gradientId = useId();

  const chart = useMemo(() => {
    /* Só entram horas com altura medida. Tratar ausência como 0 desenhava uma
       curva que ia ao fundo do gráfico e sugeria maré seca onde só faltava
       dado — leitura oposta à realidade para quem depende de laguna cheia. */
    const amostras = hours
      .map((h, i) => ({ h, i }))
      .filter((s): s is { h: (typeof hours)[number] & { tideHeightM: number }; i: number } =>
        typeof s.h.tideHeightM === 'number'
      );
    if (amostras.length === 0) return null;

    const levels = amostras.map((s) => s.h.tideHeightM);
    const min = Math.min(...levels);
    const max = Math.max(...levels);
    // Série achatada (maré parada) não pode virar divisão por zero.
    const span = max - min < 0.05 ? 1 : max - min;

    // O eixo X segue o índice da hora original, senão um buraco no meio da
    // série comprimiria o gráfico e desalinharia da tabela ao lado.
    const ultimoIdx = Math.max(1, hours.length - 1);
    const toX = (i: number) => (i / ultimoIdx) * W;
    const toY = (v: number) => H - PAD_Y - ((v - min) / span) * (H - PAD_Y * 2);

    const points = amostras.map((s) => ({ x: toX(s.i), y: toY(s.h.tideHeightM) }));

    const peaks = amostras
      .filter(({ h }) => h.tideTrend === 'peak_high' || h.tideTrend === 'peak_low')
      .map(({ h, i }) => ({
        x: toX(i),
        y: toY(h.tideHeightM),
        high: h.tideTrend === 'peak_high',
        time: h.tidePeakTime ?? h.hour,
        height: h.tideHeightM,
      }));

    const nowIdx =
      currentHour == null
        ? -1
        : amostras.findIndex((s) => Number(s.h.hour.replace('h', '')) === currentHour);

    return {
      line: smoothPath(points),
      area: `${smoothPath(points)} L ${W},${H} L 0,${H} Z`,
      peaks,
      now:
        nowIdx >= 0
          ? { x: toX(amostras[nowIdx].i), y: toY(amostras[nowIdx].h.tideHeightM) }
          : null,
      min,
      max,
    };
  }, [hours, currentHour]);

  if (!chart) {
    return (
      <p className="text-xs text-slate-400 py-6 text-center">
        Sem dados de maré para este ponto.
      </p>
    );
  }

  const highs = chart.peaks.filter((p) => p.high);
  const lows = chart.peaks.filter((p) => !p.high);

  return (
    <div className="space-y-3">
      <div className="relative w-full bg-[#0F172A] rounded-2xl p-3 border border-cyan-500/30 overflow-hidden shadow-inner">
        <svg
          className="w-full h-28 overflow-visible"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Curva de maré das próximas horas. Variação de ${chart.min.toFixed(
            2
          )} a ${chart.max.toFixed(2)} metros.`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.45" />
              <stop offset="50%" stopColor="#0284c7" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
            </linearGradient>
          </defs>

          <path d={chart.area} fill={`url(#${gradientId})`} />
          <path
            d={chart.line}
            fill="none"
            stroke="#06b6d4"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
            className="drop-shadow-[0_0_10px_rgba(6,182,212,0.8)]"
          />

          {chart.peaks.map((p, i) => (
            <circle
              key={`${p.time}-${i}`}
              cx={p.x}
              cy={p.y}
              r="4.5"
              fill={p.high ? '#10b981' : '#38bdf8'}
            />
          ))}

          {chart.now && (
            <>
              <circle
                cx={chart.now.x}
                cy={chart.now.y}
                r="7"
                fill="#f43f5e"
                className="animate-ping opacity-75"
              />
              <circle cx={chart.now.x} cy={chart.now.y} r="5" fill="#f43f5e" />
            </>
          )}
        </svg>

        {currentHeightM != null && (
          <div className="flex items-center justify-end text-xs font-bold text-slate-300 pt-1 border-t border-slate-800">
            <span className="text-rose-400 font-black">
              Nível agora: {currentHeightM.toFixed(2)}m{trend ? ` (${trend})` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Só renderiza os marcos que a série realmente contém — nada de slot
          fixo de "1ª/2ª preia-mar" que ficaria vazio ou inventado. */}
      {chart.peaks.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[...highs, ...lows]
            .sort((a, b) => a.time.localeCompare(b.time))
            .map((p, i) => (
              <div
                key={`${p.time}-${i}`}
                className="p-3 rounded-2xl bg-[#0F172A] border border-slate-700 text-center shadow-sm"
              >
                <span className="block text-[10px] text-slate-400 uppercase font-black">
                  {p.high ? 'Preia-mar' : 'Baixa-mar'}
                </span>
                <span
                  className={`text-lg font-black ${
                    p.high ? 'text-emerald-400' : 'text-cyan-400'
                  }`}
                >
                  {p.time}
                </span>
                <span className="block text-xs font-bold text-slate-300">
                  {p.height.toFixed(2)} m
                </span>
              </div>
            ))}
        </div>
      )}

      <p className="text-[11px] text-slate-400 leading-relaxed">
        Altura do nível do mar em metros (m), modelada pela Open-Meteo Marine, por hora.
        Para navegação use a tábua oficial da Marinha do Brasil (DHN).
      </p>
    </div>
  );
};
