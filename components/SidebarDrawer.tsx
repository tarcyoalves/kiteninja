'use client';

import React, { useState } from 'react';
import {
  X,
  Pin,
  MapPin,
  Radar,
  Calendar,
  ShoppingBag,
  Megaphone,
  Star,
  Users,
  AlertTriangle,
  Radio,
  MessageSquare,
  Bell,
  Calculator,
  PlusCircle,
  LogOut,
  LogIn,
  Sun,
  Shield,
  Camera,
  ChevronRight,
} from 'lucide-react';
import { useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';

export const SidebarDrawer: React.FC = () => {
  const {
    isSidebarOpen,
    setIsSidebarOpen,
    setActiveTab,
    setIsLoggerOpen,
    setIsCalculatorOpen,
    setIsNewAlertOpen,
    beachMode,
    setBeachMode,
    windUnit,
    setWindUnit,
  } = useKiteData();

  const { user, logout, openAuthModal, updateProfile } = useAuth();
  const [radioActive, setRadioActive] = useState(false);
  const [isEditingPhoto, setIsEditingPhoto] = useState(false);

  if (!isSidebarOpen) return null;

  const navigateTo = (tabName: 'favoritos' | 'mapa' | 'destaques' | 'sessoes' | 'alertas' | 'perfil') => {
    setActiveTab(tabName);
    setIsSidebarOpen(false);
  };

  const handleAvatarChange = () => {
    const avatars = [
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop',
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop',
      'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=200&h=200&fit=crop',
    ];
    const nextIdx = Math.floor(Math.random() * avatars.length);
    updateProfile({ avatarUrl: avatars[nextIdx] });
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Dark Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
        onClick={() => setIsSidebarOpen(false)}
      />

      {/* Drawer Body (Left aligned matching screenshot 4) */}
      <div
        className={`relative z-10 w-[85%] max-w-[320px] h-full flex flex-col overflow-y-auto transition-transform shadow-2xl ${
          beachMode ? 'bg-[#020617] text-white' : 'bg-[#0F172A] text-slate-100 border-r border-slate-800'
        }`}
      >
        {/* Profile Card Header matching Screenshot 4 */}
        <div className="p-4 bg-[#1E293B] border-b border-slate-800 relative">
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="absolute top-3 right-3 p-1.5 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white"
          >
            <X size={18} />
          </button>

          {user ? (
            <div className="flex flex-col gap-3">
              {/* Alterar Foto Top Button + Flag */}
              <div className="flex items-center justify-between">
                <button
                  onClick={handleAvatarChange}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#0F172A] hover:bg-slate-900 border border-slate-700 text-xs font-bold text-slate-200 transition-colors shadow-xs"
                >
                  <Camera size={13} className="text-cyan-400" />
                  <span>Alterar Foto</span>
                </button>
                <span className="text-2xl" title={user.nationality || 'Brasil'}>
                  {user.countryFlag || '🇧🇷'}
                </span>
              </div>

              {/* Avatar + Info */}
              <div className="flex items-center gap-3 mt-1">
                <div className="relative">
                  <div className="w-14 h-14 rounded-full bg-slate-800 ring-2 ring-cyan-400 overflow-hidden flex items-center justify-center shadow-lg">
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
                    ) : (
                      <Users size={28} className="text-slate-400" />
                    )}
                  </div>
                  <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-400 rounded-full ring-2 ring-[#1E293B]" />
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="font-black text-base text-white truncate">{user.name}</h3>
                  <p className="text-xs text-slate-400 truncate">{user.email}</p>
                  <p className="text-[11px] font-mono text-cyan-400 tracking-tight mt-0.5 font-bold">
                    ID: {user.riderId}
                  </p>
                </div>
              </div>

              {/* Quick stats badge */}
              <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-700/80 text-center">
                <div className="bg-[#0F172A] p-2 rounded-xl border border-slate-700/60">
                  <span className="block text-[10px] text-slate-400 font-bold uppercase">Velejos</span>
                  <span className="font-black text-xs text-emerald-400 font-sans">{user.totalSessions}</span>
                </div>
                <div className="bg-[#0F172A] p-2 rounded-xl border border-slate-700/60">
                  <span className="block text-[10px] text-slate-400 font-bold uppercase">Horas</span>
                  <span className="font-black text-xs text-cyan-400 font-sans">{user.totalHours}h</span>
                </div>
                <div className="bg-[#0F172A] p-2 rounded-xl border border-slate-700/60">
                  <span className="block text-[10px] text-slate-400 font-bold uppercase">Peso</span>
                  <span className="font-black text-xs text-amber-400 font-sans">{user.weightKg}kg</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-2 text-center">
              <h3 className="font-black text-white text-base">Olá, Velejador!</h3>
              <p className="text-xs text-slate-400 mb-3">Conecte sua conta para salvar velejos e favoritos.</p>
              <button
                onClick={() => {
                  setIsSidebarOpen(false);
                  openAuthModal();
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20"
              >
                <LogIn size={15} />
                <span>Entrar / Cadastrar Rider</span>
              </button>
            </div>
          )}
        </div>

        {/* Menu Navigation List matching Screenshot 4 */}
        <div className="flex-1 py-2 px-2 space-y-0.5 text-sm font-semibold">
          {/* Destaques */}
          <button
            onClick={() => navigateTo('destaques')}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <Pin size={18} className="text-cyan-400" />
            <span className="flex-1">Destaques</span>
          </button>

          {/* Mapa (Novo) */}
          <button
            onClick={() => navigateTo('mapa')}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <MapPin size={18} className="text-rose-400" />
              <span>Mapa</span>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-cyan-500 text-slate-950 text-[10px] font-black uppercase tracking-wider shadow-xs">
              Novo
            </span>
          </button>

          {/* Radares */}
          <button
            onClick={() => navigateTo('mapa')}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <Radar size={18} className="text-cyan-400" />
            <span className="flex-1">Radares</span>
          </button>

          {/* Eventos (Novo) */}
          <button
            onClick={() => navigateTo('alertas')}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <Calendar size={18} className="text-rose-400" />
              <span>Eventos</span>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-cyan-500 text-slate-950 text-[10px] font-black uppercase tracking-wider shadow-xs">
              Novo
            </span>
          </button>

          {/* Lojas e Serviços */}
          <button
            onClick={() => {
              alert('Diretório de Guarderias, Escolas IKO e Lojas de Kite ativas no Nordeste e Brasil.');
            }}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <ShoppingBag size={18} className="text-slate-400" />
            <span className="flex-1">Lojas e Serviços</span>
          </button>

          {/* Anúncios */}
          <button
            onClick={() => {
              alert('Classificados de pipas usadas, pranchas e foils da comunidade.');
            }}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <Megaphone size={18} className="text-slate-400" />
            <span className="flex-1">Anúncios</span>
          </button>

          {/* Favoritos */}
          <button
            onClick={() => navigateTo('favoritos')}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <Star size={18} className="text-amber-400 fill-amber-400/30" />
            <span className="flex-1">Favoritos</span>
          </button>

          {/* Riders */}
          <button
            onClick={() => navigateTo('destaques')}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <Users size={18} className="text-slate-400" />
            <span className="flex-1">Riders</span>
          </button>

          {/* Ocorrências */}
          <button
            onClick={() => navigateTo('alertas')}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <AlertTriangle size={18} className="text-amber-400" />
            <span className="flex-1">Ocorrências</span>
          </button>

          {/* Radio Off / On */}
          <button
            onClick={() => setRadioActive(prev => !prev)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <Radio size={18} className={radioActive ? 'text-emerald-400 animate-pulse' : 'text-slate-400'} />
              <span>{radioActive ? 'Radio VHF (Canal 16 ON)' : 'Radio Off'}</span>
            </div>
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                radioActive ? 'bg-emerald-400 shadow-lg shadow-emerald-400/50' : 'bg-slate-600'
              }`}
            />
          </button>

          {/* Chat (badge 6) */}
          <button
            onClick={() => {
              alert('Chat ao vivo com velejadores na água nos spots favoritos.');
            }}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <MessageSquare size={18} className="text-slate-400" />
              <span>Chat</span>
            </div>
            <span className="w-5 h-5 rounded-full bg-amber-400 text-slate-950 text-xs font-black flex items-center justify-center shadow-xs">
              6
            </span>
          </button>

          {/* Notificações */}
          <button
            onClick={() => navigateTo('alertas')}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <Bell size={18} className="text-slate-400" />
            <span className="flex-1">Notificações</span>
          </button>

          <div className="my-2 border-t border-slate-800 pt-2" />

          {/* Action: Calculadora de Pipa */}
          <button
            onClick={() => {
              setIsSidebarOpen(false);
              setIsCalculatorOpen(true);
            }}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors text-left font-black border border-emerald-500/30"
          >
            <Calculator size={18} />
            <span className="flex-1">Calculadora de Pipa</span>
          </button>

          {/* Action: Registrar Velejo */}
          <button
            onClick={() => {
              setIsSidebarOpen(false);
              setIsLoggerOpen(true);
            }}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 transition-colors text-left font-black border border-cyan-500/30"
          >
            <PlusCircle size={18} />
            <span className="flex-1">Registrar Velejo</span>
          </button>
        </div>

        {/* Footer Settings & Auth */}
        <div className="p-3 bg-[#1E293B]/90 border-t border-slate-800 text-xs space-y-2">
          <div className="flex items-center justify-between text-slate-400 px-1 font-medium">
            <span>Unidade de Vento:</span>
            <button
              onClick={() => setWindUnit(windUnit === 'nós' ? 'km/h' : windUnit === 'km/h' ? 'mph' : 'nós')}
              className="px-2 py-0.5 rounded-lg bg-[#0F172A] border border-slate-700 text-white font-mono font-bold uppercase"
            >
              {windUnit}
            </button>
          </div>

          <div className="flex items-center justify-between text-slate-400 px-1 font-medium">
            <span>Modo Sol Forte (Praia):</span>
            <button
              onClick={() => setBeachMode(prev => !prev)}
              className={`px-2.5 py-0.5 rounded-lg font-bold transition-all ${
                beachMode ? 'bg-amber-400 text-black' : 'bg-[#0F172A] border border-slate-700 text-slate-300'
              }`}
            >
              {beachMode ? 'Ativo' : 'Desativado'}
            </button>
          </div>

          {user && (
            <button
              onClick={async () => {
                await logout();
                setIsSidebarOpen(false);
              }}
              className="w-full mt-2 py-2.5 px-3 rounded-xl bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 text-rose-400 font-bold flex items-center justify-center gap-2 transition-colors"
            >
              <LogOut size={14} />
              <span>Sair da Conta</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
