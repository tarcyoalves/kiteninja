'use client';

import React, { useState } from 'react';
import { Calendar, Globe, Loader2, Lock, MapPin, Users, X } from 'lucide-react';
import { Spot } from '@/types';
import { useAuth } from '@/context/AuthContext';

interface CriarDownwindModalProps {
  isOpen: boolean;
  onClose: () => void;
  spots: Spot[];
  defaultSpotId?: string;
  onCriarDownwind: (dados: {
    nome: string;
    spotSaida: string;
    spotChegada?: string;
    previstoPara?: string;
    visibilidade: 'privado' | 'comunidade';
  }) => Promise<{ ok: boolean; downwindId?: string; error?: string }>;
}

export const CriarDownwindModal: React.FC<CriarDownwindModalProps> = ({
  isOpen,
  onClose,
  spots,
  defaultSpotId,
  onCriarDownwind,
}) => {
  const { canOrganizeDownwind } = useAuth();
  const podeOrganizarComunidade = canOrganizeDownwind;

  const [nome, setNome] = useState('');
  const [spotSaida, setSpotSaida] = useState(defaultSpotId || spots[0]?.id || '');
  const [spotChegada, setSpotChegada] = useState('');
  const [visibilidade, setVisibilidade] = useState<'privado' | 'comunidade'>('privado');
  const [previstoPara, setPrevistoPara] = useState('');
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      setErro('Informe o nome da travessia.');
      return;
    }
    if (!spotSaida) {
      setErro('Selecione o spot de saída.');
      return;
    }

    setCriando(true);
    setErro(null);

    const res = await onCriarDownwind({
      nome: nome.trim(),
      spotSaida,
      spotChegada: spotChegada || undefined,
      previstoPara: previstoPara ? new Date(previstoPara).toISOString() : undefined,
      visibilidade,
    });

    setCriando(false);
    if (!res.ok) {
      setErro(res.error || 'Falha ao criar downwind.');
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-xs p-3 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-[#0F172A] border border-slate-800 rounded-3xl shadow-2xl p-5 space-y-4 overlay-safe-bottom">
        <div className="flex items-center justify-between pb-1 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <Users size={20} />
            </div>
            <div>
              <h2 className="text-base font-black text-white">Criar Downwind</h2>
              <p className="text-xs text-slate-400">Monte um grupo de navegação com mapa ao vivo</p>
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

        {erro && (
          <p className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs rounded-xl">{erro}</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-bold text-slate-300 mb-1">Nome do Downwind</label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Cumbuco até Taíba"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block font-bold text-slate-300 mb-1 flex items-center gap-1">
                <MapPin size={13} className="text-emerald-400" />
                Saída (obrigatório)
              </label>
              <select
                value={spotSaida}
                onChange={(e) => setSpotSaida(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-cyan-500"
              >
                {spots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1 flex items-center gap-1">
                <MapPin size={13} className="text-cyan-400" />
                Chegada (opcional)
              </label>
              <select
                value={spotChegada}
                onChange={(e) => setSpotChegada(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="">(Definir depois)</option>
                {spots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-300 mb-1 flex items-center gap-1">
              <Calendar size={13} className="text-cyan-400" />
              Horário previsto (opcional)
            </label>
            <input
              type="datetime-local"
              value={previstoPara}
              onChange={(e) => setPrevistoPara(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-300 mb-1">Visibilidade</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setVisibilidade('privado')}
                className={`p-2.5 rounded-xl border text-left flex items-start gap-2 transition-all ${
                  visibilidade === 'privado'
                    ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <Lock size={15} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-xs text-white">Privado</p>
                  <p className="text-[10px] opacity-80">Apenas quem receber convite</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (podeOrganizarComunidade) setVisibilidade('comunidade');
                  else setErro('Apenas moderadores e instrutores podem criar downwinds públicos da comunidade.');
                }}
                disabled={!podeOrganizarComunidade}
                className={`p-2.5 rounded-xl border text-left flex items-start gap-2 transition-all ${
                  !podeOrganizarComunidade ? 'opacity-40 cursor-not-allowed' : ''
                } ${
                  visibilidade === 'comunidade'
                    ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <Globe size={15} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-xs text-white">Comunidade</p>
                  <p className="text-[10px] opacity-80">Visível em Eventos</p>
                </div>
              </button>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={criando}
              className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 active:scale-98 transition-all"
            >
              {criando ? <Loader2 size={16} className="animate-spin" /> : <span>Criar Downwind</span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
