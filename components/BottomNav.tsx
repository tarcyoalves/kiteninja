'use client';

import React from 'react';
import {
  BookOpen,
  Compass,
  MessageSquare,
  Newspaper,
  Play,
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
    abrirIniciarAtividade,
    setFeedAba,
    unreadChatCount,
    dmUnreadCount,
  } = useKiteData();
  const { user } = useAuth();

  // Com interactive-widget=resizes-content o teclado encolhe a viewport em vez
  // de sobrepô-la, então a diferença de altura fica ~0 e não serve de sinal.
  // O hook combina foco em campo editável (toque) + diferença de viewport.
  const isKeyboardOpen = useKeyboardVisible();
  const totalChatUnread = unreadChatCount + dmUnreadCount;

  // `--nav-h` (a distância do fundo da tela até o topo desta pílula) é uma
  // constante CSS pura em app/globals.css — não é medida em runtime aqui.
  const handleTabClick = (tab: ActiveTab) => {
    if (selectedSpot) setSelectedSpot(null);
    setIsSidebarOpen(false);
    setIsLoggerOpen(false);
    setIsCalculatorOpen(false);
    setActiveTab(tab);
  };

  const abrirFeedComunidade = () => {
    setFeedAba('comunidade');
    handleTabClick('destaques');
  };

  const isTabActive = (tab: ActiveTab) => activeTab === tab && !selectedSpot;

  // O menu flutuante é parte permanente da navegação. Ele só sai enquanto o
  // teclado virtual ocupa a tela; um downwind ativo não pode sequestrar nem
  // remover a navegação principal.
  if (isKeyboardOpen) return null;

  const itemClass = (ativo: boolean) =>
    `relative h-11 w-full rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-colors duration-200 active:scale-95 ${
      ativo
        ? 'bg-cyan-400/12 text-cyan-300'
        : 'text-slate-400 hover:text-slate-200'
    }`;

  return (
    <div className="fixed bottom-1.5 inset-x-0 z-chrome pointer-events-none flex justify-center px-2 safe-area-pb">
      <nav
        className={`relative pointer-events-auto w-full max-w-[410px] h-[58px] px-2 rounded-full grid grid-cols-[1fr_62px_1fr] items-center transition-all duration-300 shadow-2xl shadow-black/70 border backdrop-blur-2xl ${
          beachMode
            ? 'bg-[#020617]/92 border-slate-700/80 text-slate-300'
            : 'bg-[#0B1220]/92 border-white/15 text-slate-300'
        }`}
        role="navigation"
        aria-label="Navegação principal flutuante"
      >
        <div className="grid grid-cols-3 items-center">
          <button
            type="button"
            onClick={() => handleTabClick('favoritos')}
            className={itemClass(isTabActive('favoritos'))}
            aria-label="Spots e previsão"
            aria-current={isTabActive('favoritos') ? 'page' : undefined}
          >
            <Wind size={20} strokeWidth={isTabActive('favoritos') ? 2.4 : 1.9} />
            <span className="text-[8px] font-bold leading-none">Spots</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabClick('mapa')}
            className={itemClass(isTabActive('mapa'))}
            aria-label="Mapa"
            aria-current={isTabActive('mapa') ? 'page' : undefined}
          >
            <Compass size={20} strokeWidth={isTabActive('mapa') ? 2.4 : 1.9} />
            <span className="text-[8px] font-bold leading-none">Mapa</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabClick('sessoes')}
            className={itemClass(isTabActive('sessoes'))}
            aria-label="Diário de velejos"
            aria-current={isTabActive('sessoes') ? 'page' : undefined}
          >
            <BookOpen size={20} strokeWidth={isTabActive('sessoes') ? 2.4 : 1.9} />
            <span className="text-[8px] font-bold leading-none">Diário</span>
          </button>
        </div>

        {/* A coluna própria mantém o PLAY no centro geométrico da tela. O
            visual sólido, sem gradiente, diferencia ação de navegação. */}
        <button
          type="button"
          onClick={abrirIniciarAtividade}
          className="z-10 mx-auto -translate-y-1.5 w-[54px] h-[54px] rounded-full bg-cyan-400 text-[#07111f] border border-cyan-200 ring-4 ring-[#0B1220] shadow-[0_7px_20px_rgba(34,211,238,0.28)] flex items-center justify-center transition-[transform,background-color] duration-200 hover:bg-cyan-300 active:scale-95"
          aria-label="Iniciar velejo ou downwind"
          title="Iniciar atividade"
        >
          <Play size={22} className="translate-x-px fill-current" strokeWidth={2} />
        </button>

        <div className="grid grid-cols-3 items-center">
          <button
            type="button"
            onClick={abrirFeedComunidade}
            className={itemClass(isTabActive('destaques'))}
            aria-label="Feed da comunidade"
            aria-current={isTabActive('destaques') ? 'page' : undefined}
          >
            <Newspaper size={20} strokeWidth={isTabActive('destaques') ? 2.4 : 1.9} />
            <span className="text-[8px] font-bold leading-none">Feed</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabClick('chat')}
            className={itemClass(isTabActive('chat'))}
            aria-label="Chat"
            aria-current={isTabActive('chat') ? 'page' : undefined}
          >
            <MessageSquare size={20} strokeWidth={isTabActive('chat') ? 2.4 : 1.9} />
            <span className="text-[8px] font-bold leading-none">Chat</span>
            {totalChatUnread > 0 ? (
              <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-[9px] font-black leading-4 text-white ring-2 ring-[#0B1220]">
                {totalChatUnread > 9 ? '9+' : totalChatUnread}
              </span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="relative h-11 w-full rounded-2xl flex flex-col items-center justify-center gap-0.5 text-slate-400 transition-colors duration-200 hover:text-slate-200 active:scale-95"
            aria-label="Abrir meu perfil e menu"
            title={user?.name ?? 'Perfil e menu'}
          >
            <span className="w-6 h-6 rounded-full overflow-hidden ring-1 ring-white/35 bg-slate-800 flex items-center justify-center">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <UserIcon size={14} />
              )}
            </span>
            <span className="text-[8px] font-bold leading-none">Menu</span>
          </button>
        </div>
      </nav>
    </div>
  );
};
