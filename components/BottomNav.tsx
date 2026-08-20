'use client';

import React, { useEffect, useRef } from 'react';
import {
  Compass,
  Flame,
  MessageSquare,
  Star,
  User as UserIcon,
  Wind,
} from 'lucide-react';
import { ActiveTab, useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';
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
  } = useKiteData();
  const { user } = useAuth();
  // No wrapper (não no <nav>): o wrapper já inclui o padding da safe-area
  // (safe-area-pb) por baixo da pílula, então medir dele dá a distância real
  // até o topo da pílula em qualquer iPhone, com ou sem notch.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Com interactive-widget=resizes-content o teclado encolhe a viewport em vez
  // de sobrepô-la, então a diferença de altura fica ~0 e não serve de sinal.
  // O hook combina foco em campo editável (toque) + diferença de viewport.
  const isKeyboardOpen = useKeyboardVisible();

  /*
   * Publica em --nav-h a distância real do fundo da tela até o topo da
   * pílula — não a altura da pílula em si mais um número solto.
   *
   * Era `nav.height + 20`, que ignorava a safe-area (o "queixo" do iPhone) e o
   * `bottom-1.5` do wrapper. Num iPhone com notch (safe-area ~34px) isso
   * subestimava a distância real em ~20px: o SpotDetailModal (que usa
   * `.bottom-nav-gap { bottom: var(--nav-h) }` para parar bem acima do menu)
   * na verdade parava 20px ABAIXO do topo da pílula — cobrindo o terço
   * superior dela. Resultado: a borda reta do modal cortava o menu
   * flutuante ao meio, como uma linha por cima dos ícones.
   */
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const publicar = () => {
      const distanciaAoTopo = window.innerHeight - el.getBoundingClientRect().top;
      document.documentElement.style.setProperty('--nav-h', `${Math.round(distanciaAoTopo)}px`);
    };

    publicar();

    /*
     * ORIGEM DA "TARJA ESCURA NO RODAPÉ", que já voltou várias vezes: o valor
     * acima depende de `window.innerHeight`, mas o ResizeObserver só dispara
     * quando o TAMANHO do wrapper muda. Quando é a VIEWPORT que muda e o
     * wrapper continua idêntico, nada recalcula, e --nav-h congela com um
     * valor de uma tela que não existe mais. Como `.app-scroll` reserva
     * `padding-bottom: calc(var(--nav-h) + ...)`, a folga passa a ser maior
     * que o menu real e sobra a faixa vazia embaixo.
     *
     * Isso acontece toda vez que a altura útil muda sem mexer no menu: a barra
     * do Safari aparecendo/sumindo ao rolar, rotação de tela, e um overlay de
     * tela cheia (`fixed inset-0`, como o Modo Navegação) entrando e saindo.
     *
     * `visualViewport` é ouvido junto porque no iOS é ele — e não `window` —
     * quem reflete a área realmente visível quando a barra do navegador ou o
     * teclado entram em cena.
     */
    // `publicar` lê `getBoundingClientRect`, que força reflow, e o `scroll` da
    // visualViewport dispara em rajada no iOS. Coalescemos num frame para não
    // martelar o layout durante a rolagem.
    let frame = 0;
    const publicarNoProximoFrame = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        publicar();
      });
    };

    const observer = new ResizeObserver(publicarNoProximoFrame);
    observer.observe(el);
    window.addEventListener('resize', publicarNoProximoFrame);
    window.addEventListener('orientationchange', publicarNoProximoFrame);
    window.visualViewport?.addEventListener('resize', publicarNoProximoFrame);
    window.visualViewport?.addEventListener('scroll', publicarNoProximoFrame);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', publicarNoProximoFrame);
      window.removeEventListener('orientationchange', publicarNoProximoFrame);
      window.visualViewport?.removeEventListener('resize', publicarNoProximoFrame);
      window.visualViewport?.removeEventListener('scroll', publicarNoProximoFrame);
    };
  }, []);

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

  // Quando o teclado virtual está aberto, o menu inferior é ocultado para não competir com a digitação
  if (isKeyboardOpen) return null;

  return (
    /* Barra Flutuante estilo Instagram rebaixada e elegante */
    <div ref={wrapperRef} className="fixed bottom-1.5 inset-x-0 z-chrome pointer-events-none flex justify-center px-3 safe-area-pb">
      <nav
        className={`pointer-events-auto w-full max-w-[390px] h-[58px] px-2 rounded-full flex items-center justify-between transition-all duration-300 shadow-2xl shadow-black/70 border backdrop-blur-2xl ${
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
          className={`relative h-11 px-3.5 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 ${
            isTabActive('favoritos')
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          aria-label="Spots e Previsão"
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
          className={`relative h-11 px-3.5 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 ${
            isTabActive('mapa')
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          aria-label="Mapa"
          aria-current={isTabActive('mapa') ? 'page' : undefined}
        >
          <Compass
            size={22}
            className={`transition-transform duration-200 ${
              isTabActive('mapa') ? 'scale-110 stroke-[2.4] text-cyan-300' : 'stroke-[1.8]'
            }`}
          />
        </button>

        {/* 3. Destaques (Feed) */}
        <button
          type="button"
          onClick={() => handleTabClick('destaques')}
          className={`relative h-11 px-3.5 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 ${
            isTabActive('destaques')
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          aria-label="Feed de Destaques"
          aria-current={isTabActive('destaques') ? 'page' : undefined}
        >
          <Flame
            size={22}
            className={`transition-transform duration-200 ${
              isTabActive('destaques') ? 'scale-110 fill-current text-emerald-300 stroke-[2.2]' : 'stroke-[1.8]'
            }`}
          />
        </button>

        {/* 4. Chat */}
        <button
          type="button"
          onClick={() => handleTabClick('chat')}
          className={`relative h-11 px-3.5 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 ${
            isTabActive('chat')
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          aria-label="Chat dos Velejadores"
          aria-current={isTabActive('chat') ? 'page' : undefined}
        >
          <MessageSquare
            size={22}
            className={`transition-transform duration-200 ${
              isTabActive('chat') ? 'scale-110 stroke-[2.4] text-cyan-300' : 'stroke-[1.8]'
            }`}
          />
        </button>

        {/* 5. Perfil / Gaveta Lateral */}
        <button
          type="button"
          onClick={() => setIsSidebarOpen(true)}
          className="relative h-11 px-2.5 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95"
          aria-label="Meu Perfil e Menu"
        >
          <div className="w-8 h-8 rounded-full overflow-hidden ring-2 ring-white/30 hover:ring-cyan-400/80 transition-all flex items-center justify-center bg-slate-800 shadow-sm">
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <UserIcon size={16} className="text-slate-300" />
            )}
          </div>
        </button>
      </nav>
    </div>
  );
};
