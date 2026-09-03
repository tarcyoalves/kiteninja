'use client';

import React, { useEffect, useState } from 'react';
import { AlertOctagon, CheckCircle2, Loader2, RefreshCw, Server, Smartphone } from 'lucide-react';

/**
 * Painel de erros de produção.
 *
 * Antes disto o app não tinha onde olhar quando algo quebrava no aparelho de
 * outra pessoa: `handle()` fazia `console.error` e a mensagem morria no log da
 * função. As três auditorias externas apontaram a mesma ausência.
 *
 * A lista é ordenada por última ocorrência e mostra o contador de repetições,
 * porque as duas perguntas de quem abre esta tela são "o que quebrou agora?" e
 * "isso é raro ou está sangrando?".
 */

interface ErroLinha {
  id: number;
  origem: 'servidor' | 'cliente';
  rota: string | null;
  mensagem: string;
  stack: string | null;
  user_agent: string | null;
  ocorrencias: number;
  primeira_em: string;
  ultima_em: string;
  resolvido_em: string | null;
  usuario: string | null;
}

function quando(iso: string): string {
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 1440) return `há ${Math.floor(min / 60)} h`;
  return d.toLocaleDateString('pt-BR');
}

export const ErrosManager: React.FC = () => {
  const [erros, setErros] = useState<ErroLinha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroDaTela, setErroDaTela] = useState<string | null>(null);
  const [mostrarResolvidos, setMostrarResolvidos] = useState(false);
  const [aberto, setAberto] = useState<number | null>(null);
  const [recarga, setRecarga] = useState(0);

  /**
   * Recarrega quando o filtro muda ou quando `recarga` é incrementado pelo
   * botão.
   *
   * Todo `setState` acontece DEPOIS de um `await`, de propósito: o React
   * Compiler sinaliza estado alterado de forma síncrona dentro de efeito
   * (dispara renderização em cascata), e a flag inicial de carregamento já
   * nasce `true` no `useState` — não precisa ser ligada aqui.
   */
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/erros${mostrarResolvidos ? '?resolvidos=1' : ''}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('Não foi possível carregar os erros.');
        const dados = (await res.json()) as { erros: ErroLinha[] };
        if (!vivo) return;
        setErros(dados.erros ?? []);
        setErroDaTela(null);
      } catch (e) {
        if (vivo) setErroDaTela(e instanceof Error ? e.message : 'Falha ao carregar.');
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [mostrarResolvidos, recarga]);

  const recarregar = () => {
    setCarregando(true);
    setRecarga((n) => n + 1);
  };

  const alternarResolvido = async (linha: ErroLinha) => {
    const proximo = linha.resolvido_em === null;
    // Otimista: a lista some/volta na hora, e recarrega em seguida para
    // confirmar. Se o PATCH falhar, o recarregamento desfaz visualmente.
    setErros((atual) =>
      atual.map((e) =>
        e.id === linha.id ? { ...e, resolvido_em: proximo ? new Date().toISOString() : null } : e
      )
    );
    await fetch('/api/admin/erros', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: linha.id, resolvido: proximo }),
    }).catch(() => {});
    recarregar();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-sm font-black text-white">Erros em produção</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Ocorrências iguais são agrupadas e contadas.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setMostrarResolvidos((v) => !v)}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
              mostrarResolvidos
                ? 'bg-slate-700 text-white'
                : 'bg-slate-800/70 text-slate-400 hover:text-white'
            }`}
          >
            {mostrarResolvidos ? 'Todos' : 'Só abertos'}
          </button>
          <button
            type="button"
            onClick={recarregar}
            aria-label="Recarregar"
            className="p-1.5 rounded-lg bg-slate-800/70 text-slate-400 hover:text-white transition-colors"
          >
            <RefreshCw size={14} className={carregando ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {erroDaTela && (
        <p role="alert" className="text-xs font-bold text-rose-400 mb-3">
          {erroDaTela}
        </p>
      )}

      {carregando && erros.length === 0 && (
        <div className="flex items-center justify-center py-10 text-slate-500">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      {!carregando && erros.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <CheckCircle2 size={28} className="text-emerald-400 mb-2" />
          <p className="text-sm font-black text-white">Nenhum erro em aberto</p>
          <p className="text-[11px] text-slate-500 mt-1">
            É o resultado que se espera — mas agora existe onde olhar.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {erros.map((e) => (
          <div
            key={e.id}
            className={`rounded-xl border p-3 ${
              e.resolvido_em
                ? 'border-slate-800 bg-slate-900/40 opacity-60'
                : 'border-rose-500/30 bg-rose-500/5'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {e.origem === 'servidor' ? (
                <Server size={15} className="text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <Smartphone size={15} className="text-cyan-400 shrink-0 mt-0.5" />
              )}

              <button
                type="button"
                onClick={() => setAberto(aberto === e.id ? null : e.id)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="text-xs font-bold text-white break-words">{e.mensagem}</p>
                <p className="text-[10px] text-slate-500 mt-1 font-mono break-all">
                  {e.rota ?? 'rota desconhecida'}
                </p>
                <p className="text-[10px] text-slate-500 mt-1">
                  {e.ocorrencias}× · última {quando(e.ultima_em)}
                  {e.usuario ? ` · ${e.usuario}` : ''}
                </p>
              </button>

              <button
                type="button"
                onClick={() => void alternarResolvido(e)}
                title={e.resolvido_em ? 'Reabrir' : 'Marcar como resolvido'}
                aria-label={e.resolvido_em ? 'Reabrir erro' : 'Marcar erro como resolvido'}
                className={`shrink-0 p-1.5 rounded-lg transition-colors ${
                  e.resolvido_em
                    ? 'text-slate-500 hover:text-white'
                    : 'text-emerald-400 hover:bg-emerald-500/15'
                }`}
              >
                {e.resolvido_em ? <AlertOctagon size={15} /> : <CheckCircle2 size={15} />}
              </button>
            </div>

            {aberto === e.id && (
              <div className="mt-3 pt-3 border-t border-slate-800 space-y-2">
                {e.stack && (
                  <pre className="text-[10px] text-slate-400 font-mono whitespace-pre-wrap break-all max-h-56 overflow-y-auto">
                    {e.stack}
                  </pre>
                )}
                {e.user_agent && (
                  <p className="text-[10px] text-slate-600 break-all">{e.user_agent}</p>
                )}
                <p className="text-[10px] text-slate-600">
                  Primeira vez: {new Date(e.primeira_em).toLocaleString('pt-BR')}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
