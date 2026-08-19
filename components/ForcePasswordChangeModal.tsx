'use client';

import React, { useState } from 'react';
import { KeyRound, Lock, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/**
 * Bloqueio de "precisa trocar a senha", mostrado no lugar do app inteiro
 * (mesmo padrão do LoginGate) quando `mustChangePassword` vem true do
 * servidor — típico de conta recém-criada por convite ou resetada pelo
 * admin, que ainda está com a senha temporária.
 *
 * De propósito não existe botão de fechar/pular: enquanto a flag estiver
 * ligada no banco, essa é a única tela que o velejador vê depois de logar.
 * A única saída é "Sair", que devolve para o login (e a próxima entrada cai
 * de novo aqui, porque a flag continua ligada até a troca ser concluída).
 */
export const ForcePasswordChangeModal: React.FC = () => {
  const { changePassword, logout } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Mesmo mínimo usado pelo servidor (lib/validation.ts:password) — validar
  // com um número diferente aqui só criaria uma tela que aceita e um back-end
  // que rejeita.
  const MIN_LEN = 10;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setErro(null);

    if (newPassword.length < MIN_LEN) {
      setErro(`A nova senha precisa ter no mínimo ${MIN_LEN} caracteres.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setErro('A confirmação não bate com a nova senha.');
      return;
    }
    if (newPassword === currentPassword) {
      setErro('A nova senha precisa ser diferente da atual.');
      return;
    }

    setLoading(true);
    try {
      const r = await changePassword(currentPassword, newPassword);
      if (!r.ok) {
        // Servidor é a fonte de verdade (ex.: "senha atual incorreta" só ele
        // sabe dizer) — a validação acima é só para poupar uma ida à rede.
        setErro(r.error ?? 'Não foi possível trocar a senha.');
      }
      // Sucesso não precisa de ação: o AuthContext atualiza mustChangePassword
      // a partir do /me e essa tela desmonta sozinha.
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
          <div className="w-16 h-16 rounded-full bg-cyan-500/15 ring-1 ring-cyan-400/40 flex items-center justify-center">
            <ShieldCheck size={30} className="text-cyan-400" />
          </div>
          <h1 className="mt-4 text-lg font-black text-white">Troque sua senha para continuar</h1>
          <p className="mt-2 text-sm text-slate-400 font-medium leading-relaxed">
            Essa conta ainda está com uma senha temporária. Defina uma senha
            só sua antes de usar o KiteNinja.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label htmlFor="fpc-atual" className="block text-xs font-bold text-slate-300 mb-1.5">
              Senha atual (temporária)
            </label>
            <div className="relative">
              <KeyRound
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
              />
              <input
                id="fpc-atual"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="A senha que você acabou de usar"
                className="w-full pl-9 pr-3 py-3 rounded-xl bg-[#1E293B] border border-slate-700 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25 outline-none text-sm font-medium placeholder:text-slate-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="fpc-nova" className="block text-xs font-bold text-slate-300 mb-1.5">
              Nova senha
            </label>
            <div className="relative">
              <Lock
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
              />
              <input
                id="fpc-nova"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_LEN}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={`Mínimo ${MIN_LEN} caracteres`}
                className="w-full pl-9 pr-3 py-3 rounded-xl bg-[#1E293B] border border-slate-700 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25 outline-none text-sm font-medium placeholder:text-slate-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="fpc-confirmar" className="block text-xs font-bold text-slate-300 mb-1.5">
              Confirmar nova senha
            </label>
            <div className="relative">
              <Lock
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
              />
              <input
                id="fpc-confirmar"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_LEN}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a nova senha"
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
            <ShieldCheck size={17} strokeWidth={2.5} />
            {loading ? 'Trocando...' : 'Trocar senha e continuar'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => logout()}
          className="mt-6 w-full flex items-center justify-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-300 transition-colors"
        >
          <LogOut size={14} />
          Sair
        </button>
      </div>
    </div>
  );
};
