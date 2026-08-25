'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bug, Lightbulb, Loader2, MessageSquareWarning, Send, X } from 'lucide-react';
import { formatRelativeTime } from '@/lib/chat';
import type { MeuChamado, StatusChamado, TipoChamado } from '@/types';

interface ChamadosModalProps {
  aberto: boolean;
  onClose: () => void;
  /** Aba em que o usuário estava ao abrir este modal (contexto do chamado). */
  telaAtual?: string;
}

const STATUS_LABEL: Record<StatusChamado, string> = {
  novo: 'Novo',
  em_analise: 'Em análise',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  implementado: 'Implementado',
};

const STATUS_STYLE: Record<StatusChamado, string> = {
  novo: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  em_analise: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  aprovado: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rejeitado: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  implementado: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
};

/**
 * Central de chamados do usuário — reportar bug/melhoria e acompanhar o
 * status dos próprios chamados. Mesmo padrão full-screen de
 * BuscarVelejadores.tsx: `fixed inset-0 z-modal`, overlay-safe-top, Esc
 * fecha, scroll do fundo travado enquanto aberto.
 *
 * NÃO é um assistente automático: o "agente" que analisa plausibilidade é o
 * Claude Code, numa sessão futura, lendo a fila quando o dono pedir — mesmo
 * espírito dos documentos de pendência (docs/PENDENCIAS-*.md), só que
 * estruturado no banco em vez de markdown solto.
 */
export const ChamadosModal: React.FC<ChamadosModalProps> = ({ aberto, onClose, telaAtual }) => {
  const [tipo, setTipo] = useState<TipoChamado>('bug');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [confirmacao, setConfirmacao] = useState(false);

  const [chamados, setChamados] = useState<MeuChamado[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erroLista, setErroLista] = useState<string | null>(null);

  /**
   * Fecha o modal — mas primeiro tira o foco de QUALQUER campo focado. O
   * formulário tem um <input> (título) e uma <textarea> (descrição), e
   * desmontar um elemento ainda focado nem sempre dispara `focusout` a
   * tempo em todo navegador — `lib/useKeyboardVisible.ts` (usado por
   * BottomNav, que nunca desmonta) ficaria travado achando que o teclado
   * continua aberto, e o menu flutuante sumiria para sempre depois de
   * fechar esta tela. Mesmo bug real já corrigido em BuscarVelejadores.tsx
   * e SessionDetailModal.tsx — replicado aqui porque o risco é idêntico.
   */
  const fechar = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar();
    };
    window.addEventListener('keydown', onKey);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = anterior;
    };
  }, [aberto, fechar]);

  useEffect(() => {
    if (!aberto) return;

    let ativo = true;

    (async () => {
      setCarregando(true);
      setErroLista(null);
      try {
        const res = await fetch('/api/chamados', { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            (body && typeof body === 'object' && 'error' in body
              ? String((body as { error: unknown }).error)
              : null) || 'Não foi possível carregar seus chamados.'
          );
        }
        if (!ativo) return;
        setChamados((body as { chamados: MeuChamado[] }).chamados);
      } catch (err) {
        if (ativo) setErroLista(err instanceof Error ? err.message : 'Falha ao carregar chamados.');
      } finally {
        if (ativo) setCarregando(false);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [aberto]);

  if (!aberto) return null;

  const podeEnviar = titulo.trim().length >= 3 && descricao.trim().length >= 10 && !enviando;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!podeEnviar) return;

    setEnviando(true);
    setErroEnvio(null);
    setConfirmacao(false);

    try {
      const res = await fetch('/api/chamados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, titulo: titulo.trim(), descricao: descricao.trim(), tela: telaAtual }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (body && typeof body === 'object' && 'error' in body
            ? String((body as { error: unknown }).error)
            : null) || 'Não foi possível enviar o chamado.'
        );
      }
      setChamados((prev) => [body as MeuChamado, ...prev]);
      setTitulo('');
      setDescricao('');
      setConfirmacao(true);
      setTimeout(() => setConfirmacao(false), 3500);
    } catch (err) {
      setErroEnvio(err instanceof Error ? err.message : 'Falha ao enviar. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  };

  const inputClass =
    'w-full p-3 rounded-xl bg-[#1E293B] border border-slate-700 text-white ' +
    'text-sm focus:outline-none focus:border-cyan-400';

  return (
    <div
      className="fixed inset-0 z-modal flex flex-col bg-[#0B1220]"
      role="dialog"
      aria-modal="true"
      aria-label="Reportar bug ou melhoria"
    >
      <div className="shrink-0 overlay-safe-top bg-[#0F172A] border-b border-slate-800 px-4 pt-2 pb-3 flex items-center justify-between gap-2">
        <h2 className="font-black text-sm text-white flex items-center gap-2">
          <MessageSquareWarning size={16} className="text-cyan-400" />
          Reportar Bug ou Melhoria
        </h2>
        <button
          type="button"
          onClick={fechar}
          className="min-w-11 min-h-11 shrink-0 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
          aria-label="Fechar"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5 pb-above-nav">
        <form onSubmit={enviar} className="space-y-3 p-4 rounded-2xl bg-[#0B132B] border border-slate-800">
          <h3 className="font-bold text-sm text-slate-200">Novo chamado</h3>

          {/* Toggle Bug/Melhoria — mesmo idioma visual dos toggles do app. */}
          <div className="flex items-center bg-[#1E293B] p-1 rounded-2xl border border-slate-700/80">
            <button
              type="button"
              onClick={() => setTipo('bug')}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all ${
                tipo === 'bug'
                  ? 'bg-rose-500 text-slate-950 shadow-md shadow-rose-500/25'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Bug size={14} />
              <span>Bug</span>
            </button>
            <button
              type="button"
              onClick={() => setTipo('melhoria')}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all ${
                tipo === 'melhoria'
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Lightbulb size={14} />
              <span>Melhoria</span>
            </button>
          </div>

          <div>
            <label htmlFor="chamado-titulo" className="block text-xs font-bold text-slate-300 mb-1.5">
              Título
            </label>
            <input
              id="chamado-titulo"
              type="text"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={140}
              placeholder={tipo === 'bug' ? 'Ex: Foto do perfil não salva' : 'Ex: Filtro por data no logbook'}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="chamado-descricao" className="block text-xs font-bold text-slate-300 mb-1.5">
              Descrição
            </label>
            <textarea
              id="chamado-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Conte com detalhes o que aconteceu ou o que você gostaria de ver no app."
              className={`${inputClass} resize-none`}
            />
          </div>

          {erroEnvio && (
            <p role="alert" className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-semibold">
              {erroEnvio}
            </p>
          )}

          {confirmacao && (
            <p className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-bold">
              Chamado enviado! Obrigado por ajudar a melhorar o app.
            </p>
          )}

          <button
            type="submit"
            disabled={!podeEnviar}
            className="w-full py-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {enviando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            <span>{enviando ? 'Enviando...' : 'Enviar chamado'}</span>
          </button>
        </form>

        <section className="space-y-2">
          <h3 className="font-bold text-sm text-slate-200 px-1">Meus chamados</h3>

          {carregando && chamados.length === 0 && (
            <div className="flex justify-center py-8 text-cyan-400">
              <Loader2 size={22} className="animate-spin" />
            </div>
          )}

          {!carregando && erroLista && chamados.length === 0 && (
            <div className="p-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 flex items-start gap-2">
              <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-300">{erroLista}</p>
            </div>
          )}

          {!carregando && !erroLista && chamados.length === 0 && (
            <p className="text-sm text-slate-500 px-1 py-4">
              Você ainda não reportou nada. Encontrou um bug ou tem uma ideia? Conta pra gente.
            </p>
          )}

          {chamados.map((c) => (
            <article
              key={c.id}
              className="p-3.5 rounded-2xl bg-[#0B132B] border border-slate-800 space-y-1.5"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-black border uppercase flex items-center gap-1 ${
                    c.tipo === 'bug'
                      ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                      : 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                  }`}
                >
                  {c.tipo === 'bug' ? <Bug size={10} /> : <Lightbulb size={10} />}
                  {c.tipo === 'bug' ? 'Bug' : 'Melhoria'}
                </span>
                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black border uppercase ${STATUS_STYLE[c.status]}`}>
                  {STATUS_LABEL[c.status]}
                </span>
                <span className="text-[11px] text-slate-500 ml-auto">{formatRelativeTime(c.createdAt)}</span>
              </div>
              <p className="font-bold text-sm text-white">{c.titulo}</p>
              <p className="text-xs text-slate-400 leading-relaxed">{c.descricao}</p>
              {c.parecer && (
                <p className="text-[11px] text-slate-400 italic border-l-2 border-slate-700 pl-2 mt-1">
                  {c.parecer}
                </p>
              )}
            </article>
          ))}
        </section>
      </div>
    </div>
  );
};
