'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { X, LogIn, Compass } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const AuthModal: React.FC = () => {
  const { isAuthModalOpen, closeAuthModal, login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  if (!isAuthModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setLoginError(null);
    try {
      const result = await login(email, password);
      if (!result.ok) {
        setLoginError(result.error ?? 'Não foi possível entrar.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-3 bg-black/75 backdrop-blur-xs overflow-y-auto">
      <div className="bg-[#0F172A] text-slate-100 rounded-3xl w-full max-w-md overflow-hidden border border-slate-800 shadow-2xl my-6">
        {/* Top Header */}
        <div className="bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-500 px-5 py-4 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2.5">
            <Compass size={22} className="text-slate-950" />
            <h2 className="font-black text-base sm:text-lg text-slate-950">
              Entrar no KiteNinja
            </h2>
          </div>
          <button
            onClick={closeAuthModal}
            className="p-2 rounded-full bg-black/20 hover:bg-black/40 text-slate-950 transition-colors min-w-11 min-h-11 flex items-center justify-center"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-3.5 text-xs">
          <div>
            <label className="block font-bold text-slate-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="seuemail@exemplo.com"
              className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-semibold focus:outline-hidden focus:border-cyan-400"
              required
              autoComplete="username"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block font-bold text-slate-300">Senha</label>
              {/* next/link e não <a>: navegação client-side não recarrega o
                  app inteiro nem perde o estado do modal. */}
              <Link
                href="/recuperar-senha"
                className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                Esqueceu a senha?
              </Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-semibold focus:outline-hidden focus:border-cyan-400"
              required
              autoComplete="current-password"
            />
          </div>

          {loginError && (
            <p className="text-rose-400 font-bold bg-rose-500/10 border border-rose-500/30 p-2.5 rounded-xl">
              {loginError}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-black text-sm shadow-xl shadow-cyan-500/25 active:scale-98 transition-all flex items-center justify-center gap-2 mt-3 disabled:opacity-50"
          >
            <LogIn size={16} />
            <span>Entrar</span>
          </button>

          <p className="text-[11px] text-slate-400 text-center">
            Não tem uma conta? Solicite um link de convite ao administrador do KiteNinja.
          </p>
        </form>
      </div>
    </div>
  );
};
