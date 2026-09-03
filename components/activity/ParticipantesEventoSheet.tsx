'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, MapPin, Users, X } from 'lucide-react';

export interface ParticipanteEvento {
  id: string;
  name: string;
  avatarUrl: string | null;
  riderId: string;
  countryFlag: string;
  riderLevel: string;
  homeSpot: string | null;
  confirmadoEm: string;
  souEu: boolean;
}

interface Props {
  eventoId: string;
  titulo: string;
  onFechar: () => void;
}

/**
 * Quem confirmou presença num evento.
 *
 * POR QUE ESTA TELA EXISTE
 *
 * O card mostrava "5 riders confirmados" como texto morto. A tabela
 * `event_registrations` era gravada certo desde sempre e **só era contada** —
 * as duas únicas consultas a ela em todo o app eram `COUNT(*)`. Não havia
 * nenhum lugar, em lugar nenhum, que dissesse QUEM eram os cinco.
 *
 * Confirmar presença serve para o grupo se organizar. Saber quem vai é o
 * motivo de o botão existir; sem isso o número é enfeite.
 */
export const ParticipantesEventoSheet: React.FC<Props> = ({ eventoId, titulo, onFechar }) => {
  const [participantes, setParticipantes] = useState<ParticipanteEvento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  /*
   * IIFE async com flag de cancelamento — mesmo padrão de
   * DownwindResumoModal, RiderProfileModal, ChamadosModal e outros três.
   *
   * Duas razões, e nenhuma é estilo. (1) O lint do React Compiler reprova
   * `setState` síncrono no corpo de um efeito, e chamar uma função async
   * direto ali conta como isso — ele não enxerga além do `await`. (2) A flag
   * evita gravar estado depois que a folha já fechou: quem toca no contador,
   * lê o número e fecha antes da resposta chegar é o caso normal, não a
   * exceção.
   */
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventoId}/participantes`);
        const body = await res.json().catch(() => null);
        if (cancelado) return;
        if (!res.ok) {
          setErro(body?.error ?? 'Não foi possível carregar a lista.');
          setParticipantes([]);
          return;
        }
        setErro(null);
        setParticipantes((body?.participantes ?? []) as ParticipanteEvento[]);
      } catch {
        if (cancelado) return;
        setErro('Sem conexão. Tente de novo.');
        setParticipantes([]);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [eventoId]);

  return (
    <div
      className="fixed inset-0 z-modal flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-xs p-3 animate-in fade-in duration-200"
      onClick={onFechar}
    >
      <div
        className="w-full max-w-sm bg-[#0F172A] border border-slate-800 rounded-3xl shadow-2xl overlay-safe-bottom flex flex-col max-h-[75vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-start justify-between gap-2 p-4 pb-3 border-b border-slate-800/80">
          <div className="min-w-0">
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <Users size={18} className="text-emerald-400 shrink-0" />
              <span>Quem confirmou</span>
            </h2>
            {/* `break-words`: título de evento é texto livre do organizador. */}
            <p className="text-xs text-slate-400 mt-0.5 break-words">{titulo}</p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            className="shrink-0 p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {participantes === null && (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400 text-xs font-bold">
              <Loader2 size={16} className="animate-spin text-cyan-400" />
              <span>Carregando...</span>
            </div>
          )}

          {erro && (
            <p className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              {erro}
            </p>
          )}

          {participantes !== null && !erro && participantes.length === 0 && (
            <div className="py-10 text-center text-slate-400">
              <Users size={28} className="mx-auto mb-2 opacity-40" />
              <p className="text-xs font-bold">Ninguém confirmou ainda.</p>
              <p className="text-[11px] mt-1">Seja o primeiro a dizer que vai.</p>
            </div>
          )}

          {participantes?.map((p) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 p-2.5 rounded-2xl border ${
                p.souEu
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-slate-900/70 border-slate-800'
              }`}
            >
              <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 overflow-hidden shrink-0 flex items-center justify-center">
                {p.avatarUrl ? (
                  <img src={p.avatarUrl} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <Users size={16} className="text-slate-400" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <strong className="text-sm font-black text-white break-words">{p.name}</strong>
                  {p.countryFlag && <span className="shrink-0">{p.countryFlag}</span>}
                  {p.souEu && (
                    <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                      você
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                  {p.riderId && <span className="font-mono text-cyan-400">#{p.riderId}</span>}
                  {p.riderLevel && <span>{p.riderLevel}</span>}
                  {p.homeSpot && (
                    <span className="flex items-center gap-0.5 min-w-0">
                      <MapPin size={10} className="text-rose-400 shrink-0" />
                      <span className="truncate">{p.homeSpot}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {participantes !== null && participantes.length > 0 && (
          <div className="shrink-0 px-4 py-3 border-t border-slate-800/80 text-center">
            <span className="text-xs font-bold text-emerald-400">
              {participantes.length} {participantes.length === 1 ? 'rider confirmado' : 'riders confirmados'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
