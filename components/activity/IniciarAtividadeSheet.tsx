'use client';

import React, { useState } from 'react';
import { AlertCircle, ChevronRight, Compass, Link2, MapPin, Navigation, Share2, Users, X } from 'lucide-react';
import { Spot } from '@/types';
import { DownwindAtivo } from '@/context/DownwindContext';
import { determinarAtividadeAtual } from '@/lib/activity';

interface IniciarAtividadeSheetProps {
  isOpen: boolean;
  onClose: () => void;
  selectedSpot: Spot | null;
  downwindAtivo: DownwindAtivo | null;
  modoNavegacaoAtivo: boolean;
  onIniciarVelejoSolo: () => void;
  onAbrirCriarDownwind: () => void;
  onAbrirEntrarPorLink: () => void;
  onContinuarDownwindAtivo: () => void;
  onCompartilharSoloLink?: () => void;
}

export const IniciarAtividadeSheet: React.FC<IniciarAtividadeSheetProps> = ({
  isOpen,
  onClose,
  selectedSpot,
  downwindAtivo,
  modoNavegacaoAtivo,
  onIniciarVelejoSolo,
  onAbrirCriarDownwind,
  onAbrirEntrarPorLink,
  onContinuarDownwindAtivo,
  onCompartilharSoloLink,
}) => {
  if (!isOpen) return null;

  const atividade = determinarAtividadeAtual({ modoNavegacaoAtivo, downwindAtivo });
  const temBloqueio = !atividade.podeIniciarOutra;

  return (
    <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-xs p-3 animate-in fade-in duration-200">
      <div className="w-full max-w-sm bg-[#0F172A] border border-slate-800 rounded-3xl shadow-2xl p-5 space-y-4 overlay-safe-bottom">
        <div className="flex items-center justify-between pb-1 border-b border-slate-800/80">
          <div>
            <h2 className="text-base font-black text-white">Iniciar Atividade</h2>
            {selectedSpot ? (
              <p className="text-xs text-cyan-400 flex items-center gap-1 mt-0.5">
                <MapPin size={12} />
                <span>{selectedSpot.name}</span>
              </p>
            ) : (
              <p className="text-xs text-slate-400">Escolha o tipo de velejo</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Alerta de Atividade já em andamento */}
        {temBloqueio && (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 text-amber-400 mt-0.5" />
              <p className="font-bold">{atividade.motivoBloqueio}</p>
            </div>
            {atividade.tipo === 'downwind' && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onContinuarDownwindAtivo();
                }}
                className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all active:scale-98"
              >
                <Compass size={16} />
                <span>Continuar Downwind Ativo</span>
              </button>
            )}
          </div>
        )}

        <div className="space-y-2.5">
          {/* Opção 1: Velejo Solo (com início rápido e opção de convite/apoio) */}
          <div
            className={`rounded-2xl border transition-all ${
              temBloqueio
                ? 'opacity-40 pointer-events-none bg-slate-950/40 border-slate-800'
                : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                onClose();
                onIniciarVelejoSolo();
              }}
              disabled={temBloqueio}
              className="w-full p-3.5 text-left flex items-center gap-3 active:scale-98 transition-all"
            >
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Navigation size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="font-black text-sm text-white">Velejo Solo</p>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    Rápido
                  </span>
                </div>
                <p className="text-xs text-slate-400">Modo Navegação com odômetro e velocidade</p>
              </div>
            </button>

            {/* Ação secundária: Compartilhar / Convidar apoio para o velejo solo */}
            {!temBloqueio && onCompartilharSoloLink && (
              <div className="px-3.5 pb-3 pt-1 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Quer que alguém em terra acompanhe?</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCompartilharSoloLink();
                  }}
                  className="text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1 active:scale-95 transition-all"
                >
                  <Share2 size={12} />
                  <span>Convidar apoio</span>
                </button>
              </div>
            )}
          </div>

          {/* Opção 2: Criar Downwind em Grupo (DW) */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onAbrirCriarDownwind();
            }}
            disabled={temBloqueio}
            className={`w-full p-3.5 rounded-2xl border text-left flex items-center gap-3 transition-all ${
              temBloqueio
                ? 'opacity-40 pointer-events-none bg-slate-950/40 border-slate-800'
                : 'bg-slate-900/90 hover:bg-slate-800 border-slate-800 hover:border-slate-700 active:scale-98'
            }`}
          >
            <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Users size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-sm text-white">Criar Downwind em Grupo (DW)</p>
              <p className="text-xs text-slate-400">Mapa ao vivo do grupo, chat da travessia e apoio</p>
            </div>
            <ChevronRight size={16} className="text-slate-600 shrink-0" />
          </button>

          {/* Opção 3: Entrar por Link de Convite */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onAbrirEntrarPorLink();
            }}
            disabled={temBloqueio}
            className={`w-full p-3.5 rounded-2xl border text-left flex items-center gap-3 transition-all ${
              temBloqueio
                ? 'opacity-40 pointer-events-none bg-slate-950/40 border-slate-800'
                : 'bg-slate-900/90 hover:bg-slate-800 border-slate-800 hover:border-slate-700 active:scale-98'
            }`}
          >
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Link2 size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-sm text-white">Entrar por Link ou Convite</p>
              <p className="text-xs text-slate-400">Insira o código/link de um downwind existente</p>
            </div>
            <ChevronRight size={16} className="text-slate-600 shrink-0" />
          </button>
        </div>
      </div>
    </div>
  );
};