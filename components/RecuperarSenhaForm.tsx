'use client';

import React, { useState } from 'react';
import { Loader2, MailCheck } from 'lucide-react';

/**
 * Formulário de "esqueci minha senha" — só é montado quando o envio de e-mail
 * está configurado no servidor (ver app/recuperar-senha/page.tsx).
 *
 * A mensagem de sucesso é a mesma para e-mail cadastrado ou não, de propósito:
 * a rota responde igual nos dois casos para não revelar quem tem conta.
 */
export const RecuperarSenhaForm: React.FC = () => {
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch('/api/auth/recover-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => null)) as { error?: string } | null;
        setErro(corpo?.error ?? 'Não foi possível pedir o link. Tente novamente.');
        return;
      }
      setEnviado(true);
    } catch {
      setErro('Falha de conexão. Verifique a internet e tente novamente.');
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <div className="flex gap-3 p-3 rounded-2xl bg-[#0F172A] border border-emerald-500/40">
        <MailCheck size={18} className="text-emerald-400 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-300 leading-relaxed">
          <strong className="text-white">Confira seu e-mail.</strong> Se esse endereço tiver conta
          no KiteNinja, o link para escolher a senha nova chega em alguns minutos. Ele vale por 2
          horas. Olhe também a caixa de spam.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <div>
        <label
          htmlFor="email-recuperacao"
          className="block text-[11px] font-bold uppercase tracking-wide text-slate-400"
        >
          E-mail da sua conta
        </label>
        <input
          id="email-recuperacao"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setErro(null);
          }}
          disabled={enviando}
          placeholder="voce@exemplo.com"
          className="mt-1.5 w-full rounded-xl border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-500 disabled:opacity-50"
        />
      </div>

      {erro && (
        <p role="alert" className="text-xs font-bold text-rose-400">
          {erro}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {enviando && <Loader2 size={14} className="animate-spin" />}
        <span>{enviando ? 'Enviando...' : 'Enviar link por e-mail'}</span>
      </button>
    </form>
  );
};
