'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, KeyRound, Users, Shield, Sparkles, Film, MessageSquareWarning, AlertOctagon } from 'lucide-react';
import { InviteManager } from './InviteManager';
import { UserManager } from './UserManager';
import { IntroVideoManager } from './IntroVideoManager';
import { ChamadosManager } from './ChamadosManager';
import { ErrosManager } from './ErrosManager';

export function AdminDashboard({ adminName }: { adminName: string }) {
  const [tab, setTab] = useState<'convites' | 'usuarios' | 'abertura' | 'chamados' | 'erros'>('convites');

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
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-xs font-bold text-slate-300 hover:text-white border border-slate-700/60 transition-colors shrink-0"
          >
            <ArrowLeft size={16} className="text-cyan-400 shrink-0" />
            {/* `whitespace-nowrap`: sem isto o botão quebrava em "Voltar ao /
                app" em duas linhas no celular, porque o vizinho (nome do
                admin) disputa a mesma linha. Quem cede espaço é o nome, que
                trunca; o botão de voltar tem tamanho fixo. */}
            <span className="whitespace-nowrap">Voltar ao app</span>
          </Link>
          {/* min-w-0 + truncate: sem os dois, um nome de admin comprido empurra
              a linha inteira para fora da tela — flex item não encolhe abaixo do
              conteúdo por padrão, e o painel inteiro passa a deslizar de lado. */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1E293B]/80 border border-slate-800 min-w-0">
            <span className="text-[11px] font-bold text-slate-400 shrink-0">Admin:</span>
            <strong className="text-xs font-black text-cyan-400 truncate">{adminName}</strong>
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

            {/*
              * BARRA DE ABAS — era a origem principal do scroll lateral.
              *
              * Quatro botões com rótulo e ícone num `flex` sem quebra somam bem
              * mais que a largura de um celular ("Monitoramento" sozinho passa de
              * 110px). Item de flex não encolhe abaixo do próprio conteúdo, então
              * a barra empurrava a página inteira e o painel deslizava de lado.
              *
              * No celular vira grade 2x2 (largura cheia, nenhuma aba escondida);
              * a partir de `sm` volta a ser a fileira única de antes. Grade em vez
              * de rolagem horizontal de propósito: com quatro abas, uma tira
              * rolável esconderia metade delas atrás de um gesto que ninguém
              * adivinha.
              */}
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-1 bg-[#1E293B] p-1 rounded-2xl border border-slate-700/80 shadow-md">
              <button
                onClick={() => setTab('convites')}
                className={`px-3 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all min-w-0 ${
                  tab === 'convites'
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <KeyRound size={14} className="shrink-0" />
                <span className="truncate">Convites</span>
              </button>

              <button
                onClick={() => setTab('usuarios')}
                className={`px-3 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all min-w-0 ${
                  tab === 'usuarios'
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Users size={14} className="shrink-0" />
                <span className="truncate">Monitoramento</span>
              </button>

              <button
                onClick={() => setTab('erros')}
                className={`px-3 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all min-w-0 ${
                  tab === 'erros'
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <AlertOctagon size={14} className="shrink-0" />
                <span className="truncate">Erros</span>
              </button>

              <button
                onClick={() => setTab('abertura')}
                className={`px-3 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all min-w-0 ${
                  tab === 'abertura'
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Film size={14} className="shrink-0" />
                <span className="truncate">Abertura</span>
              </button>

              <button
                onClick={() => setTab('chamados')}
                className={`px-3 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all min-w-0 ${
                  tab === 'chamados'
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <MessageSquareWarning size={14} className="shrink-0" />
                <span className="truncate">Chamados</span>
              </button>
            </div>
          </div>
        </div>

        {/* Content Body */}
        {tab === 'convites' && <InviteManager />}
        {tab === 'usuarios' && <UserManager />}
        {tab === 'abertura' && <IntroVideoManager />}
        {tab === 'chamados' && <ChamadosManager />}
        {tab === 'erros' && <ErrosManager />}
      </div>
      </main>
    </div>
  );
}
