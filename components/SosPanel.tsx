'use client';

import React, { useEffect, useState } from 'react';
import { Phone, X, MapPin, Clock, Users, AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';

/**
 * Painel que aparece DEPOIS do velejador disparar o SOS.
 *
 * REGRA 1: 193 (Bombeiros) e 185 (Marinha) ficam no TOPO, acima de qualquer
 * informação da comunidade. O velejador DEVE ligar — o app avisa quem está
 * perto, mas NÃO é serviço de resgate.
 *
 * REGRA 2: O painel se atualiza por polling de /api/sos/active para mostrar
 * quem está a caminho, sem depender de push (que pode não ter chegado).
 */

interface Responder {
  userId: string;
  name: string;
  state: 'notificado' | 'a_caminho' | 'no_local' | 'nao_posso';
  distanceKm: number | null;
}

interface ActiveSos {
  id: string;
  lat: number | null;
  lng: number | null;
  status: string;
  radiusKm: number;
  spotName: string | null;
  message: string | null;
  createdAt: string;
  responders: Responder[];
}

interface SosPanelProps {
  sos: ActiveSos;
  emergencyContactPhone: string | null;
  onClose: () => void;
  onCancel: () => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min`;
  return `${Math.floor(min / 60)}h${min % 60}min`;
}

function stateLabel(state: string): { text: string; color: string } {
  switch (state) {
    case 'a_caminho': return { text: 'A caminho', color: 'text-emerald-400' };
    case 'no_local': return { text: 'No local', color: 'text-cyan-400' };
    case 'nao_posso': return { text: 'Não pode', color: 'text-slate-500' };
    default: return { text: 'Notificado', color: 'text-amber-400' };
  }
}

export const SosPanel: React.FC<SosPanelProps> = ({
  sos,
  emergencyContactPhone,
  onClose,
  onCancel,
}) => {
  const [canceling, setCanceling] = useState(false);

  const aCaminho = sos.responders.filter(r => r.state === 'a_caminho' || r.state === 'no_local');
  const notificados = sos.responders.filter(r => r.state === 'notificado');

  const handleCancel = async () => {
    setCanceling(true);
    try {
      await fetch(`/api/sos/${sos.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelado', resolutionNote: 'Cancelado pelo autor' }),
      });
      onCancel();
    } catch {
      // Falha silenciosa — o velejador pode fechar e tentar de novo
    } finally {
      setCanceling(false);
    }
  };

  // WhatsApp com posição (se tiver contato de emergência e coordenada)
  const waLink = emergencyContactPhone && sos.lat
    ? `https://wa.me/${emergencyContactPhone.replace(/\D/g, '')}?text=${encodeURIComponent(
        `🆘 SOS KiteNinja — Preciso de ajuda!\n📍 Posição: https://maps.google.com/?q=${sos.lat},${sos.lng}\n${sos.spotName ? `🏖️ Perto de: ${sos.spotName}` : ''}`
      )}`
    : null;

  return (
    <div className="fixed inset-0 z-lightbox flex items-end justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Painel */}
      <div className="relative w-full max-w-lg bg-[#0B1220] rounded-t-3xl border-t border-rose-500/40 shadow-2xl max-h-[85vh] overflow-y-auto safe-area-pb">
        {/* Header com aviso obrigatório */}
        <div className="sticky top-0 bg-rose-950/95 backdrop-blur-lg p-4 rounded-t-3xl border-b border-rose-500/30">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-rose-500 animate-pulse" />
              <span className="text-rose-300 font-black text-sm">SOS ATIVO</span>
              <span className="text-slate-400 text-xs font-mono">{timeAgo(sos.createdAt)}</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-white/10 text-slate-400"
              aria-label="Minimizar"
            >
              <X size={18} />
            </button>
          </div>

          {/* ⚠️ AVISO OBRIGATÓRIO — o app NÃO substitui socorro oficial */}
          <div className="bg-amber-950/60 border border-amber-500/30 rounded-xl p-3 mb-3">
            <p className="text-xs text-amber-200 font-bold leading-relaxed">
              <AlertTriangle size={13} className="inline mr-1 -mt-0.5" />
              O app avisou velejadores próximos, mas <strong>não é serviço de resgate</strong>.
              Ligue para o Corpo de Bombeiros ou a Marinha.
            </p>
          </div>

          {/* 193 e 185 — EM DESTAQUE, acima de tudo da comunidade */}
          <div className="grid grid-cols-2 gap-2">
            <a
              href="tel:193"
              className="py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-lg flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg shadow-rose-600/30"
            >
              <Phone size={20} />
              193
              <span className="text-[10px] font-bold opacity-80">Bombeiros</span>
            </a>
            <a
              href="tel:185"
              className="py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black text-lg flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg shadow-amber-600/30"
            >
              <Phone size={20} />
              185
              <span className="text-[10px] font-bold opacity-80">Marinha</span>
            </a>
          </div>
        </div>

        {/* Corpo */}
        <div className="p-4 space-y-4">
          {/* Localização */}
          <div className="flex items-center gap-2 text-sm">
            <MapPin size={16} className="text-rose-400 shrink-0" />
            {sos.lat ? (
              <span className="text-slate-300">
                {sos.spotName ? `Perto de ${sos.spotName}` : `${sos.lat.toFixed(4)}, ${sos.lng?.toFixed(4)}`}
              </span>
            ) : (
              <span className="text-amber-400 font-bold">Posição não confirmada</span>
            )}
          </div>

          {/* Raio de busca */}
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Clock size={14} />
            <span>Raio de busca: {sos.radiusKm} km</span>
          </div>

          {/* Quem está a caminho */}
          <div>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Users size={13} />
              Ajuda ({aCaminho.length} a caminho, {notificados.length} notificados)
            </h3>
            {sos.responders.length === 0 ? (
              <p className="text-xs text-slate-500 italic">Buscando velejadores próximos...</p>
            ) : (
              <div className="space-y-1.5">
                {sos.responders
                  .filter(r => r.state !== 'nao_posso')
                  .map((r) => {
                    const { text, color } = stateLabel(r.state);
                    return (
                      <div key={r.userId} className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-slate-800/50">
                        <span className="text-sm text-slate-200 font-bold truncate">{r.name}</span>
                        <div className="flex items-center gap-2 text-xs shrink-0">
                          {r.distanceKm !== null && (
                            <span className="text-slate-400">{r.distanceKm.toFixed(1)} km</span>
                          )}
                          <span className={`font-black ${color}`}>{text}</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Compartilhar com contato de emergência */}
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              <ExternalLink size={15} />
              Avisar contato de emergência via WhatsApp
            </a>
          )}

          {/* Cancelar SOS */}
          <button
            type="button"
            onClick={handleCancel}
            disabled={canceling}
            className="w-full py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 font-bold text-sm flex items-center justify-center gap-2 transition-colors"
          >
            {canceling ? <Loader2 size={14} className="animate-spin" /> : null}
            {canceling ? 'Cancelando...' : 'Cancelar SOS (falso alarme)'}
          </button>
        </div>
      </div>
    </div>
  );
};
