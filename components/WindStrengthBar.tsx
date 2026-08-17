'use client';

import React from 'react';
import { getWindBand, getWindIntensity, getWindTailwindColor } from '../lib/windScale';

interface WindStrengthBarProps {
  /** Vento médio em nós */
  knots: number;
  /** Rajada máxima em nós (opcional, para sobreposição) */
  gustKnots?: number;
  /** Largura total da barra em pixels ou % (default 100%) */
  width?: string | number;
  /** Altura da barra em pixels (default 6) */
  height?: number;
  /** Se true, mostra só a barra de vento médio (sem sobreposição de rajada) */
  simple?: boolean;
  /** Classe adicional para container */
  className?: string;
}

/**
 * Barra visual de intensidade do vento.
 *
 * Mostra a força do vento como uma barra colorida:
 * - Fundo preenchido proporcional ao vento médio
 * - Sobreposição mais curta mostrando a rajada (gust)
 *
 * A barra é decorativa e não captura interação (pointer-events-none).
 * O texto ao lado continua sendo a informação acessível para leitores de tela.
 * aria-hidden=true evita duplicação de informação.
 */
export const WindStrengthBar: React.FC<WindStrengthBarProps> = ({
  knots,
  gustKnots,
  width = '100%',
  height = 6,
  simple = false,
  className = '',
}) => {
  // Obtém a faixa e intensidade
  const band = getWindBand(knots);
  const colorBase = getWindTailwindColor(knots);
  const intensity = getWindIntensity(knots);

  // Intensidade da rajada (se fornecida)
  const gustIntensity = gustKnots != null ? getWindIntensity(gustKnots) : undefined;

  // Classes Tailwind derivadas da cor base
  const bgClass = `bg-${colorBase}-500`;

  // Se a rajada é maior que o vento médio, mostra a extensão da rajada
  const showGustExtension = !simple && gustIntensity != null && gustIntensity > intensity;

  return (
    <div
      className={`relative overflow-hidden rounded-full ${className}`}
      style={{ width, height }}
      role="presentation"
      aria-hidden="true"
    >
      {/* Fundo cinza da barra (track) */}
      <div
        className="absolute inset-0 bg-slate-800"
        style={{ width: '100%', height: '100%' }}
      />

      {/* Barra do vento médio */}
      <div
        className={`absolute top-0 left-0 h-full ${bgClass}`}
        style={{ width: `${intensity * 100}%` }}
      />

      {/* Extensão da rajada - aparece como continuação quando a rajada é mais forte que a média */}
      {showGustExtension && (
        <div
          className={`absolute top-0 left-0 h-full ${bgClass}`}
          style={{ width: `${gustIntensity! * 100}%` }}
        />
      )}
    </div>
  );
};
