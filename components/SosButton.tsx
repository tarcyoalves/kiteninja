'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Loader2, Phone } from 'lucide-react';

/**
 * Botão SOS — o gatilho de socorro do velejador.
 *
 * REGRA FUNDAMENTAL: este botão será apertado por alguém dentro da água,
 * possivelmente se afogando. Nada pode bloquear o disparo.
 *
 * Press-and-hold de 800ms com anel de progresso previne toque acidental
 * (bolso, mochila, respingo), mas NÃO adiciona confirmação de dois passos
 * que poderia custar segundos em emergência real.
 *
 * Se a geolocalização demorar, o SOS sai sem coordenada.
 * Se a rede falhar, mostramos 193/185 para discagem direta.
 */

const HOLD_DURATION_MS = 800;
const GEO_TIMEOUT_MS = 3000;

interface SosButtonProps {
  onSosTriggered: (data: {
    lat: number | null;
    lng: number | null;
    accuracyM: number | null;
  }) => void;
  /** Se já há um SOS ativo do próprio usuário, mostra o painel em vez do botão */
  hasActiveSos: boolean;
}

export const SosButton: React.FC<SosButtonProps> = ({
  onSosTriggered,
  hasActiveSos,
}) => {
  const [holdProgress, setHoldProgress] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStart = useRef<number>(0);
  const triggered = useRef(false);

  // Limpa timers ao desmontar — evita setState em componente desmontado
  useEffect(() => {
    return () => {
      if (holdTimer.current) clearInterval(holdTimer.current);
    };
  }, []);

  const startHold = useCallback(() => {
    if (sending || hasActiveSos) return;
    triggered.current = false;
    holdStart.current = Date.now();
    setHoldProgress(0);
    setError(null);

    holdTimer.current = setInterval(() => {
      const elapsed = Date.now() - holdStart.current;
      const progress = Math.min(elapsed / HOLD_DURATION_MS, 1);
      setHoldProgress(progress);

      if (progress >= 1 && !triggered.current) {
        triggered.current = true;
        if (holdTimer.current) clearInterval(holdTimer.current);

        // Vibração de confirmação: o velejador sente que disparou
        try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignora */ }

        dispatchSos();
      }
    }, 16); // ~60fps para o anel de progresso ser fluido
  }, [sending, hasActiveSos]);

  const cancelHold = useCallback(() => {
    if (holdTimer.current) {
      clearInterval(holdTimer.current);
      holdTimer.current = null;
    }
    if (!triggered.current) {
      setHoldProgress(0);
    }
  }, []);

  const dispatchSos = useCallback(async () => {
    setSending(true);

    // Tenta obter geolocalização com prazo curto — se não conseguir,
    // o SOS sai sem coordenada. Melhor um SOS sem posição que nenhum SOS.
    let lat: number | null = null;
    let lng: number | null = null;
    let accuracyM: number | null = null;

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('sem GPS'));
          return;
        }
        const timeoutId = setTimeout(() => reject(new Error('timeout')), GEO_TIMEOUT_MS);
        navigator.geolocation.getCurrentPosition(
          (p) => { clearTimeout(timeoutId); resolve(p); },
          (e) => { clearTimeout(timeoutId); reject(e); },
          { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 60000 }
        );
      });
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
      accuracyM = pos.coords.accuracy;
    } catch {
      // Sem GPS é ok — o SOS sai de todo jeito
    }

    try {
      const res = await fetch('/api/sos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat,
          lng,
          accuracyM,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Falha ao enviar SOS');
        return;
      }

      onSosTriggered({ lat, lng, accuracyM });
    } catch {
      // Rede falhou — mostra números de emergência
      setError('Não conseguimos avisar a comunidade. Ligue 193 (Bombeiros) ou 185 (Marinha).');
    } finally {
      setSending(false);
      setHoldProgress(0);
    }
  }, [onSosTriggered]);

  // Se já tem SOS ativo, não mostra o botão (o painel fica no lugar)
  if (hasActiveSos) return null;

  // Raio e circumferência do anel de progresso SVG
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - holdProgress);

  return (
    <>
      {/* Botão SOS — fixado acima do menu inferior flutuante */}
      <div className="fixed right-3 z-chrome flex flex-col items-center gap-1.5 safe-area-pb" style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}>
        <button
          type="button"
          onPointerDown={startHold}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          onPointerCancel={cancelHold}
          disabled={sending}
          className={`relative w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-95 ${
            sending
              ? 'bg-rose-800 cursor-wait'
              : holdProgress > 0
              ? 'bg-rose-600 scale-110'
              : 'bg-rose-600 hover:bg-rose-500'
          } border-2 border-rose-400/60`}
          aria-label="SOS — segure para pedir socorro"
        >
          {/* Anel de progresso SVG */}
          {holdProgress > 0 && holdProgress < 1 && (
            <svg
              className="absolute inset-0 w-full h-full -rotate-90"
              viewBox="0 0 56 56"
            >
              <circle
                cx="28"
                cy="28"
                r={radius}
                fill="none"
                stroke="rgba(255,255,255,0.3)"
                strokeWidth="3"
              />
              <circle
                cx="28"
                cy="28"
                r={radius}
                fill="none"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                className="transition-none"
              />
            </svg>
          )}

          {sending ? (
            <Loader2 size={22} className="text-white animate-spin" />
          ) : (
            <span className="text-white font-black text-xs tracking-wider select-none">
              SOS
            </span>
          )}
        </button>

        {/* Instrução sutil */}
        {!sending && holdProgress === 0 && (
          <span className="text-[9px] text-slate-400 font-bold text-center leading-tight">
            Segure
          </span>
        )}
      </div>

      {/* Erro com números de emergência */}
      {error && (
        <div className="fixed bottom-24 inset-x-0 mx-auto max-w-sm w-[92%] z-modal animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="p-4 rounded-2xl bg-rose-950/95 border border-rose-500/50 backdrop-blur-xl shadow-2xl">
            <p className="text-sm text-rose-200 font-bold mb-3">{error}</p>
            <div className="flex gap-2">
              <a
                href="tel:193"
                className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform"
              >
                <Phone size={16} />
                193
              </a>
              <a
                href="tel:185"
                className="flex-1 py-2.5 rounded-xl bg-amber-600 text-white font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform"
              >
                <Phone size={16} />
                185
              </a>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="mt-2 w-full text-xs text-slate-400 py-1"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
};
