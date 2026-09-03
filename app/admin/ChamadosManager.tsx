'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bug, Lightbulb, Loader2, User } from 'lucide-react';
import { formatRelativeTime } from '@/lib/chat';
import type { ChamadoAdmin, StatusChamado } from '@/types';

const STATUS_OPCOES: readonly { value: StatusChamado | 'todos'; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'novo', label: 'Novo' },
  { value: 'em_analise', label: 'Em análise' },
  { value: 'aprovado', label: 'Aprovado' },
  { value: 'rejeitado', label: 'Rejeitado' },
  { value: 'implementado', label: 'Implementado' },
];

const STATUS_STYLE: Record<StatusChamado, string> = {
  novo: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  em_analise: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  aprovado: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rejeitado: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  implementado: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
};

/** Uma linha da lista — estado próprio de parecer, porque digitar não pode
 * disparar uma requisição a cada tecla (só o botão "Salvar parecer" salva). */
function LinhaChamado({
  chamado,
  onMudarStatus,
  onSalvarParecer,
}: {
  chamado: ChamadoAdmin;
  onMudarStatus: (id: string, status: StatusChamado) => void;
  onSalvarParecer: (id: string, parecer: string) => Promise<void>;
}) {
  const [parecer, setParecer] = useState(chamado.parecer ?? '');
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);

  const salvar = async () => {
    setSalvando(true);
    setSalvo(false);
    try {
      await onSalvarParecer(chamado.id, parecer.trim());
      setSalvo(true);
      setTimeout(() => setSalvo(false), 2500);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <article className="p-4 rounded-2xl bg-[#0B132B] border border-slate-800 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 shrink-0 rounded-full bg-slate-800 ring-1 ring-slate-700 overflow-hidden flex items-center justify-center">
          {chamado.autorAvatarUrl ? (
            <img src={chamado.autorAvatarUrl} alt={chamado.autorNome} className="w-full h-full object-cover" />
          ) : (
            <User size={16} className="text-slate-400" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-300 truncate max-w-[45%]">{chamado.autorNome}</span>
            <span
              className={`px-2 py-0.5 rounded-lg text-[10px] font-black border uppercase flex items-center gap-1 ${
                chamado.tipo === 'bug'
                  ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                  : 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
              }`}
            >
              {chamado.tipo === 'bug' ? <Bug size={10} /> : <Lightbulb size={10} />}
              {chamado.tipo === 'bug' ? 'Bug' : 'Melhoria'}
            </span>
            <span className="text-[11px] text-slate-500 ml-auto">{formatRelativeTime(chamado.createdAt)}</span>
          </div>
          {/*
            * `break-words` em TODO texto que veio do usuário.
            *
            * Um chamado é escrito por quem está reportando um bug — vem com URL
            * colada, caminho de rota, trecho de log. Nada disso tem espaço para
            * quebrar, e sem `break-words` uma única linha dessas estica o cartão
            * além da tela e faz o painel inteiro deslizar de lado.
            *
            * `whitespace-pre-wrap` sozinho não resolve: ele preserva as quebras
            * que a pessoa digitou, mas não cria quebra dentro de uma palavra que
            * nunca teve espaço nenhum.
            */}
          <p className="font-black text-sm text-white break-words">{chamado.titulo}</p>
          <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap break-words">
            {chamado.descricao}
          </p>
          {chamado.tela && (
            <p className="text-[11px] text-slate-500 break-words">Tela: {chamado.tela}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor={`status-${chamado.id}`} className="text-[11px] font-bold text-slate-400 shrink-0">
          Status:
        </label>
        <select
          id={`status-${chamado.id}`}
          value={chamado.status}
          onChange={(e) => onMudarStatus(chamado.id, e.target.value as StatusChamado)}
          className={`flex-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-black uppercase bg-[#1E293B] ${STATUS_STYLE[chamado.status]}`}
        >
          {STATUS_OPCOES.filter((o) => o.value !== 'todos').map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`parecer-${chamado.id}`} className="text-[11px] font-bold text-slate-400">
          Parecer
        </label>
        <textarea
          id={`parecer-${chamado.id}`}
          value={parecer}
          onChange={(e) => setParecer(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="Anotação sobre a análise deste chamado..."
          className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white text-xs resize-none focus:outline-none focus:border-cyan-400"
        />
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          className="px-3 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 text-[11px] font-black flex items-center gap-1.5 disabled:opacity-50"
        >
          {salvando && <Loader2 size={11} className="animate-spin" />}
          {salvo ? 'Salvo!' : 'Salvar parecer'}
        </button>
      </div>
    </article>
  );
}

export function ChamadosManager() {
  const [filtro, setFiltro] = useState<StatusChamado | 'todos'>('todos');
  const [chamados, setChamados] = useState<ChamadoAdmin[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      setCarregando(true);
      setErro(null);
      try {
        const url = filtro === 'todos' ? '/api/admin/chamados' : `/api/admin/chamados?status=${filtro}`;
        const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            (body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null) ||
              'Não foi possível carregar os chamados.'
          );
        }
        setChamados((body as { chamados: ChamadoAdmin[] }).chamados);
      } catch (err) {
        if (!controller.signal.aborted) {
          setErro(err instanceof Error ? err.message : 'Falha ao carregar chamados.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setCarregando(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [filtro]);

  const mudarStatus = async (id: string, status: StatusChamado) => {
    // Otimista: a lista reage na hora; reverte se o servidor recusar.
    const anterior = chamados;
    setChamados((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
    try {
      const res = await fetch(`/api/admin/chamados/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setChamados(anterior);
      setErro('Não foi possível salvar o status. Tente de novo.');
    }
  };

  const salvarParecer = async (id: string, parecer: string) => {
    const res = await fetch(`/api/admin/chamados/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parecer }),
    });
    if (!res.ok) {
      setErro('Não foi possível salvar o parecer. Tente de novo.');
      return;
    }
    setChamados((prev) => prev.map((c) => (c.id === id ? { ...c, parecer } : c)));
  };

  return (
    <div className="w-full space-y-5">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {STATUS_OPCOES.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setFiltro(o.value)}
            className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
              filtro === o.value
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                : 'bg-[#1E293B] text-slate-400 border border-slate-700/80 hover:text-white'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {erro && (
        <p role="alert" className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-sm font-semibold">
          {erro}
        </p>
      )}

      {carregando && chamados.length === 0 && (
        <div className="flex justify-center py-10 text-cyan-400">
          <Loader2 size={24} className="animate-spin" />
        </div>
      )}

      {!carregando && chamados.length === 0 && (
        <p className="text-sm text-slate-500 px-1 py-6 text-center">Nenhum chamado com este status.</p>
      )}

      <div className="space-y-3">
        {chamados.map((c) => (
          <LinhaChamado key={c.id} chamado={c} onMudarStatus={mudarStatus} onSalvarParecer={salvarParecer} />
        ))}
      </div>
    </div>
  );
}
