'use client';

import React from 'react';
import { MessageSquare, Sparkles } from 'lucide-react';
import { useKiteData } from '../context/KiteDataContext';

export const FloatingChatButton: React.FC = () => {
  const { activeTab, setActiveTab, selectedSpot, setSelectedSpot, unreadChatCount } = useKiteData();

  // Não exibe o botão flutuante se já estivermos na tela de chat ou se a previsão de um spot estiver aberta
  if (activeTab === 'chat' || selectedSpot !== null) return null;

  const handleClick = () => {
    if (selectedSpot) {
      setSelectedSpot(null);
    }
    setActiveTab('chat');
  };

  return (
    <div className="fixed bottom-22 right-4 z-chrome pointer-events-auto flex items-center">
      <button
        type="button"
        onClick={handleClick}
        className="group relative flex items-center gap-2 pl-3.5 pr-4 py-3 rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 font-black text-xs shadow-xl shadow-cyan-500/30 hover:shadow-cyan-500/50 hover:scale-105 active:scale-95 transition-all duration-200"
        aria-label="Abrir Chat dos Velejadores"
      >
        {/* Glow de fundo */}
        <span className="absolute inset-0 rounded-full bg-cyan-400/40 blur-md group-hover:blur-lg transition-all" />

        <div className="relative flex items-center gap-1.5">
          <MessageSquare size={18} className="fill-current stroke-[2.5]" />
          <span className="tracking-wide uppercase font-black text-[11px] drop-shadow-xs hidden xs:inline">
            Chat
          </span>
        </div>

        {/* Badge indicador de novas mensagens */}
        {unreadChatCount > 0 && (
          <span className="relative ml-0.5 px-1.5 py-0.5 rounded-full bg-rose-500 text-white font-black text-[10px] ring-2 ring-[#0F172A] shadow-md animate-bounce">
            {unreadChatCount}
          </span>
        )}
      </button>
    </div>
  );
};
