'use client';

import React, { useState } from 'react';
import { Trash2, AlertTriangle, Loader2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/**
 * Exclusão da própria conta, dentro do app.
 *
 * POR QUE ESTE COMPONENTE EXISTE
 *
 * O Google Play exige que o caminho de exclusão exista DENTRO do app, não só
 * numa página de suporte — a URL pública (`/excluir-conta`) é a segunda porta,
 * para quem já desinstalou. Sem esta seção, o envio é recusado na revisão.
 *
 * O fluxo é deliberadamente chato: dois toques e a senha. Exclusão é
 * irreversível e o celular do velejador passa o dia desbloqueado na praia,
 * dentro de uma bolsa, perto de outras pessoas. Um botão de um toque só aqui
 * seria um jeito fácil de perder a conta sem querer — ou de alguém perdê-la
 * por você.
 *
 * A mensagem de erro vinda da API é mostrada como está, e não substituída por
 * um "algo deu errado": os dois casos de recusa que a rota devolve (SOS em
 * aberto, último administrador) dizem exatamente o que fazer para destravar.
 */
export const ExcluirContaSecao: React.FC = () => {
  const { logout } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const fechar = () => {
    if (enviando) return;
    setAberto(false);
    setSenha('');
    setErro(null);
  };

  const excluir = async () => {
    if (senha.length === 0) {
      setErro('Digite sua senha para confirmar.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: senha }),
      });

      if (!res.ok) {
        const corpo = (await res.json().catch(() => null)) as { error?: string } | null;
        setErro(corpo?.error ?? 'Não foi possível excluir a conta. Tente novamente.');
        setEnviando(false);
        return;
      }

      // A conta já não existe; `logout` limpa o estado local e leva de volta
      // para a tela de entrada. O cookie de sessão a própria rota apagou.
      await logout();
    } catch {
      setErro('Falha de conexão. Verifique a internet e tente novamente.');
      setEnviando(false);
    }
  };

  return (
    <div className="mt-8 pt-6 border-t border-slate-800">
      <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 mb-3">
        Zona de risco
      </h3>

      {!aberto ? (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="w-full py-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
        >
          <Trash2 size={16} />
          <span>Excluir minha conta</span>
        </button>
      ) : (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} className="text-rose-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-white">Isso não tem volta</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                Seus velejos, trilhas de GPS, downwinds, mensagens e publicações são apagados
                permanentemente. Não existe lixeira nem como desfazer.
              </p>
            </div>
            <button
              type="button"
              onClick={fechar}
              disabled={enviando}
              aria-label="Cancelar exclusão"
              className="shrink-0 text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <label
            htmlFor="senha-exclusao"
            className="mt-4 block text-[11px] font-bold uppercase tracking-wide text-slate-400"
          >
            Confirme com sua senha
          </label>
          <input
            id="senha-exclusao"
            type="password"
            value={senha}
            onChange={(e) => {
              setSenha(e.target.value);
              setErro(null);
            }}
            autoComplete="current-password"
            disabled={enviando}
            className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-rose-500 disabled:opacity-50"
            placeholder="Sua senha"
          />

          {erro && (
            <p role="alert" className="mt-2 text-xs font-bold text-rose-400">
              {erro}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={fechar}
              disabled={enviando}
              className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm disabled:opacity-50 active:scale-95 transition-all"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={excluir}
              disabled={enviando}
              className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-all"
            >
              {enviando ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              <span>{enviando ? 'Excluindo...' : 'Excluir'}</span>
            </button>
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Prefere fazer por fora do app, ou já desinstalou?{' '}
        <a href="/excluir-conta" className="text-slate-400 underline hover:text-slate-300">
          Veja as instruções completas
        </a>
        .
      </p>
    </div>
  );
};
