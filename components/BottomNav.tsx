'use client';

import React from 'react';
import {
  Compass,
  Flame,
  MessageSquare,
  Play,
  Wind,
} from 'lucide-react';
import { ActiveTab, useKiteData } from '../context/KiteDataContext';
import { useKeyboardVisible } from '../lib/useKeyboardVisible';

export const BottomNav: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    beachMode,
    selectedSpot,
    setSelectedSpot,
    setIsSidebarOpen,
    setIsLoggerOpen,
    setIsCalculatorOpen,
    abrirIniciarAtividade,
    unreadChatCount,
    dmUnreadCount,
  } = useKiteData();

  // Com interactive-widget=resizes-content o teclado encolhe a viewport em vez
  // de sobrepô-la, então a diferença de altura fica ~0 e não serve de sinal.
  // O hook combina foco em campo editável (toque) + diferença de viewport.
  const isKeyboardOpen = useKeyboardVisible();

  const totalChatUnread = unreadChatCount + dmUnreadCount;

  // `--nav-h` (a distância do fundo da tela até o topo desta pílula) é uma
  // constante CSS pura em app/globals.css — não é medida em runtime aqui.
  const handleTabClick = (tab: ActiveTab) => {
    if (selectedSpot) {
      setSelectedSpot(null);
    }
    setIsSidebarOpen(false);
    setIsLoggerOpen(false);
    setIsCalculatorOpen(false);
    setActiveTab(tab);
  };

  const isTabActive = (tab: ActiveTab) => activeTab === tab && !selectedSpot;

  // O menu flutuante é parte permanente da navegação. Ele só sai enquanto o
  // teclado virtual ocupa a tela; um downwind ativo não pode sequestrar nem
  // remover a navegação principal.
  if (isKeyboardOpen) return null;

  return (
    /* Barra Flutuante estilo Instagram rebaixada e elegante com PLAY central */
    <div className="fixed bottom-1.5 inset-x-0 z-chrome pointer-events-none flex justify-center px-3 safe-area-pb">
      <nav
        className={`pointer-events-auto w-full max-w-[390px] h-[58px] px-2.5 rounded-full flex items-center justify-between transition-all duration-300 shadow-2xl shadow-black/70 border backdrop-blur-2xl ${
          beachMode
            ? 'bg-[#020617]/90 border-slate-700/80 text-slate-300'
            : 'bg-[#0B1220]/85 border-white/15 text-slate-300'
        }`}
        role="navigation"
        aria-label="Navegação principal flutuante"
      >
        {/* 1. Spots / Previsão */}
        <button
          type="button"
          onClick={() => handleTabClick('favoritos')}
          className={`relative h-11 px-3 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 ${
            isTabActive('favoritos')
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          aria-label="Spots e Previsão"
          title="Spots e Previsão de Vento"
          aria-current={isTabActive('favoritos') ? 'page' : undefined}
        >
          <Wind
            size={22}
            className={`transition-transform duration-200 ${
              isTabActive('favoritos') ? 'scale-110 stroke-[2.4] text-cyan-300' : 'stroke-[1.8]'
            }`}
          />
        </button>

        {/* 2. Mapa */}
        <button
          type="button"
          onClick={() => handleTabClick('mapa')}
          className={`relative h-11 px-3 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 ${
            isTabActive('mapa')
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          aria-label="Mapa"
          title="Mapa Interativo de Spots e Downwind"
          aria-current={isTabActive('mapa') ? 'page' : undefined}
        >
          <Compass
            size={22}
            className={`transition-transform duration-200 ${
              isTabActive('mapa') ? 'scale-110 stroke-[2.4] text-cyan-300' : 'stroke-[1.8]'
            }`}
          />
        </button>

        {/* 3. BOTÃO CENTRAL: PLAY / Iniciar Velejo & Downwind */}
        <button
          type="button"
          onClick={abrirIniciarAtividade}
          className="relative -top-2 flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-br from-cyan-400 via-cyan-500 to-blue-600 text-slate-950 shadow-lg shadow-cyan-500/40 border-2 border-[#0B1220] active:scale-90 hover:scale-105 transition-all duration-200"
          aria-label="Iniciar Velejo ou Downwind"
          title="Iniciar Velejo Solo ou Criar Downwind"
        >
          <Play size={20} className="fill-slate-950 stroke-[1.8] translate-x-0.5" />
        </button>

        {/* 4. Feed da Comunidade (Timeline de Destaques e Sessões) */}
        <button
          type="button"
          onClick={() => handleTabClick('destaques')}
          className={`relative h-11 px-3 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 ${
            isTabActive('destaques')
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          aria-label="Feed da Comunidade Geral"
          title="Feed e Destaques da Comunidade"
          aria-current={isTabActive('destaques') ? 'page' : undefined}
        >
          <Flame
            size={22}
            className={`transition-transform duration-200 ${
              isTabActive('destaques') ? 'scale-110 fill-current text-emerald-300 stroke-[2.2]' : 'stroke-[1.8]'
            }`}
          />
        </button>

        {/* 5. Chat */}
        <button
          type="button"
          onClick={() => handleTabClick('chat')}
          className={`relative h-11 px-3 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 ${
            isTabActive('chat')
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          aria-label="Chat dos Velejadores"
          title="Chat dos Velejadores e DMs"
          aria-current={isTabActive('chat') ? 'page' : undefined}
        >
          <MessageSquare
            size={22}
            className={`transition-transform duration-200 ${
              isTabActive('chat') ? 'scale-110 stroke-[2.4] text-cyan-300' : 'stroke-[1.8]'
            }`}
          />
          {totalChatUnread > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-[#0B1220] animate-pulse" />
          )}
        </button>
      </nav>
    </div>
  );
};
