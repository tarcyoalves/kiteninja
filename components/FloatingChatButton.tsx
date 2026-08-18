'use client';

import React from 'react';
import { MessageSquare } from 'lucide-react';
import { useKiteData } from '../context/KiteDataContext';

export const FloatingChatButton: React.FC = () => {
  const { activeTab, setActiveTab, selectedSpot, setSelectedSpot, unreadChatCount } = useKiteData();

  // Não exibe na tela de chat, na tela de anúncios ou com spot aberto
  if (activeTab === 'chat' || activeTab === 'anuncios' || selectedSpot !== null) return null;

  const handleClick = () => {
    if (selectedSpot) {
      setSelectedSpot(null);
    }
    setActiveTab('chat');
  };

  // Na tela de mapa, fica acima do card inferior do spot
  const bottomClass = activeTab === 'mapa' ? 'bottom-32' : 'bottom-20';

  return (
    <div className={`fixed ${bottomClass} right-4 z-chrome pointer-events-auto transition-all duration-300`}>
      <button
        type="button"
        onClick={handleClick}
        className="group relative w-13 h-13 rounded-full bg-gradient-to-tr from-cyan-500 via-cyan-400 to-emerald-400 text-slate-950 flex items-center justify-center shadow-2xl shadow-cyan-500/40 hover:shadow-cyan-400/60 hover:scale-108 active:scale-95 transition-all duration-200 border-2 border-white/25"
        aria-label="Abrir Chat dos Velejadores"
        title="Abrir Chat da Comunidade"
      >
        {/* Glow de fundo */}
        <span className="absolute inset-0 rounded-full bg-cyan-400/30 blur-md group-hover:blur-lg transition-all" />

        <div className="relative">
          <MessageSquare size={22} className="fill-slate-950 stroke-[2.2]" />
        </div>

        {/* Badge indicador de novas mensagens */}
        {unreadChatCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-rose-500 text-white font-black text-[10px] ring-2 ring-[#0B1220] flex items-center justify-center shadow-lg animate-bounce">
            {unreadChatCount}
          </span>
        )}
      </button>
    </div>
  );
};
