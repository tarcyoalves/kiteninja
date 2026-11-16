'use client';

import React, { useState } from 'react';
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { MSG_SENHA_CURTA, SENHA_MAXIMA, SENHA_MINIMA } from '../lib/senhaRegras';

/**
 * Trocar a própria senha, por vontade própria.
 *
 * POR QUE ISTO EXISTE
 *
 * A rota `/api/auth/change-password` sempre existiu, mas a única tela que a
 * chamava era o modal de troca OBRIGATÓRIA (senha provisória). Quem queria
 * trocar a senha sem ter esquecido a atual não tinha por onde — e o painel
 * admin, ao recusar gerar senha provisória para a própria conta, mandava o
 * administrador "trocar a senha pelo perfil", um lugar que não existia.
 *
 * A troca mantém esta sessão e encerra as outras (é o que a rota faz), então
 * serve também para quem suspeita que alguém entrou na conta.
 */
export const TrocarSenhaSecao: React.FC = () => {
  const { changePassword } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repetida, setRepetida] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [trocada, setTrocada] = useState(false);

  const fechar = () => {
    if (salvando) return;
    setAberto(false);
    setAtual('');
    setNova('');
    setRepetida('');
    setErro(null);
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (salvando) return;
    if (nova.length < SENHA_MINIMA) return setErro(MSG_SENHA_CURTA);
    if (nova !== repetida) return setErro('As duas senhas novas não são iguais.');
    if (nova === atual) return setErro('A senha nova precisa ser diferente da atual.');

    setSalvando(true);
    setErro(null);
    const res = await changePassword(atual, nova);
    setSalvando(false);
    if (!res.ok) {
      setErro(res.error ?? 'Não foi possível trocar a senha.');
      return;
    }
    setAberto(false);
    setAtual('');
    setNova('');
    setRepetida('');
    setTrocada(true);
  };

  const campo =
    'mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-500 disabled:opacity-50';
  const rotulo = 'block text-[11px] font-bold uppercase tracking-wide text-slate-400';

  return (
    <div className="mt-8 pt-6 border-t border-slate-800">
      <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 mb-3">Senha</h3>

      {trocada && !aberto && (
        <p className="mb-3 flex items-center gap-1.5 text-xs font-bold text-emerald-400">
          <CheckCircle2 size={14} />
          Senha trocada. Os outros aparelhos foram desconectados.
        </p>
      )}

      {!aberto ? (
        <button
          type="button"
          onClick={() => {
            setTrocada(false);
            setAberto(true);
          }}
          className="w-full py-3 rounded-xl border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
        >
          <KeyRound size={16} />
          <span>Trocar minha senha</span>
        </button>
      ) : (
        <form onSubmit={enviar} className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
          <div>
            <label htmlFor="senha-atual" className={rotulo}>
              Senha atual
            </label>
            <input
              id="senha-atual"
              type="password"
              autoComplete="current-password"
              required
              value={atual}
              onChange={(e) => {
                setAtual(e.target.value);
                setErro(null);
              }}
              disabled={salvando}
              className={campo}
            />
          </div>
          <div>
            <label htmlFor="senha-nova" className={rotulo}>
              Senha nova (mínimo {SENHA_MINIMA} caracteres)
            </label>
            <input
              id="senha-nova"
              type="password"
              autoComplete="new-password"
              required
              minLength={SENHA_MINIMA}
              maxLength={SENHA_MAXIMA}
              value={nova}
              onChange={(e) => {
                setNova(e.target.value);
                setErro(null);
              }}
              disabled={salvando}
              className={campo}
            />
          </div>
          <div>
            <label htmlFor="senha-repetida" className={rotulo}>
              Repita a senha nova
            </label>
            <input
              id="senha-repetida"
              type="password"
              autoComplete="new-password"
              required
              maxLength={SENHA_MAXIMA}
              value={repetida}
              onChange={(e) => {
                setRepetida(e.target.value);
                setErro(null);
              }}
              disabled={salvando}
              className={campo}
            />
          </div>

          {erro && (
            <p role="alert" className="text-xs font-bold text-rose-400">
              {erro}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={fechar}
              disabled={salvando}
              className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm disabled:opacity-50 active:scale-95 transition-all"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando}
              className="flex-1 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-all"
            >
              {salvando && <Loader2 size={15} className="animate-spin" />}
              <span>{salvando ? 'Trocando...' : 'Trocar senha'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
