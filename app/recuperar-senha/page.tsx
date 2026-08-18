'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, KeyRound, Mail, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

export default function RecuperarSenhaPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setError('Informe um endereço de e-mail válido.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/recover-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível solicitar a recuperação.');
        return;
      }

      setSubmitted(true);
    } catch {
      setError('Falha de conexão. Verifique sua internet.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0F172A] text-slate-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#1E293B] rounded-3xl border border-slate-700/80 shadow-2xl p-6 sm:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            <span>Voltar ao login</span>
          </Link>
          <span className="text-xs font-black text-cyan-400">KiteNinja</span>
        </div>

        {submitted ? (
          <div className="text-center space-y-4 py-4">
            <div className="w-14 h-14 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto">
              <CheckCircle2 size={32} />
            </div>
            <h1 className="text-xl font-black text-white">Instruções enviadas!</h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              Se o endereço <strong className="text-white">{email}</strong> estiver cadastrado na plataforma, você receberá o link para redefinir sua senha. O link expira em 2 horas.
            </p>
            <Link
              href="/"
              className="inline-block mt-4 w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-cyan-500/25 transition-all text-center"
            >
              Ir para o Login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1 text-center sm:text-left">
              <h1 className="text-xl font-black text-white flex items-center gap-2">
                <KeyRound className="text-cyan-400" size={22} />
                <span>Recuperar Senha</span>
              </h1>
              <p className="text-xs text-slate-400">
                Digite o e-mail da sua conta para receber as instruções de redefinição de acesso.
              </p>
            </div>

            {error && (
              <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-xs font-bold text-rose-300 flex items-center gap-2">
                <AlertTriangle size={16} className="text-rose-400 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-300">Seu E-mail Cadastrado</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="exemplo@kiteninja.com"
                  required
                  className="w-full pl-9 pr-3 py-2.5 bg-[#0F172A] border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-hidden focus:border-cyan-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 active:scale-98 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Enviando...</span>
                </>
              ) : (
                <span>Enviar Link de Recuperação</span>
              )}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
