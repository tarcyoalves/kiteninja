'use client';

import React, { useState } from 'react';
import { X, Calculator, Wind, Scale, Sparkles, ShieldCheck, AlertCircle } from 'lucide-react';
import { useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';
import { Discipline } from '../types';
import { calculateKiteSize, getWindColorClass, type WindStability } from '../lib/windUtils';

export const KiteCalculatorModal: React.FC = () => {
  const { isCalculatorOpen, setIsCalculatorOpen, windUnit, convertWind } = useKiteData();
  const { user, updateProfile } = useAuth();

  const [weightKg, setWeightKg] = useState(user?.weightKg || 78);
  const [knots, setKnots] = useState(20);
  const [discipline, setDiscipline] = useState<Discipline>('Kitesurf Twintip');
  const [stability, setStability] = useState<WindStability>('lagoa');

  if (!isCalculatorOpen) return null;

  const result = calculateKiteSize(weightKg, knots, discipline, stability);
  const windColors = getWindColorClass(knots);

  const getBoardRecommendation = () => {
    switch (discipline) {
      case 'Kitesurf Twintip':
        if (weightKg < 65) return 'Prancha 132cm - 134cm';
        if (weightKg < 82) return 'Prancha 136cm - 138cm';
        return 'Prancha 140cm - 142cm (ou Prancha Door para vento fraco)';
      case 'Hydrofoil':
        return 'Mastro 75-85cm / Asa Frontal 950cm² a 1250cm²';
      case 'Wingfoil':
        return `Prancha Volume ${Math.round(weightKg + 10)}L a ${Math.round(weightKg + 25)}L / Foil 1400cm²`;
      case 'Kitesurf Strapless Wave':
        return "Prancha Surf 5'6\" a 5'10\" com volume ~25L";
      default:
        return 'Prancha Twintip 136cm';
    }
  };

  const handleSaveUserWeight = () => {
    updateProfile({ weightKg });
    alert(`Peso atualizado para ${weightKg}kg no seu perfil de rider!`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/75 backdrop-blur-xs overflow-y-auto">
      <div className="bg-[#0F172A] text-slate-100 rounded-3xl w-full max-w-md overflow-hidden border border-slate-800 shadow-2xl my-6">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-5 py-4 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2.5">
            <Calculator size={22} className="text-white" />
            <h2 className="font-black text-base sm:text-lg text-white tracking-wide">Calculadora de Pipa & Equipamento</h2>
          </div>
          <button
            onClick={() => setIsCalculatorOpen(false)}
            className="p-2 rounded-full bg-black/20 hover:bg-black/40 text-white transition-colors min-w-11 min-h-11 flex items-center justify-center"
            aria-label="Fechar calculadora"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 text-xs">
          {/* Discipline Selector */}
          <div>
            <label className="block font-bold text-slate-300 mb-1.5">Sua Modalidade</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(['Kitesurf Twintip', 'Hydrofoil', 'Wingfoil', 'Kitesurf Strapless Wave'] as Discipline[]).map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDiscipline(d)}
                  className={`p-2.5 rounded-xl font-bold text-left transition-all border ${
                    discipline === d
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-xs'
                      : 'bg-[#1E293B] border-slate-700/80 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Estabilidade do vento: muda a recomendação de verdade, porque
              dimensionar pela média em vento rajado deixa sobrepipado no pico. */}
          <div>
            <label className="block font-bold text-slate-300 mb-1.5">Condição do Vento</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { key: 'lagoa' as const, label: 'Limpo / Lagoa', hint: 'constante' },
                  { key: 'rajado' as const, label: 'Rajado / Mar aberto', hint: 'com margem' },
                ]
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setStability(opt.key)}
                  aria-pressed={stability === opt.key}
                  className={`p-2.5 rounded-xl font-bold text-left transition-all border ${
                    stability === opt.key
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-xs'
                      : 'bg-[#1E293B] border-slate-700/80 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <span className="block">{opt.label}</span>
                  <span className="block text-[10px] font-medium text-slate-400 mt-0.5">
                    {opt.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Weight Slider */}
          <div className="p-3.5 bg-[#1E293B] rounded-2xl border border-slate-700/80 space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-black text-slate-200 flex items-center gap-1.5">
                <Scale size={15} className="text-cyan-400" />
                <span>Peso do Velejador</span>
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-xl font-black text-cyan-400 font-sans">{weightKg}</span>
                <span className="font-bold text-slate-400">kg</span>
                {user && user.weightKg !== weightKg && (
                  <button
                    onClick={handleSaveUserWeight}
                    className="ml-2 text-[10px] font-black px-2.5 py-0.5 rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 shadow-xs"
                  >
                    Salvar
                  </button>
                )}
              </div>
            </div>
            <input
              type="range"
              min="45"
              max="120"
              value={weightKg}
              onChange={e => setWeightKg(Number(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer h-2 bg-slate-800 rounded-lg"
            />
            <div className="flex justify-between text-[10px] text-slate-400 font-medium">
              <span>45 kg</span>
              <span>80 kg</span>
              <span>120 kg</span>
            </div>
          </div>

          {/* Knots Slider */}
          <div className="p-3.5 bg-[#1E293B] rounded-2xl border border-slate-700/80 space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-black text-slate-200 flex items-center gap-1.5">
                <Wind size={15} className="text-emerald-400" />
                <span>Força do Vento na Praia</span>
              </span>
              <div className="flex items-center gap-1">
                <span className="text-xl font-black font-sans text-emerald-400">
                  {knots}
                </span>
                <span className="font-bold text-slate-400">nós</span>
                <span className="text-[11px] text-slate-400 ml-1">
                  (~{Math.round(knots * 1.852)} km/h)
                </span>
              </div>
            </div>
            <input
              type="range"
              min="8"
              max="36"
              value={knots}
              onChange={e => setKnots(Number(e.target.value))}
              className="w-full accent-emerald-400 cursor-pointer h-2 bg-slate-800 rounded-lg"
            />
            <div className="flex justify-between text-[10px] text-slate-400 font-medium">
              <span>8 nós (Foil)</span>
              <span>20 nós (Sweet Spot)</span>
              <span>35+ nós (Extremo)</span>
            </div>
          </div>

          {/* Big Result Card */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0F172A] border border-cyan-500/40 space-y-3 text-center relative overflow-hidden shadow-xl">
            <span className="text-[11px] font-black text-cyan-400 uppercase tracking-wider block">
              {discipline.includes('Wing') ? 'Tamanho da Asa (Wing)' : 'Tamanho da Pipa Recomendado'}
            </span>

            <div className="flex items-baseline justify-center gap-1.5 my-1">
              <span className="text-5xl font-black text-white leading-none font-sans drop-shadow-[0_0_15px_rgba(6,182,212,0.4)]">
                {result.recommendedSize}
              </span>
              <span className="text-xl font-black text-cyan-400">m²</span>
            </div>

            <div className="inline-block px-3.5 py-1 rounded-full bg-cyan-500/20 text-cyan-300 text-xs font-black border border-cyan-500/30">
              Faixa de conforto: {result.minSize}m² a {result.maxSize}m²
            </div>

            <div className="pt-2.5 border-t border-slate-800 text-left space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Prancha Indicada:</span>
                <span className="font-bold text-white">{getBoardRecommendation()}</span>
              </div>
              <p className="text-[11px] text-slate-300 italic text-center pt-1 font-medium">
                &ldquo;{result.statusMessage}&rdquo;
              </p>
            </div>
          </div>

          {/* Safety Beach Note */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#1E293B] border border-slate-700 text-[11px] text-slate-300">
            <ShieldCheck size={16} className="text-emerald-400 shrink-0 mt-0.5" />
            <span>
              Em caso de rajadas fortes, monte sempre a pipa do limite inferior da faixa recomendada. Cheque o leash e o quick-release antes de decolar.
            </span>
          </div>

          <button
            onClick={() => setIsCalculatorOpen(false)}
            className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-black text-xs transition-colors"
          >
            Fechar Calculadora
          </button>
        </div>
      </div>
    </div>
  );
};
