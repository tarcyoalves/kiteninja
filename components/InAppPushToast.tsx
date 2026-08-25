'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, User, X } from 'lucide-react';
import { useKiteData } from '../context/KiteDataContext';
import { deveExibirToastMensagem } from '../lib/toastMensagem';

export const InAppPushToast: React.FC = () => {
  const {
    latestIncomingMessage,
    setLatestIncomingMessage,
    activeTab,
    setActiveTab,
    selectedSpot,
    setSelectedSpot,
  } = useKiteData();
  const [visible, setVisible] = useState(false);

  /*
   * Id da última mensagem que JÁ teve seu toast exibido. É o que garante
   * "cada mensagem aparece uma vez só".
   *
   * O bug que isto corrige (relatado pelo dono: "fica direto aparecendo o
   * popup, mesmo eu já tendo visto a msg") vinha de duas coisas somadas:
   *
   * 1. o auto-hide de 5,5s mexia só em `visible`, e deixava
   *    `latestIncomingMessage` preenchido no contexto; e
   * 2. este efeito tinha `activeTab` na lista de dependências, então TODA
   *    troca de aba o reexecutava — e, reexecutando com a mensagem ainda
   *    preenchida, ele chamava `setVisible(true)` de novo.
   *
   * Resultado: a mensagem já lida voltava a aparecer a cada navegação entre
   * abas, indefinidamente, até o usuário abrir o chat (que zera o contexto)
   * ou fechar no X. Quanto mais o usuário navegava, mais o popup aparecia.
   *
   * A correção tira `activeTab` das dependências (esconder o toast quando o
   * usuário está no chat é trabalho da guarda de render abaixo, não deste
   * efeito) e marca a mensagem como exibida por id. Efeito colateral bom:
   * o toast passa a durar os 5,5s inteiros mesmo se a pessoa trocar de aba
   * no meio, em vez de reiniciar a contagem a cada troca.
   */
  const jaExibidaRef = useRef<string | null>(null);

  useEffect(() => {
    if (!latestIncomingMessage) return;
    if (!deveExibirToastMensagem(latestIncomingMessage, jaExibidaRef.current)) return;

    jaExibidaRef.current = latestIncomingMessage.id;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 5500);
    return () => clearTimeout(timer);
  }, [latestIncomingMessage]);

  if (!visible || !latestIncomingMessage || activeTab === 'chat') return null;

  const handleOpen = () => {
    if (selectedSpot) {
      setSelectedSpot(null);
    }
    setVisible(false);
    setLatestIncomingMessage(null);
    setActiveTab('chat');
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVisible(false);
    setLatestIncomingMessage(null);
  };

  return (
    <div
      onClick={handleOpen}
      className="fixed top-4 inset-x-0 mx-auto max-w-sm w-[92%] z-modal cursor-pointer animate-in fade-in slide-in-from-top-6 duration-300 pointer-events-auto"
      role="alert"
      aria-label="Nova mensagem recebida"
    >
      <div className="p-3.5 rounded-2xl bg-[#0F172A]/95 border border-cyan-500/40 backdrop-blur-xl shadow-2xl shadow-cyan-500/20 flex items-center gap-3 text-left transition-all hover:scale-[1.02] active:scale-[0.98]">
        {/* Avatar */}
        <div className="relative shrink-0">
          <div className="w-10 h-10 rounded-full bg-slate-800 ring-2 ring-cyan-400 overflow-hidden flex items-center justify-center shadow-xs">
            {latestIncomingMessage.userAvatar ? (
              <img
                src={latestIncomingMessage.userAvatar}
                alt={latestIncomingMessage.userName}
                className="w-full h-full object-cover"
              />
            ) : (
              <User size={18} className="text-slate-300" />
            )}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-cyan-400 rounded-full flex items-center justify-center ring-2 ring-[#0F172A]">
            <MessageSquare size={8} className="text-slate-950 fill-current" />
          </span>
        </div>

        {/* Conteúdo da mensagem */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="font-black text-xs text-cyan-300 truncate">
              {latestIncomingMessage.userName}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">agora</span>
          </div>
          <p className="text-xs text-slate-200 truncate mt-0.5 font-medium">
            {latestIncomingMessage.text}
          </p>
        </div>

        {/* Botão de Fechar */}
        <button
          type="button"
          onClick={handleClose}
          className="p-1.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
          aria-label="Dispensar notificação"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
};
