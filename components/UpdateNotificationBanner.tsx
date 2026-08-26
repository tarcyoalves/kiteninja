'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { useDownwind } from '../context/DownwindContext';

interface VersionInfo {
  version: string;
  commit: string;
  buildTime: string;
  timestamp: number;
}

export const UpdateNotificationBanner: React.FC = () => {
  const { downwindAtivo } = useDownwind();
  const [temAtualizacao, setTemAtualizacao] = useState(false);
  const [dispensado, setDispensado] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const versaoInicialRef = useRef<VersionInfo | null>(null);

  const checarVersao = useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      const res = await fetch(`/api/version?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) return;
      const data = (await res.json()) as VersionInfo;

      if (!versaoInicialRef.current) {
        versaoInicialRef.current = data;
        return;
      }

      // Se o commit ou buildTime mudou, há uma nova versão disponível
      const commitMudou =
        data.commit !== 'local' &&
        versaoInicialRef.current.commit !== 'local' &&
        data.commit !== versaoInicialRef.current.commit;

      const buildMudou =
        data.buildTime &&
        versaoInicialRef.current.buildTime &&
        data.buildTime !== versaoInicialRef.current.buildTime;

      if (commitMudou || buildMudou) {
        setTemAtualizacao(true);
      }
    } catch {
      // Ignora falhas momentâneas de rede
    }
  }, []);

  useEffect(() => {
    checarVersao();

    // Checa a cada 2 minutos quando a tela está visível
    const intervalo = setInterval(() => {
      if (!document.hidden) {
        checarVersao();
      }
    }, 120000);

    // Checa sempre que o usuário reabre o app/aba
    const onVisibilityChange = () => {
      if (!document.hidden) {
        checarVersao();
        // Dispara verificação no Service Worker também
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then((reg) => reg.update().catch(() => {}));
        }
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityChange);

    // Ouve evento de novo Service Worker esperando ativação
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                setTemAtualizacao(true);
              }
            });
          }
        });
      });
    }

    return () => {
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onVisibilityChange);
    };
  }, [checarVersao]);

  const aplicarAtualizacao = async () => {
    setAtualizando(true);
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
          await reg.update().catch(() => {});
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      // Continua para o reload mesmo se o cache falhar
    }

    // Recarrega a página limpa com a versão mais recente
    window.location.reload();
  };

  // Não interrompe travessia ativa de downwind
  if (!temAtualizacao || dispensado || downwindAtivo) return null;

  return (
    <div className="fixed top-3 inset-x-3 z-splash flex justify-center pointer-events-none animate-in slide-in-from-top-4 duration-300">
      <div className="pointer-events-auto max-w-md w-full bg-[#0B1220]/95 border border-cyan-500/40 rounded-2xl p-3 shadow-2xl shadow-cyan-500/20 backdrop-blur-xl flex items-center justify-between gap-3 text-slate-200">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center shrink-0 border border-cyan-400/30">
            <Sparkles size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-white leading-tight">Nova versão do KiteNinja</p>
            <p className="text-[10px] text-slate-400 truncate">Melhorias e novidades prontas</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={aplicarAtualizacao}
            disabled={atualizando}
            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs shadow-md shadow-cyan-500/30 active:scale-95 transition-all flex items-center gap-1"
          >
            <RefreshCw size={12} className={atualizando ? 'animate-spin' : ''} />
            <span>{atualizando ? 'Atualizando…' : 'Atualizar'}</span>
          </button>
          <button
            type="button"
            onClick={() => setDispensado(true)}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 active:scale-95 transition-all"
            aria-label="Dispensar aviso de atualização"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};