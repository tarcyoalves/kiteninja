'use client';

import React, { useState, useEffect } from 'react';
import { Calendar, Check, Compass, Loader2, MapPin, Navigation, Users, X } from 'lucide-react';
import { Spot } from '@/types';
import { useDownwind } from '@/context/DownwindContext';
import { useAoMudar } from '../../lib/useAoMudar';

interface EntrarDownwindModalProps {
  token: string | null;
  isOpen: boolean;
  onClose: () => void;
  spots: Spot[];
  onEntrou?: (downwindId: string) => void;
}

interface ConviteDetalhes {
  id: string;
  downwindId: string;
  downwindNome: string;
  downwindStatus: string;
  spotSaidaId: string | null;
  spotChegadaId: string | null;
  previstoPara: string | null;
  iniciadoEm: string | null;
  inviterName: string;
  role: string;
  status: string;
  expiresAt: string;
  totalParticipantes: number;
}

export const EntrarDownwindModal: React.FC<EntrarDownwindModalProps> = ({
  token,
  isOpen,
  onClose,
  spots,
  onEntrou,
}) => {
  const { recarregar } = useDownwind();
  const [detalhes, setDetalhes] = useState<ConviteDetalhes | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Limpeza síncrona no render, fetch no efeito — ver lib/useAoMudar.ts.
  // A chave junta os dois: fechar o modal OU trocar de convite invalida tudo.
  const chave = isOpen && token ? token : null;
  useAoMudar(chave, () => {
    setDetalhes(null);
    setErro(null);
    setSucesso(false);
    setCarregando(chave !== null);
  });

  useEffect(() => {
    if (!isOpen || !token) return;

    let ativo = true;

    (async () => {
      try {
        const res = await fetch(`/api/downwind/invite/${token}`);
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(body?.error || 'Não foi possível carregar os dados do convite.');
        }
        if (!ativo) return;
        setDetalhes(body);
      } catch (err) {
        if (ativo) setErro(err instanceof Error ? err.message : 'Falha ao buscar convite.');
      } finally {
        if (ativo) setCarregando(false);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [isOpen, token]);

  const handleEntrar = async () => {
    if (!token) return;
    setEntrando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/downwind/invite/${token}`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error || 'Falha ao entrar no downwind.');
      }

      setSucesso(true);
      await recarregar();
      if (onEntrou && body.downwindId) {
        onEntrou(body.downwindId);
      }
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao aceitar convite.');
      setEntrando(false);
    }
  };

  if (!isOpen || !token) return null;

  const spotSaidaNome = spots.find((s) => s.id === detalhes?.spotSaidaId)?.name || 'Spot de saída';
  const spotChegadaNome = spots.find((s) => s.id === detalhes?.spotChegadaId)?.name;

  return (
    <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-xs p-3 animate-in fade-in duration-200">
      <div className="w-full max-w-sm bg-[#0F172A] border border-slate-800 rounded-3xl shadow-2xl p-5 space-y-4 overlay-safe-bottom">
        <div className="flex items-center justify-between pb-1 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <Compass size={20} />
            </div>
            <div>
              <h2 className="text-base font-black text-white">Convite de Downwind</h2>
              <p className="text-xs text-slate-400">Você foi convidado para velejar em grupo</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {carregando && (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-cyan-400">
            <Loader2 size={28} className="animate-spin" />
            <p className="text-xs font-bold text-slate-400">Consultando travessia...</p>
          </div>
        )}

        {!carregando && erro && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs rounded-xl space-y-2 text-center">
            <p className="font-bold">{erro}</p>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold"
            >
              Fechar
            </button>
          </div>
        )}

        {!carregando && !erro && detalhes && (
          <div className="space-y-3.5 text-xs">
            <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
              <h3 className="font-black text-sm text-white">{detalhes.downwindNome}</h3>
              <p className="text-slate-400 text-xs">
                Organizado por <span className="text-cyan-300 font-bold">{detalhes.inviterName}</span>
              </p>

              <div className="pt-2 border-t border-slate-800/80 space-y-1.5 text-[11px]">
                <div className="flex items-center gap-1.5 text-slate-300">
                  <MapPin size={13} className="text-emerald-400 shrink-0" />
                  <span>
                    <strong>Saída:</strong> {spotSaidaNome}
                  </span>
                </div>
                {spotChegadaNome && (
                  <div className="flex items-center gap-1.5 text-slate-300">
                    <MapPin size={13} className="text-cyan-400 shrink-0" />
                    <span>
                      <strong>Chegada:</strong> {spotChegadaNome}
                    </span>
                  </div>
                )}
                {detalhes.previstoPara && (
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <Calendar size={13} className="shrink-0 text-slate-500" />
                    <span>{new Date(detalhes.previstoPara).toLocaleString('pt-BR')}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Users size={13} className="shrink-0 text-slate-500" />
                  <span>
                    {detalhes.totalParticipantes} velejador{detalhes.totalParticipantes !== 1 ? 'es' : ''} no grupo
                  </span>
                </div>
              </div>
            </div>

            {sucesso ? (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-xl text-xs font-bold text-center flex items-center justify-center gap-2">
                <Check size={16} />
                <span>Entrou no Downwind com sucesso!</span>
              </div>
            ) : (
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={entrando}
                  className="flex-1 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-bold rounded-xl text-xs"
                >
                  Agora não
                </button>
                <button
                  type="button"
                  onClick={handleEntrar}
                  disabled={entrando}
                  className="flex-1 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-cyan-500/20 active:scale-98 transition-all"
                >
                  {entrando ? <Loader2 size={16} className="animate-spin" /> : <span>Entrar no Grupo</span>}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};