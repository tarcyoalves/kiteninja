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
        headers: {
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
      if (!res.ok) return;
      const data = (await res.json()) as VersionInfo;

      if (!versaoInicialRef.current) {
        versaoInicialRef.current = data;
        return;
      }

      // Se o commit ou buildTime mudou, há uma nova versão em produção
      const commitMudou =
        data.commit !== 'local' &&
        versaoInicialRef.current.commit !== 'local' &&
        data.commit !== versaoInicialRef.current.commit;

      const buildMudou =
        Boolean(data.buildTime) &&
        Boolean(versaoInicialRef.current.buildTime) &&
        data.buildTime !== versaoInicialRef.current.buildTime;

      if (commitMudou || buildMudou) {
        setTemAtualizacao(true);
      }
    } catch {
      // Falha temporária de rede, tenta novamente no próximo ciclo
    }
  }, []);

  const aplicarAtualizacao = useCallback(async () => {
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
      // Ignora falhas de cache e força o reload limpo
    }

    // Recarrega a página trazendo o bundle mais novo
    window.location.reload();
  }, []);

  useEffect(() => {
    // 1. Registra o Service Worker automaticamente com updateViaCache: 'none'
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then((reg) => {
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
        })
        .catch(() => {});

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Se um novo SW tomou controle, recarrega
        if (!downwindAtivo) {
          window.location.reload();
        }
      });
    }

    // 2. Primeira checagem rápida após inicialização
    const timeoutInicial = setTimeout(checarVersao, 3000);

    // 3. Checa periodicamente a cada 60 segundos
    const intervalo = setInterval(() => {
      if (!document.hidden) {
        checarVersao();
      }
    }, 60000);

    // 4. Checa sempre que o usuário desbloqueia o celular ou volta para o app
    const onVisibilityChange = () => {
      if (!document.hidden) {
        checarVersao();
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then((reg) => reg.update().catch(() => {}));
        }
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityChange);

    return () => {
      clearTimeout(timeoutInicial);
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onVisibilityChange);
    };
  }, [checarVersao, downwindAtivo]);

  // Nunca interrompe o velejador durante um downwind ativo
  if (!temAtualizacao || dispensado || downwindAtivo) return null;

  return (
    <div className="fixed top-2.5 inset-x-3 z-splash flex justify-center pointer-events-none animate-in slide-in-from-top-4 duration-300">
      <div className="pointer-events-auto max-w-md w-full bg-[#0B1220]/95 border border-cyan-400/50 rounded-2xl p-3 shadow-[0_10px_30px_rgba(34,211,238,0.25)] backdrop-blur-xl flex items-center justify-between gap-3 text-slate-100 ring-1 ring-cyan-500/20">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-cyan-400/20 text-cyan-300 flex items-center justify-center shrink-0 border border-cyan-400/40 animate-pulse">
            <Sparkles size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black text-white leading-tight flex items-center gap-1.5">
              <span>Nova versão disponível!</span>
            </p>
            <p className="text-[10px] text-cyan-200/80 truncate">
              Toque para carregar as últimas melhorias
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={aplicarAtualizacao}
            disabled={atualizando}
            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-slate-950 font-black text-xs shadow-md shadow-cyan-500/30 active:scale-95 transition-all flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={atualizando ? 'animate-spin' : ''} />
            <span>{atualizando ? 'Atualizando…' : 'Atualizar'}</span>
          </button>
          <button
            type="button"
            onClick={() => setDispensado(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 active:scale-95 transition-all"
            aria-label="Dispensar aviso de atualização"
            title="Lembrar mais tarde"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};