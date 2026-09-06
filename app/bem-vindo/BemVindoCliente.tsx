'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Compass, LifeBuoy, Route, Users, Wind } from 'lucide-react';

interface Props {
  nome: string;
}

/**
 * A recepção propriamente dita.
 *
 * O QUE ELA MOSTRA, E POR QUÊ ESSA ORDEM
 *
 * Quatro coisas, na ordem em que um velejador se importa com elas — não na
 * ordem das abas do app:
 *
 *  1. VENTO, porque é o que faz alguém abrir um app de kite antes de sair de
 *     casa. É a razão de voltar todo dia.
 *  2. VELEJO, porque é o que o app guarda para você e mais ninguém tem.
 *  3. DOWNWIND, porque é o que só funciona com o grupo junto.
 *  4. SOS, por último e destacado: não é atrativo, é a coisa que a pessoa
 *     precisa SABER QUE EXISTE antes de precisar. Ninguém procura o botão de
 *     socorro pela primeira vez dentro d'água.
 *
 * Um cartão por assunto, sem tour interativo e sem obrigar a clicar em nada:
 * quem chegou por convite quer entrar, não fazer um tutorial. O botão de
 * começar fica sempre visível.
 */
export const BemVindoCliente: React.FC<Props> = ({ nome }) => {
  const router = useRouter();

  /** Só o primeiro nome: "Bem-vindo, Tarcyo Alves da Silva" não é acolhedor. */
  const primeiroNome = nome.trim().split(/\s+/)[0] || 'velejador';

  const cartoes = [
    {
      icone: <Wind size={18} className="text-cyan-300" />,
      cor: 'from-cyan-500/15 to-cyan-500/5 border-cyan-500/30',
      titulo: 'Vento de verdade, spot por spot',
      texto:
        'Previsão hora a hora, maré e a nota da condição — para saber se vale a pena ir antes de pegar a estrada.',
    },
    {
      icone: <Route size={18} className="text-emerald-300" />,
      cor: 'from-emerald-500/15 to-emerald-500/5 border-emerald-500/30',
      titulo: 'Seu velejo, gravado pelo GPS',
      texto:
        'Distância, velocidade máxima e o mapa do seu trajeto. Fica no seu diário e, se você quiser, aparece para a comunidade.',
    },
    {
      icone: <Users size={18} className="text-violet-300" />,
      cor: 'from-violet-500/15 to-violet-500/5 border-violet-500/30',
      titulo: 'Downwind com o grupo no mapa',
      texto:
        'Todo mundo se vê ao vivo durante a travessia, com chat e link para o apoio em terra acompanhar de carro.',
    },
    {
      icone: <LifeBuoy size={18} className="text-rose-300" />,
      cor: 'from-rose-500/15 to-rose-500/5 border-rose-500/30',
      titulo: 'SOS — antes de precisar',
      texto:
        'Segurando o botão de SOS, quem está por perto e o seu grupo recebem sua posição na hora. Funciona até sem GPS.',
      destaque: true,
    },
  ];

  return (
    <main className="flex-1 min-h-0 overflow-y-auto bg-[var(--app-bg)] text-slate-100">
      {/* Brilho no topo: dá o "chegou em algum lugar" sem custar imagem. */}
      <div className="relative overflow-hidden">
        <div
          className="absolute inset-x-0 -top-24 h-56 bg-[radial-gradient(60%_60%_at_50%_50%,rgba(34,211,238,.28),transparent_70%)]"
          aria-hidden="true"
        />
        <div className="relative w-full max-w-md mx-auto px-5 pt-10 pb-6 text-center space-y-3">
          <div className="text-5xl animate-[flutuar_3s_ease-in-out_infinite]" aria-hidden="true">
            🪁
          </div>
          <p className="text-[11px] font-black tracking-[0.2em] text-cyan-400 uppercase">
            Você está dentro
          </p>
          <h1 className="text-3xl font-black tracking-tight leading-tight">
            Bem-vindo, {primeiroNome}!
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            O KiteNinja é por convite. Alguém que vela com você achou que este lugar é
            seu também.
          </p>
        </div>
      </div>

      <div className="w-full max-w-md mx-auto px-5 pb-10 space-y-3">
        {cartoes.map((c) => (
          <div
            key={c.titulo}
            className={`p-4 rounded-2xl bg-gradient-to-br border ${c.cor} ${
              c.destaque ? 'ring-1 ring-rose-500/25' : ''
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-9 h-9 rounded-xl bg-slate-950/60 border border-white/10 flex items-center justify-center">
                {c.icone}
              </div>
              <div className="min-w-0">
                <p className="font-black text-sm text-white">{c.titulo}</p>
                <p className="text-xs text-slate-300/80 leading-relaxed mt-1">{c.texto}</p>
              </div>
            </div>
          </div>
        ))}

        <div className="pt-2 space-y-2">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 text-slate-950 font-black text-sm shadow-xl shadow-cyan-500/25 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
          >
            <Compass size={18} className="stroke-[2.5]" />
            <span>Começar a velejar</span>
          </button>
          {/*
            * O convite para instalar vem DEPOIS de entrar, não antes: pedir
            * para instalar alguém que ainda não viu o app é pedir cedo demais.
            */}
          <a
            href="/instalar-android"
            className="block w-full py-2.5 text-center rounded-2xl bg-slate-800/70 border border-slate-700 text-slate-300 font-bold text-xs active:scale-[0.98] transition-transform"
          >
            Instalar o app no celular
          </a>
        </div>
      </div>
    </main>
  );
};
