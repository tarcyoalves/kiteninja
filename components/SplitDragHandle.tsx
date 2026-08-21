'use client';

import React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

/**
 * Divisor entre mapa e chat na tela do motorista — a barra inteira é
 * arrastável (não só a "pinça" central), com os três atalhos de tamanho
 * dentro dela. Compartilhado entre views/DownwindAoVivoView.tsx e
 * app/dw-motorista/[token]/ConvidadoView.tsx via lib/useSplitArrastavel.ts.
 */
export const SplitDragHandle: React.FC<{
  handleProps: React.HTMLAttributes<HTMLDivElement>;
  onAtalho: (alvo: number) => void;
}> = ({ handleProps, onAtalho }) => {
  // Botão de atalho não deve também disparar o arrasto da barra: o clique
  // já muda a altura direto para o valor exato do atalho, e deixar o arrasto
  // "correr" a partir da posição do toque geraria um valor levemente
  // diferente do atalho pedido, um instante antes do clique aplicar o certo.
  const pararPropagacao = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <div
      {...handleProps}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Arraste para redimensionar mapa e chat"
      className="shrink-0 flex items-center justify-center gap-2 py-1.5 bg-[#0F172A] border-y border-slate-800 cursor-row-resize touch-none select-none"
    >
      <button
        type="button"
        onPointerDown={pararPropagacao}
        onClick={() => onAtalho(70)}
        className="flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 active:bg-cyan-500 active:text-slate-950 transition-colors"
        aria-label="Expandir o mapa"
      >
        <ChevronUp size={12} />
        Mapa
      </button>

      {/* A "pinça": alça visual central, só indicação — o arrasto funciona
          na barra inteira (touch alvo maior que os ~4px de uma alça fina
          sozinha seria inacessível no colo do motorista dirigindo). */}
      <div className="w-10 h-1.5 rounded-full bg-slate-700" />

      <button
        type="button"
        onPointerDown={pararPropagacao}
        onClick={() => onAtalho(30)}
        className="flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 active:bg-cyan-500 active:text-slate-950 transition-colors"
        aria-label="Expandir o chat"
      >
        <ChevronDown size={12} />
        Chat
      </button>
    </div>
  );
};
