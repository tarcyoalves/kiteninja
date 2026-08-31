'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, User, X } from 'lucide-react';
import { useKiteData } from '../context/KiteDataContext';
import { deveExibirToastMensagem, escolherAvisoMaisRecente } from '../lib/toastMensagem';

/**
 * Aviso flutuante de mensagem nova — chat geral E conversa direta (DM).
 *
 * POR QUE OS DOIS NO MESMO COMPONENTE: mensagem no chat geral mostrava toast,
 * DM não — `latestIncomingDm` era preenchido pelo watcher e nenhum componente
 * lia (achado V-04 em docs/VARREDURA-2026-08-31.md). Criar um segundo toast
 * ao lado resolveria a falta, mas abriria outro problema: os dois podem
 * chegar juntos e se sobrepor na mesma posição da tela. Um componente só
 * escolhe o aviso mais recente e mostra UM.
 *
 * LIMITE CONHECIDO: tocar no aviso de DM leva à aba de chat, não à conversa
 * específica. Abrir uma DM direto exigiria expor esse controle no contexto
 * (hoje a sala só é montada dentro de views/ChatView.tsx), e isso é mudança
 * de outro tamanho. O destino atual é o mesmo que o sininho já usava.
 */
export const InAppPushToast: React.FC = () => {
  const {
    latestIncomingMessage,
    setLatestIncomingMessage,
    latestIncomingDm,
    clearDmUnread,
    activeTab,
    setActiveTab,
    selectedSpot,
    setSelectedSpot,
  } = useKiteData();
  const [visible, setVisible] = useState(false);

  /*
   * Qual dos dois avisos mostrar: o mais recente pelo horário da mensagem.
   * Comparar `createdAt` e não a ordem de chegada no cliente é o que dá o
   * resultado certo quando os dois watchers respondem fora de ordem — o poll
   * do chat geral e o de DM são independentes.
   *
   * O `id` unificado é o que alimenta a trava de "exibe uma vez só": para o
   * chat geral é o id da mensagem; para DM, remetente + horário, porque a
   * resposta de `/api/chat/dms` traz a última mensagem da conversa, não um id
   * próprio.
   */
  const aviso = (() => {
    const geral = latestIncomingMessage
      ? {
          id: latestIncomingMessage.id,
          nome: latestIncomingMessage.userName,
          texto: latestIncomingMessage.text,
          avatar: latestIncomingMessage.userAvatar,
          quando: latestIncomingMessage.createdAt,
          ehDm: false,
        }
      : null;
    const dm = latestIncomingDm
      ? {
          id: `dm:${latestIncomingDm.fromUserId}:${latestIncomingDm.createdAt}`,
          nome: latestIncomingDm.fromUserName,
          texto: latestIncomingDm.text,
          avatar: latestIncomingDm.avatarUrl,
          quando: latestIncomingDm.createdAt,
          ehDm: true,
        }
      : null;

    return escolherAvisoMaisRecente(geral, dm);
  })();

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

  const avisoId = aviso?.id ?? null;

  useEffect(() => {
    if (!avisoId) return;
    if (!deveExibirToastMensagem({ id: avisoId }, jaExibidaRef.current)) return;

    jaExibidaRef.current = avisoId;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 5500);
    return () => clearTimeout(timer);
  }, [avisoId]);

  if (!visible || !aviso || activeTab === 'chat') return null;

  /** Consome o evento nos dois canais — ver docs/BUG-TOAST-MENSAGEM-REPETIDO.md. */
  const consumir = () => {
    setVisible(false);
    setLatestIncomingMessage(null);
    if (aviso.ehDm) clearDmUnread();
  };

  const handleOpen = () => {
    if (selectedSpot) {
      setSelectedSpot(null);
    }
    consumir();
    setActiveTab('chat');
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    consumir();
  };

  return (
    <div
      onClick={handleOpen}
      className="fixed top-4 inset-x-0 mx-auto max-w-sm w-[92%] z-modal cursor-pointer animate-in fade-in slide-in-from-top-6 duration-300 pointer-events-auto"
      role="alert"
      aria-label={aviso.ehDm ? 'Nova mensagem direta recebida' : 'Nova mensagem no chat recebida'}
    >
      <div className="p-3.5 rounded-2xl bg-[#0F172A]/95 border border-cyan-500/40 backdrop-blur-xl shadow-2xl shadow-cyan-500/20 flex items-center gap-3 text-left transition-all hover:scale-[1.02] active:scale-[0.98]">
        {/* Avatar */}
        <div className="relative shrink-0">
          <div className="w-10 h-10 rounded-full bg-slate-800 ring-2 ring-cyan-400 overflow-hidden flex items-center justify-center shadow-xs">
            {aviso.avatar ? (
              <img
                src={aviso.avatar}
                alt={aviso.nome}
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
              {aviso.nome}
              {/* Marca a DM: sem isto o aviso é idêntico ao do chat geral, e a
                  pessoa toca esperando cair na conversa privada. */}
              {aviso.ehDm && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-cyan-500/20 text-cyan-200 text-[9px] font-black align-middle">
                  DIRETA
                </span>
              )}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">agora</span>
          </div>
          <p className="text-xs text-slate-200 truncate mt-0.5 font-medium">
            {aviso.texto}
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
