'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Check, Copy, Loader2, Search, Share2, UserCheck, UserPlus, Users, X } from 'lucide-react';
import { formatRelativeTime } from '@/lib/chat';

interface RiderResult {
  id: string;
  name: string;
  avatarUrl?: string;
  riderId?: string;
}

interface ConvidarVelejadoresSheetProps {
  isOpen: boolean;
  onClose: () => void;
  downwindId: string;
  downwindNome: string;
}

export const ConvidarVelejadoresSheet: React.FC<ConvidarVelejadoresSheetProps> = ({
  isOpen,
  onClose,
  downwindId,
  downwindNome,
}) => {
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<RiderResult[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [convidandoId, setConvidandoId] = useState<string | null>(null);
  const [convidados, setConvidados] = useState<Set<string>>(new Set());
  const [linkConvite, setLinkConvite] = useState<string | null>(null);
  const [gerandoLink, setGerandoLink] = useState(false);
  const [linkCopiado, setLinkCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!busca.trim()) {
      setResultados([]);
      setBuscando(false);
      return;
    }

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(async () => {
      setBuscando(true);
      setErro(null);
      try {
        const res = await fetch(`/api/riders/search?q=${encodeURIComponent(busca.trim())}`);
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error || 'Falha ao buscar velejadores.');
        setResultados(body?.riders || []);
      } catch (err) {
        setErro(err instanceof Error ? err.message : 'Falha na busca.');
      } finally {
        setBuscando(false);
      }
    }, 300);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [busca]);

  const handleConvidarUsuario = async (rider: RiderResult) => {
    setConvidandoId(rider.id);
    setErro(null);
    try {
      const res = await fetch(`/api/downwind/${downwindId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inviteeUserId: rider.id,
          role: 'velejador',
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Não foi possível convidar.');

      setConvidados((prev) => new Set([...prev, rider.id]));
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao enviar convite.');
    } finally {
      setConvidandoId(null);
    }
  };

  const handleGerarLink = async () => {
    setGerandoLink(true);
    setErro(null);
    setLinkCopiado(false);
    try {
      const res = await fetch(`/api/downwind/${downwindId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createLink: true, role: 'velejador' }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Não foi possível gerar o link.');

      const url = `${window.location.origin}/?dw_invite=${body.token}`;
      setLinkConvite(url);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao gerar link.');
    } finally {
      setGerandoLink(false);
    }
  };

  const handleCopiarLink = () => {
    if (!linkConvite) return;
    navigator.clipboard?.writeText(linkConvite).then(
      () => {
        setLinkCopiado(true);
        setTimeout(() => setLinkCopiado(false), 2000);
      },
      () => {}
    );
  };

  const handleCompartilhar = async () => {
    if (!linkConvite) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Convite para Downwind - ${downwindNome}`,
          text: `Bora velejar juntos? Entre no grupo de downwind no KiteNinja:`,
          url: linkConvite,
        });
      } catch {
        // usuário cancelou o share sheet
      }
    } else {
      handleCopiarLink();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-xs p-3 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-[#0F172A] border border-slate-800 rounded-3xl shadow-2xl p-5 space-y-4 overlay-safe-bottom">
        <div className="flex items-center justify-between pb-1 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <UserPlus size={20} />
            </div>
            <div>
              <h2 className="text-base font-black text-white">Convidar Velejadores</h2>
              <p className="text-xs text-slate-400 truncate max-w-[220px]">{downwindNome}</p>
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

        {/* 1. Busca de Velejador */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-300">Buscar por nome ou ID</label>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Digite o nome do velejador..."
              className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
            {buscando && (
              <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-400 animate-spin" />
            )}
          </div>

          {resultados.length > 0 && (
            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
              {resultados.map((r) => {
                const jaConvidado = convidados.has(r.id);
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between p-2 rounded-xl bg-slate-900/60 border border-slate-800/80"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 overflow-hidden shrink-0 flex items-center justify-center text-xs font-bold text-slate-300">
                        {r.avatarUrl ? (
                          <img src={r.avatarUrl} alt={r.name} className="w-full h-full object-cover" />
                        ) : (
                          r.name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">{r.name}</p>
                        {r.riderId && <p className="text-[10px] text-slate-400 font-mono">@{r.riderId}</p>}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleConvidarUsuario(r)}
                      disabled={jaConvidado || convidandoId === r.id}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        jaConvidado
                          ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                          : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 active:scale-95'
                      }`}
                    >
                      {convidandoId === r.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : jaConvidado ? (
                        <>
                          <UserCheck size={13} />
                          <span>Convidado</span>
                        </>
                      ) : (
                        <span>Convidar</span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {busca.trim() && !buscando && resultados.length === 0 && (
            <p className="text-center py-3 text-slate-500 text-xs">Nenhum velejador encontrado.</p>
          )}
        </div>

        {/* 2. Divisor */}
        <div className="relative flex items-center justify-center">
          <hr className="w-full border-slate-800" />
          <span className="absolute px-2 bg-[#0F172A] text-[10px] text-slate-500 font-bold uppercase">ou</span>
        </div>

        {/* 3. Compartilhar por Link */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-300">Convite por link</label>

          {!linkConvite ? (
            <button
              type="button"
              onClick={handleGerarLink}
              disabled={gerandoLink}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-cyan-300 text-xs font-bold rounded-xl flex items-center justify-center gap-2 active:scale-98 transition-all"
            >
              {gerandoLink ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
              <span>Gerar link de convite</span>
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={linkConvite}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-w-0 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-[11px] font-mono text-slate-300 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopiarLink}
                  className="p-2.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-xl active:scale-95 transition-all"
                  title="Copiar link"
                >
                  {linkCopiado ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                </button>
                <button
                  type="button"
                  onClick={handleCompartilhar}
                  className="p-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl active:scale-95 transition-all"
                  title="Compartilhar"
                >
                  <Share2 size={16} />
                </button>
              </div>
              <p className="text-[10px] text-slate-500">
                Qualquer velejador com o link pode entrar diretamente no grupo.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};