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
    <main className="min-h-screen bg-[#0F172A] text-slate-100 p-4 sm:p-6 flex flex-col items-center">
      <div className="w-full max-w-3xl space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            <span>Voltar ao app</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Admin:</span>
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
                Gestão de acesso exclusivo por convites e controle de velejadores da comunidade.
              </p>
            </div>

            {/* Tab Switcher */}
            <div className="flex items-center bg-[#1E293B] p-1 rounded-2xl border border-slate-700/80 shadow-md">
              <button
                onClick={() => setTab('convites')}
                className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all ${
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
                className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all ${
                  tab === 'usuarios'
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Users size={14} />
                <span>Velejadores</span>
              </button>

              <button
                onClick={() => setTab('abertura')}
                className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all ${
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
        {tab === 'convites' && <InviteManager adminName={adminName} />}
        {tab === 'usuarios' && <UserManager />}
        {tab === 'abertura' && <IntroVideoManager />}
      </div>
    </main>
  );
}
