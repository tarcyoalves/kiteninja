import { Discipline } from '../types';

export function getWindColorClass(knots: number): {
  bg: string;
  text: string;
  badge: string;
  gradient: string;
  border: string;
  glow: string;
} {
  if (knots < 12) {
    return {
      bg: 'bg-sky-500',
      text: 'text-sky-400',
      badge: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
      gradient: 'from-sky-500/35 via-sky-500/10 to-transparent',
      border: 'border-sky-500/40',
      glow: 'shadow-sky-500/30',
    };
  }
  if (knots < 17) {
    return {
      bg: 'bg-cyan-500',
      text: 'text-cyan-400',
      badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
      gradient: 'from-cyan-500/35 via-cyan-500/10 to-transparent',
      border: 'border-cyan-500/40',
      glow: 'shadow-cyan-500/30',
    };
  }
  if (knots < 23) {
    return {
      bg: 'bg-emerald-500',
      text: 'text-emerald-400',
      badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
      gradient: 'from-emerald-500/45 via-emerald-500/15 to-transparent',
      border: 'border-emerald-500/40',
      glow: 'shadow-emerald-500/40',
    };
  }
  if (knots < 28) {
    return {
      bg: 'bg-amber-500',
      text: 'text-amber-400',
      badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      gradient: 'from-amber-500/45 via-amber-500/15 to-transparent',
      border: 'border-amber-500/40',
      glow: 'shadow-amber-500/40',
    };
  }
  return {
    bg: 'bg-rose-500',
    text: 'text-rose-400',
    badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    gradient: 'from-rose-500/45 via-rose-500/15 to-transparent',
    border: 'border-rose-500/40',
    glow: 'shadow-rose-500/40',
  };
}

export function calculateKiteSize(weightKg: number, knots: number, discipline: Discipline = 'Kitesurf Twintip'): {
  recommendedSize: number;
  minSize: number;
  maxSize: number;
  suitable: boolean;
  statusMessage: string;
} {
  if (knots <= 6) {
    return {
      recommendedSize: 17,
      minSize: 15,
      maxSize: 19,
      suitable: false,
      statusMessage: 'Vento insuficiente para velejo seguro (Abaixo de 7 nós).',
    };
  }

  let baseFactor = 1.0;
  if (discipline === 'Hydrofoil') baseFactor = 0.65;
  if (discipline === 'Wingfoil') baseFactor = 0.55;
  if (discipline === 'Kitesurf Strapless Wave') baseFactor = 0.85;
  if (discipline === 'Big Air') baseFactor = 0.95;

  // Formula: Standard 75kg rider in 20kts = ~9m kite
  const ideal = (75 / weightKg) > 0 ? (weightKg / 75) * (180 / knots) * baseFactor : 9;
  const rounded = Math.round(ideal * 10) / 10;
  const clamped = Math.max(3, Math.min(21, rounded));

  let statusMessage = 'Condição ideal para este tamanho.';
  if (knots >= 28) statusMessage = 'Vento extremo! Veleje apenas com experiência e kite pequeno.';
  if (knots < 13 && discipline === 'Kitesurf Twintip') statusMessage = 'Vento limite para prancha twintip, prefira prancha grande ou foil.';

  return {
    recommendedSize: Math.round(clamped * 2) / 2, // Round to nearest 0.5m
    minSize: Math.max(3, Math.round((clamped - 1.5) * 2) / 2),
    maxSize: Math.min(21, Math.round((clamped + 1.5) * 2) / 2),
    suitable: knots >= 10,
    statusMessage,
  };
}

export function getWindDirectionArrow(deg: number): string {
  // Arrow rotation style
  return `rotate(${deg}deg)`;
}

export function getSafetyBadgeColor(safety: string): { bg: string; text: string; border: string } {
  switch (safety) {
    case 'Side-Onshore':
      return { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' };
    case 'Side-Shore':
      return { bg: 'bg-teal-500/15', text: 'text-teal-400', border: 'border-teal-500/30' };
    case 'Onshore':
      return { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' };
    case 'Side-Offshore':
      return { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30' };
    case 'Offshore':
      return { bg: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-500/30' };
    default:
      return { bg: 'bg-zinc-500/15', text: 'text-zinc-400', border: 'border-zinc-500/30' };
  }
}
