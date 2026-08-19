'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, KeyRound, Users, Shield, Sparkles, Film } from 'lucide-react';
import { InviteManager } from './InviteManager';
import { UserManager } from './UserManager';
import { IntroVideoManager } from './IntroVideoManager';

export function AdminDashboard({ adminName }: { adminName: string }) {
  const [tab, setTab] = useState<'convites' | 'usuarios' | 'abertura'>('convites');

  return (
    // O app inteiro herda `body { overflow: hidden }` (globals.css) pensado para o
    // shell do app principal, que só deixa o miolo `.app-scroll` rolar. Esta página
    // usava `min-h-screen` direto no <main>, sem nenhum contêiner rolável por baixo
    // do overflow:hidden do body — resultado: conteúdo mais alto que a tela ficava
    // preso, sem scroll nenhum. Reaproveitamos o mesmo par `.app-shell` + `.app-scroll`
    // já usado em app/page.tsx em vez de inventar CSS novo.
    <div className="app-shell flex flex-col">
      <main
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.25rem)',
        }}
        className="app-scroll bg-[#0F172A] text-slate-100 px-4 sm:px-6 flex flex-col items-center"
      >
      <div className="w-full max-w-4xl space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between pb-2 border-b border-slate-800/80">
          <Link
            href="/"
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-xs font-bold text-slate-300 hover:text-white border border-slate-700/60 transition-colors"
          >
            <ArrowLeft size={16} className="text-cyan-400" />
            <span>Voltar ao app</span>
          </Link>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1E293B]/80 border border-slate-800">
            <span className="text-[11px] font-bold text-slate-400">Admin:</span>
            <strong className="text-xs font-black text-cyan-400">{adminName}</strong>
          </div>
        </header>

        {/* Dashboard Title + Tabs */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
                <Shield className="text-cyan-400" size={24} />
                <span>Painel de Controle</span>
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                Monitoramento de acessos em tempo real, convites exclusivos e gestão de velejadores.
              </p>
            </div>

            {/* Tab Switcher */}
            <div className="flex items-center bg-[#1E293B] p-1 rounded-2xl border border-slate-700/80 shadow-md">
              <button
                onClick={() => setTab('convites')}
                className={`px-3.5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                  tab === 'convites'
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <KeyRound size={14} />
                <span>Convites</span>
              </button>

              <button
                onClick={() => setTab('usuarios')}
                className={`px-3.5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                  tab === 'usuarios'
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Users size={14} />
                <span>Monitoramento</span>
              </button>

              <button
                onClick={() => setTab('abertura')}
                className={`px-3.5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                  tab === 'abertura'
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Film size={14} />
                <span>Abertura</span>
              </button>
            </div>
          </div>
        </div>

        {/* Content Body */}
        {tab === 'convites' && <InviteManager />}
        {tab === 'usuarios' && <UserManager />}
        {tab === 'abertura' && <IntroVideoManager />}
      </div>
      </main>
    </div>
  );
}
