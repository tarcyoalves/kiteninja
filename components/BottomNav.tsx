'use client';

import React, { useEffect, useRef } from 'react';
import { Star, MapPin, Bell, MoreHorizontal, Compass, Flame, BookOpen } from 'lucide-react';
import { useKiteData } from '../context/KiteDataContext';

export const BottomNav: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    beachMode,
    safetyAlerts,
    selectedSpot,
    setSelectedSpot,
    setIsSidebarOpen,
    setIsLoggerOpen,
    setIsCalculatorOpen,
  } = useKiteData();
  const navRef = useRef<HTMLElement | null>(null);

  /* Publica a altura real em --nav-h para os modais em tela cheia pararem
     exatamente no topo do menu. Antes o CSS chumbava 4rem, mas o menu mede
     65px (h-16 + borda + safe area), e o 1px de diferença bastava para o
     overlay cobrir a primeira aba e engolir o toque. Medido > adivinhado:
     acompanha fonte grande do sistema e a barra de gestos do iPhone. */
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;

    const publicar = () => {
      document.documentElement.style.setProperty(
        '--nav-h',
        `${Math.round(el.getBoundingClientRect().height)}px`
      );
    };

    publicar();
    const observer = new ResizeObserver(publicar);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleTabClick = (tab: typeof activeTab) => {
    if (selectedSpot) {
      setSelectedSpot(null);
    }
    setIsSidebarOpen(false);
    setIsLoggerOpen(false);
    setIsCalculatorOpen(false);
    setActiveTab(tab);
  };

  const activeAlertsCount = safetyAlerts.filter(a => a.status === 'Ativo').length;

  return (
    /*
     * `shrink-0` e não `fixed`: o menu agora é um irmão do conteúdo dentro de um
     * shell flex de altura 100dvh. Isso elimina a aritmética de altura que
     * quebrava no modo web app instalado — antes cada tela subtraía 120px
     * chumbados de 100vh, número que só valia no Safari com barra de endereço.
     * Sendo parte do fluxo, o menu reserva o próprio espaço sozinho.
     */
    <nav
      ref={navRef}
      className={`shrink-0 z-chrome transition-colors border-t safe-area-pb ${
        beachMode
          ? 'bg-[#020617]/95 border-slate-800 backdrop-blur text-slate-400'
          : 'bg-[#0F172A]/95 border-slate-800/90 backdrop-blur text-slate-400 shadow-2xl'
      }`}
      role="navigation"
      aria-label="Navegação principal"
    >
      <div className="max-w-md mx-auto grid grid-cols-5 h-16 items-center px-1">
        {/* Tab 1: Favoritos */}
        <button
          onClick={() => handleTabClick('favoritos')}
          className={`flex flex-col items-center justify-center py-1.5 px-1 min-w-11 min-h-11 transition-all relative ${
            activeTab === 'favoritos' && !selectedSpot
              ? 'text-cyan-400 font-extrabold scale-105'
              : 'hover:text-slate-200 active:scale-95 text-slate-400'
          }`}
          aria-label="Favoritos"
          aria-current={activeTab === 'favoritos' && !selectedSpot ? 'page' : undefined}
        >
          <div className="relative">
            <Star
              size={22}
              className={`transition-transform ${
                activeTab === 'favoritos' ? 'fill-current stroke-[2.5] drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]' : 'stroke-[1.8]'
              }`}
            />
          </div>
          <span className="text-[11px] mt-0.5 tracking-tight font-bold">Favoritos</span>
        </button>

        {/* Tab 2: Mapa e pesquisa */}
        <button
          onClick={() => handleTabClick('mapa')}
          className={`flex flex-col items-center justify-center py-1.5 px-1 min-w-11 min-h-11 transition-all relative ${
            activeTab === 'mapa' && !selectedSpot
              ? 'text-cyan-400 font-extrabold scale-105'
              : 'hover:text-slate-200 active:scale-95 text-slate-400'
          }`}
          aria-label="Mapa"
          aria-current={activeTab === 'mapa' && !selectedSpot ? 'page' : undefined}
        >
          <div className="relative">
            <Compass
              size={22}
              className={`transition-transform ${
                activeTab === 'mapa' ? 'stroke-[2.5] text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]' : 'stroke-[1.8]'
              }`}
            />
          </div>
          <span className="text-[11px] mt-0.5 tracking-tight font-bold">Mapa</span>
        </button>

        {/* Tab 3: Destaques (Feed) */}
        <button
          onClick={() => handleTabClick('destaques')}
          className={`flex flex-col items-center justify-center py-1.5 px-1 min-w-11 min-h-11 transition-all relative ${
            activeTab === 'destaques' && !selectedSpot
              ? 'text-emerald-400 font-extrabold scale-105'
              : 'hover:text-slate-200 active:scale-95 text-slate-400'
          }`}
          aria-label="Destaques"
          aria-current={activeTab === 'destaques' && !selectedSpot ? 'page' : undefined}
        >
          <div className="relative">
            <Flame
              size={22}
              className={`transition-transform ${
                activeTab === 'destaques' ? 'fill-current stroke-[2.2] drop-shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'stroke-[1.8]'
              }`}
            />
          </div>
          <span className="text-[11px] mt-0.5 tracking-tight font-bold">Destaques</span>
        </button>

        {/* Tab 4: Sessões / Logbook */}
        <button
          onClick={() => handleTabClick('sessoes')}
          className={`flex flex-col items-center justify-center py-1.5 px-1 min-w-11 min-h-11 transition-all relative ${
            activeTab === 'sessoes' && !selectedSpot
              ? 'text-amber-400 font-extrabold scale-105'
              : 'hover:text-slate-200 active:scale-95 text-slate-400'
          }`}
          aria-label="Logbook de sessões"
          aria-current={activeTab === 'sessoes' && !selectedSpot ? 'page' : undefined}
        >
          <div className="relative">
            <BookOpen
              size={22}
              className={`transition-transform ${
                activeTab === 'sessoes' ? 'stroke-[2.5] text-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]' : 'stroke-[1.8]'
              }`}
            />
          </div>
          <span className="text-[11px] mt-0.5 tracking-tight font-bold">Logbook</span>
        </button>

        {/* Tab 5: Alertas & Mais */}
        <button
          onClick={() => handleTabClick('alertas')}
          className={`flex flex-col items-center justify-center py-1.5 px-1 min-w-11 min-h-11 transition-all relative ${
            (activeTab === 'alertas' || activeTab === 'mais') && !selectedSpot
              ? 'text-rose-400 font-extrabold scale-105'
              : 'hover:text-slate-200 active:scale-95 text-slate-400'
          }`}
          aria-label="Alertas de segurança"
          aria-current={(activeTab === 'alertas' || activeTab === 'mais') && !selectedSpot ? 'page' : undefined}
        >
          <div className="relative">
            <Bell
              size={22}
              className={`transition-transform ${
                activeTab === 'alertas' ? 'fill-current stroke-[2.2] drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]' : 'stroke-[1.8]'
              }`}
            />
            {activeAlertsCount > 0 && (
              <span className="absolute -top-1 -right-2 bg-rose-500 text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center ring-2 ring-[#0F172A] shadow-md">
                {activeAlertsCount}
              </span>
            )}
          </div>
          <span className="text-[11px] mt-0.5 tracking-tight font-bold">Alertas</span>
        </button>
      </div>
    </nav>);
};
