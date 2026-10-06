'use client';

import Image from 'next/image';
import React from 'react';
import { Menu, Sun, RefreshCw, Plus, Shield, Bell } from 'lucide-react';
import { useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';
import { useAppUpdateAvailable } from '../lib/appUpdate';

interface HeaderProps {
  title?: string;
  onEditFavorites?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ title, onEditFavorites }) => {
  const temAtualizacao = useAppUpdateAvailable();
  const {
    setIsSidebarOpen,
    beachMode,
    setBeachMode,
    windUnit,
    setWindUnit,
    refreshWindData,
    isRefreshing,
    activeTab,
    selectedSpot,
    setSelectedSpot,
    setIsLoggerOpen,
    unreadChatCount,
    dmUnreadCount,
    setIsNotificacoesAbertas,
    zerarNotificacoesNaoLidas,
    notificacoesNaoLidas,
  } = useKiteData();

  // Total do sino: geral + DM juntos. A aba chat, ao abrir, zera os dois
  // contadores separadamente (KiteDataContext) — aqui só soma para o badge.
  const totalChatUnread = unreadChatCount + dmUnreadCount;
  // Badge do sino (Fase 6): chat/DM + notificações da central, num número só.
  const totalSino = totalChatUnread + notificacoesNaoLidas;
  const temAlertaNoSino = totalSino > 0 || temAtualizacao;

  const { user, isAdmin, openAuthModal } = useAuth();

  const getHeaderTitle = () => {
    if (title) return title;
    switch (activeTab) {
      // A Home lista Favoritos OU Todos (ver SpotsView): "Favoritos" no topo
      // contradizia a aba "Todos" aberta logo abaixo.
      case 'favoritos':
        return 'Spots';
      case 'mapa':
        return 'Mapa';
      case 'destaques':
        return 'Destaques';
      // Mesmo nome da barra inferior; "Meu Logbook" também não cabia no
      // celular ao lado dos botões.
      case 'sessoes':
        return 'Diário';
      // Cabe no celular (~10 letras); as duas subabas logo abaixo dizem o resto.
      case 'alertas':
        return 'Eventos';
      case 'chat':
        return 'Chat';
      case 'anuncios':
        return 'Anúncios';
      case 'perfil':
        return 'Perfil';
      default:
        return 'KiteNinja';
    }
  };

  return (
    /* `shrink-0` em vez de `sticky`: como irmão flex do miolo rolável, o header
       fica fixo no topo sem sair do fluxo nem depender de altura calculada. */
    <header
      className={`shrink-0 z-chrome transition-colors shadow-lg ${
        beachMode
          ? 'bg-[#020617] text-white border-b-2 border-emerald-500'
          : 'bg-gradient-to-r from-[#0B1220] to-[#12243B] text-white border-b border-cyan-500/25'
      }`}
    >
      {/* Top micro bar with system status.
          O padding-top soma a safe-area do iOS: sem isso a faixa sobe por
          baixo do relógio/notch no iPhone em modo standalone (PWA). O
          fallback 0px mantém o espaçamento no Android e no desktop. */}
      <div
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.375rem)' }}
        className="px-4 pb-1.5 flex items-center justify-between text-[11px] font-medium border-b border-white/15 tracking-tight backdrop-blur-xs"
      >
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400" />
          <span className="text-white/95 font-bold tracking-wider text-[10px]">PREVISÃO OPEN-METEO</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Unit Toggle */}
          <button
            onClick={() => setWindUnit(windUnit === 'nós' ? 'km/h' : windUnit === 'km/h' ? 'mph' : 'nós')}
            className="px-2 py-0.5 rounded-full bg-black/25 hover:bg-black/40 text-white font-mono text-[10px] uppercase font-extrabold transition-all border border-white/10"
            title="Mudar unidade de vento"
          >
            {windUnit}
          </button>

          {/* Beach High Contrast Mode Toggle */}
          <button
            onClick={() => setBeachMode(prev => !prev)}
            className={`p-1.5 rounded-full transition-all border border-white/10 ${
              beachMode ? 'bg-amber-400 text-slate-950 font-bold shadow-md shadow-amber-400/30' : 'bg-black/25 hover:bg-black/40 text-white'
            }`}
            title="Modo Sol Forte: Alto contraste"
          >
            {beachMode ? <Sun size={13} className="animate-spin" /> : <Sun size={13} />}
          </button>

          {/* Refresh live wind */}
          <button
            onClick={refreshWindData}
            disabled={isRefreshing}
            className="p-1.5 rounded-full bg-black/25 hover:bg-black/40 text-white transition-all disabled:opacity-50 border border-white/10"
            title="Atualizar dados de vento agora"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Main App Bar */}
      <div className="px-4 py-2.5 flex items-center justify-between gap-2">
        {/* Left: Menu Hamburger */}
        {/* min-w-0 em cada nível: sem isso o `truncate` do título não age e um
            título longo (ex.: um `title` vindo de fora) empurra o avatar para fora da tela. */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 -ml-1.5 rounded-xl hover:bg-white/20 active:scale-95 transition-all"
            aria-label="Abrir menu"
          >
            <Menu size={22} className="text-white" />
          </button>

          <div className="flex items-center gap-2 min-w-0">
            {/* Placa branca: a logo é preta e o header é escuro. */}
            <span className="w-[2.4rem] h-[2.4rem] rounded-full bg-white p-0.5 shrink-0 shadow-sm">
              <Image
                src="/brand/logo.png"
                alt="KiteNinja"
                width={64}
                height={64}
                priority
                className="w-full h-full object-contain"
              />
            </span>
            <span className="font-black text-lg sm:text-xl tracking-wide sm:tracking-wider uppercase drop-shadow-md text-white truncate">
              {getHeaderTitle()}
            </span>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {activeTab === 'favoritos' && onEditFavorites && (
            <button
              onClick={onEditFavorites}
              className="text-xs font-bold px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 active:scale-95 transition-all text-white border border-white/20"
            >
              Editar
            </button>
          )}

          {/* Atalho para o painel, à vista sem abrir a gaveta. Só para admin:
              para os outros levaria a um redirect. */}
          {isAdmin && (
            <a
              href="/admin"
              title="Painel do Admin"
              aria-label="Abrir painel do admin"
              className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 border border-white/20 flex items-center justify-center text-white active:scale-95 transition-all"
            >
              <Shield size={15} className="stroke-[2.5]" />
            </a>
          )}

          {/* Fast Quick Action: Log Session button */}
          <button
            onClick={() => setIsLoggerOpen(true)}
            className="flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-full bg-white text-[#0B1220] hover:bg-white/95 active:scale-95 shadow-md transition-all hover:shadow-lg"
          >
            <Plus size={14} className="stroke-[3]" />
            <span className="hidden sm:inline">Velejo</span>
          </button>

          {/* Sininho de Notificações com badge — abre a central de
              notificações (Fase 6), que já oferece o atalho pro chat quando
              faz sentido (ver NotificationCenterModal), preservando o que o
              sininho já fazia antes desta fase. */}
          <button
            onClick={() => {
              if (selectedSpot) setSelectedSpot(null);
              // O modal marca tudo como lido ao abrir; zerar aqui evita o badge
              // ficar aceso esperando o próximo poll (até 20s).
              zerarNotificacoesNaoLidas();
              setIsNotificacoesAbertas(true);
            }}
            className="relative w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 border border-white/20 flex items-center justify-center text-white active:scale-95 transition-all"
            title={temAtualizacao ? 'Nova versão disponível' : totalSino > 0 ? `${totalSino} notificação(ões) nova(s)` : 'Notificações'}
            aria-label="Notificações"
          >
            <Bell size={16} className={temAlertaNoSino ? 'text-cyan-300' : 'text-white'} />
            {temAlertaNoSino && (
              <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center ring-2 ring-[#0B1220] animate-bounce">
                {totalSino > 0 ? totalSino : '↑'}
              </span>
            )}
          </button>

          {/* Logado, o avatar daqui abria o mesmo menu lateral que o ☰ à
              esquerda e o "Menu" da barra inferior — três portas para o mesmo
              lugar, roubando do título o espaço que faltava no celular.
              Ficou só para quem NÃO está logado, como porta de entrada. */}
          {!user && (
            <button
              onClick={openAuthModal}
              className="ml-1 px-3 py-1.5 rounded-full bg-white/20 hover:bg-white/30 border border-white/20 text-white text-xs font-black active:scale-95 transition-all"
              title="Entrar na conta"
            >
              Entrar
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
