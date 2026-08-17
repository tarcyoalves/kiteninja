'use client';

import Image from 'next/image';
import React, { useState } from 'react';
import { Lock, LogIn, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/**
 * Tela de entrada para quem chega sem sessão. Substitui o app inteiro — não é
 * um modal sobre o conteúdo, porque conteúdo atrás de modal continua no DOM e
 * bastaria fechar o modal (ou ler o HTML) para ver tudo.
 *
 * O acesso ao KiteNinja é por convite do admin, então não há cadastro aberto
 * aqui: sem link de convite, não há como criar conta.
 */
export const LoginGate: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setErro(null);
    try {
      const r = await login(email, password);
      // Sucesso não precisa de ação: o provider troca o estado e o app monta.
      if (!r.ok) setErro(r.error ?? 'Não foi possível entrar.');
    } catch {
      setErro('Sem conexão. Confira a internet e tente de novo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0B1220] text-slate-100 flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          {/* A arte da logo é preta e vive sobre fundo claro; aqui o fundo é
              escuro, então a placa branca é o que mantém o ninja visível. */}
          <div className="w-[8.4rem] h-[8.4rem] rounded-full bg-white p-1.5 shadow-xl shadow-cyan-500/20 ring-1 ring-cyan-400/30">
            <Image
              src="/brand/logo.png"
              alt="KiteNinja"
              width={224}
              height={224}
              priority
              className="w-full h-full object-contain"
            />
          </div>
          <p className="mt-4 text-sm text-slate-400 font-medium">
            Vento, maré e onda antes de montar o kite
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label htmlFor="gate-email" className="block text-xs font-bold text-slate-300 mb-1.5">
              E-mail
            </label>
            <div className="relative">
              <Mail
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
              />
              <input
                id="gate-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@email.com"
                className="w-full pl-9 pr-3 py-3 rounded-xl bg-[#1E293B] border border-slate-700 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25 outline-none text-sm font-medium placeholder:text-slate-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="gate-senha" className="block text-xs font-bold text-slate-300 mb-1.5">
              Senha
            </label>
            <div className="relative">
              <Lock
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
              />
              <input
                id="gate-senha"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Sua senha"
                className="w-full pl-9 pr-3 py-3 rounded-xl bg-[#1E293B] border border-slate-700 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25 outline-none text-sm font-medium placeholder:text-slate-500"
              />
            </div>
          </div>

          {erro && (
            <p
              role="alert"
              className="p-3 rounded-xl bg-rose-500/12 border border-rose-500/40 text-rose-300 text-sm font-semibold"
            >
              {erro}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm tracking-wide shadow-lg shadow-cyan-500/25 active:scale-[0.98] transition-all disabled:opacity-60 disabled:active:scale-100 flex items-center justify-center gap-2"
          >
            <LogIn size={17} strokeWidth={2.5} />
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p className="mt-7 text-center text-xs text-slate-400 leading-relaxed">
          O KiteNinja é fechado, por convite.
          <br />
          Recebeu um link de convite? Abra o link para criar sua conta.
        </p>
      </div>
    </div>
  );
};
