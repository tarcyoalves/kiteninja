'use client';

import React, { useEffect, useState } from 'react';
import { MapPin, Navigation, Phone, X, AlertTriangle } from 'lucide-react';

/**
 * Alerta SOS recebido — modal que INTERROMPE.
 *
 * Diferente do InAppPushToast (discreto, para chat), este é vida.
 * Som + vibração + tela cheia + z-lightbox (acima de tudo).
 *
 * Se não houver coordenada, diz "posição não confirmada" e NÃO desenha pino.
 */

interface IncomingSos {
  id: string;
  authorName: string;
  distanceKm: number | null;
  spotName: string | null;
  accuracyM: number | null;
  lat: number | null;
  lng: number | null;
  message: string | null;
  createdAt: string;
  temCoordenada: boolean;
}

interface SosIncomingAlertProps {
  sos: IncomingSos | null;
  onRespond: (sosId: string, state: 'a_caminho' | 'nao_posso') => void;
  onViewMap: () => void;
  onDismiss: () => void;
}

function tempoDecorrido(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seg = Math.floor(diff / 1000);
  if (seg < 60) return `${seg}s`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `${min}min`;
  return `${Math.floor(min / 60)}h`;
}

export const SosIncomingAlert: React.FC<SosIncomingAlertProps> = ({
  sos,
  onRespond,
  onViewMap,
  onDismiss,
}) => {
  const [responding, setResponding] = useState(false);

  // Vibração de urgência ao aparecer
  useEffect(() => {
    if (!sos) return;
    try {
      navigator.vibrate?.([500, 200, 500, 200, 500]);
    } catch { /* ignora */ }
  }, [sos]);

  if (!sos) return null;

  const handleRespond = async (state: 'a_caminho' | 'nao_posso') => {
    setResponding(true);
    try {
      onRespond(sos.id, state);
    } finally {
      setResponding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-lightbox flex items-center justify-center p-4">
      {/* Backdrop vermelho pulsante — urgência visual */}
      <div className="absolute inset-0 bg-rose-950/90 backdrop-blur-md animate-pulse" style={{ animationDuration: '2s' }} />

      {/* Modal central */}
      <div className="relative w-full max-w-sm bg-[#0B1220] rounded-3xl border-2 border-rose-500/60 shadow-2xl shadow-rose-500/20 overflow-hidden">
        {/* Header vermelho */}
        <div className="bg-gradient-to-b from-rose-700 to-rose-900 p-5 text-center relative">
          <button
            type="button"
            onClick={onDismiss}
            className="absolute top-3 right-3 p-1.5 rounded-full bg-black/20 text-white/60 hover:text-white"
            aria-label="Fechar alerta"
          >
            <X size={16} />
          </button>

          <div className="text-4xl mb-2">🆘</div>
          <h2 className="text-white font-black text-xl mb-1">
            SOS — {sos.authorName}
          </h2>
          <p className="text-rose-200 text-xs font-bold">
            Há {tempoDecorrido(sos.createdAt)}
          </p>
        </div>

        {/* Informações */}
        <div className="p-4 space-y-3">
          {/* Localização */}
          <div className="flex items-start gap-2.5 py-2 px-3 rounded-xl bg-slate-800/60">
            <MapPin size={18} className="text-rose-400 shrink-0 mt-0.5" />
            <div>
              {sos.temCoordenada ? (
                <>
                  {sos.spotName && (
                    <p className="text-sm font-bold text-white">{sos.spotName}</p>
                  )}
                  {sos.distanceKm !== null && (
                    <p className="text-xs text-slate-300">
                      A {sos.distanceKm.toFixed(1)} km de você
                    </p>
                  )}
                  {sos.accuracyM !== null && sos.accuracyM > 100 && (
                    <p className="text-[10px] text-amber-400">
                      Precisão: ~{sos.accuracyM > 1000
                        ? `${(sos.accuracyM / 1000).toFixed(1)} km`
                        : `${Math.round(sos.accuracyM)} m`}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-amber-400">
                    Posição não confirmada
                  </p>
                  {sos.spotName && (
                    <p className="text-xs text-slate-400">
                      Último spot conhecido: {sos.spotName}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Mensagem do pedinte */}
          {sos.message && (
            <div className="py-2 px-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
              <p className="text-xs text-slate-300 italic">"{sos.message}"</p>
            </div>
          )}

          {/* Aviso de socorro oficial */}
          <div className="flex items-start gap-2 py-2 px-3 rounded-xl bg-amber-950/40 border border-amber-500/20">
            <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-200 leading-relaxed">
              Se possível, ligue <strong>193</strong> ou <strong>185</strong> também.
              O app avisa quem está perto mas não garante socorro.
            </p>
          </div>

          {/* Ações */}
          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={() => handleRespond('a_caminho')}
              disabled={responding}
              className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-base flex items-center justify-center gap-2.5 active:scale-95 transition-all shadow-lg shadow-emerald-600/30"
            >
              <Navigation size={20} />
              Estou indo!
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  handleRespond('nao_posso');
                  onDismiss();
                }}
                disabled={responding}
                className="py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-bold text-sm flex items-center justify-center gap-1.5 active:scale-95 transition-all"
              >
                Não posso
              </button>

              {sos.temCoordenada && (
                <button
                  type="button"
                  onClick={() => {
                    onViewMap();
                    onDismiss();
                  }}
                  className="py-2.5 rounded-xl bg-cyan-600/20 border border-cyan-500/30 text-cyan-300 font-bold text-sm flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                >
                  <MapPin size={14} />
                  Ver no mapa
                </button>
              )}
            </div>

            {/* Números de emergência — sempre visíveis */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <a
                href="tel:193"
                className="py-2 rounded-xl bg-rose-900/40 border border-rose-500/30 text-rose-300 font-black text-sm flex items-center justify-center gap-1.5"
              >
                <Phone size={13} />
                193
              </a>
              <a
                href="tel:185"
                className="py-2 rounded-xl bg-amber-900/40 border border-amber-500/30 text-amber-300 font-black text-sm flex items-center justify-center gap-1.5"
              >
                <Phone size={13} />
                185
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
