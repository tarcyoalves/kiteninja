'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, MapPin, Route, Trophy, Wind, X } from 'lucide-react';
import { corDoUsuario } from '../lib/downwindCores';
import { iniciaisDoNome } from '../lib/htmlEscape';

/**
 * Resumo pós-downwind, no espírito Strava: cada participante vê distância e
 * velocidade máxima da própria travessia, e pode olhar a trilha de qualquer
 * um no mini-mapa (um de cada vez — mesma decisão de "sopa visual" do mapa ao
 * vivo). Aberto a partir do card do evento em views/EventsAndAlertsView.tsx
 * quando `downwindStatus === 'encerrado'`.
 *
 * Dados vêm de GET /api/downwind/[id]/resumo — já gravados no encerramento
 * (ver `resumirEPurgar`, app/api/downwind/[id]/status/route.ts), não
 * recalculados aqui.
 */

const DownwindResumoMapa = dynamic(
  () => import('./DownwindResumoMapa').then((m) => m.DownwindResumoMapa),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full bg-[#090e1a] text-cyan-400">
        <Loader2 size={24} className="animate-spin" />
      </div>
    ),
  }
);

interface ResumoParticipante {
  userId: string;
  nome: string;
  avatarUrl: string | null;
  papel: 'velejador' | 'apoio_terra';
  ehOrganizador: boolean;
  distanciaKm: number | null;
  velocidadeMaxNos: number | null;
  trilhaReduzida: Array<[number, number, number]>;
}

interface ResumoDownwind {
  id: string;
  nome: string;
  status: string;
  previstoPara: string | null;
  iniciadoEm: string | null;
  encerradoEm: string | null;
  saida: { nome: string; lat: number; lng: number } | null;
  chegada: { nome: string; lat: number; lng: number } | null;
}

interface DownwindResumoModalProps {
  downwindId: string;
  meuUserId: string;
  onFechar: () => void;
}

/** Duração formatada a partir de dois ISO — "2h 14min", ou null se faltar dado. */
function formatarDuracao(iniciadoEm: string | null, encerradoEm: string | null): string | null {
  if (!iniciadoEm || !encerradoEm) return null;
  const ms = Date.parse(encerradoEm) - Date.parse(iniciadoEm);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const min = Math.round(ms / 60_000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

export const DownwindResumoModal: React.FC<DownwindResumoModalProps> = ({
  downwindId,
  meuUserId,
  onFechar,
}) => {
  const [downwind, setDownwind] = useState<ResumoDownwind | null>(null);
  const [participantes, setParticipantes] = useState<ResumoParticipante[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCarregando(true);
      setErro(null);
      try {
        const res = await fetch(`/api/downwind/${downwindId}/resumo`, { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? 'Não foi possível carregar o resumo.');
        if (cancelado) return;
        setDownwind(body.downwind as ResumoDownwind);
        setParticipantes((body.participantes ?? []) as ResumoParticipante[]);
        // Seleciona o próprio resultado por padrão, quando existir.
        const eu = (body.participantes ?? []).find(
          (p: ResumoParticipante) => p.userId === meuUserId
        );
        setSelecionadoId(eu?.userId ?? body.participantes?.[0]?.userId ?? null);
      } catch (err) {
        if (!cancelado) setErro(err instanceof Error ? err.message : 'Falha ao carregar.');
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [downwindId, meuUserId]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  const selecionado = useMemo(
    () => participantes.find((p) => p.userId === selecionadoId) ?? null,
    [participantes, selecionadoId]
  );

  const duracao = downwind ? formatarDuracao(downwind.iniciadoEm, downwind.encerradoEm) : null;

  return (
    <div className="fixed inset-0 z-modal flex items-start sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-xs overflow-y-auto">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={downwind ? `Resumo de ${downwind.nome}` : 'Resumo do downwind'}
        className="bg-[#0F172A] text-slate-100 w-full max-w-md sm:rounded-3xl border-slate-800 sm:border shadow-2xl min-h-full sm:min-h-0 sm:my-6 overflow-hidden flex flex-col"
      >
        <div className="sticky top-0 overlay-safe-top bg-[#0F172A]/95 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <h2 className="font-black text-sm text-white truncate flex items-center gap-1.5">
              <Trophy size={15} className="text-amber-400 shrink-0" />
              {downwind ? downwind.nome : 'Resumo do downwind'}
            </h2>
            {downwind?.saida && (
              <p className="text-[11px] text-slate-400 truncate">
                {downwind.saida.nome}
                {downwind.chegada ? ` → ${downwind.chegada.nome}` : ''}
                {duracao ? ` · ${duracao}` : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onFechar}
            className="min-w-11 min-h-11 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors shrink-0"
            aria-label="Fechar resumo"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {carregando && (
          <div className="py-20 flex flex-col items-center gap-3 text-slate-400">
            <Loader2 size={28} className="animate-spin text-cyan-400" />
            <p className="text-xs font-bold">Carregando resumo...</p>
          </div>
        )}

        {!carregando && erro && (
          <div className="p-8 text-center space-y-2">
            <p role="alert" className="text-sm font-bold text-rose-300">
              {erro}
            </p>
          </div>
        )}

        {!carregando && !erro && downwind && (
          <>
            {/* Mini-mapa: só a trilha do participante SELECIONADO — as
                mesmas dezenas de trilhas cruzadas viram sopa visual aqui
                também, mesmo raciocínio do mapa ao vivo. */}
            <div className="h-48 shrink-0 border-b border-slate-800">
              {selecionado ? (
                <DownwindResumoMapa
                  saida={downwind.saida}
                  chegada={downwind.chegada}
                  trilha={selecionado.trilhaReduzida}
                  cor={corDoUsuario(selecionado.userId)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-600 text-xs">
                  Sem trilha registrada
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
              {participantes.length === 0 && (
                <p className="text-center text-xs text-slate-500 mt-4">
                  Nenhum participante com dados registrados.
                </p>
              )}
              {participantes.map((p) => {
                const ativo = p.userId === selecionadoId;
                const souEu = p.userId === meuUserId;
                return (
                  <button
                    key={p.userId}
                    type="button"
                    onClick={() => setSelecionadoId(p.userId)}
                    className={`w-full flex items-center gap-3 p-3 rounded-2xl border text-left transition-all active:scale-[0.99] ${
                      ativo
                        ? 'bg-cyan-950/40 border-cyan-500/50'
                        : 'bg-[#1E293B] border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div
                      className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center font-black text-xs text-slate-950 overflow-hidden"
                      style={{ background: corDoUsuario(p.userId) }}
                    >
                      {p.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.avatarUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        iniciaisDoNome(p.nome)
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white truncate flex items-center gap-1">
                        {p.nome}
                        {souEu && <span className="text-cyan-400">(você)</span>}
                        {p.ehOrganizador && <span title="Organizador">👑</span>}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {p.papel === 'velejador' ? 'Velejador' : 'Apoio em terra'}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-3 text-right">
                      <div className="flex items-center gap-1 text-slate-300">
                        <Route size={12} className="text-cyan-400" />
                        <span className="text-xs font-black tabular-nums">
                          {p.distanciaKm !== null ? `${p.distanciaKm.toFixed(1)} km` : '—'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-slate-300">
                        <Wind size={12} className="text-amber-400" />
                        <span className="text-xs font-black tabular-nums">
                          {p.velocidadeMaxNos !== null ? `${p.velocidadeMaxNos.toFixed(1)} nós` : '—'}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {downwind.saida && (
              <div className="shrink-0 px-4 py-2 border-t border-slate-800 flex items-center gap-1.5 text-[10px] text-slate-500 overlay-safe-bottom">
                <MapPin size={11} />
                <span>
                  {downwind.saida.nome}
                  {downwind.chegada ? ` → ${downwind.chegada.nome}` : ''}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
