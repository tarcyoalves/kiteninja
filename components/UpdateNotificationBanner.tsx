'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  applyAppUpdate,
  clearAppUpdateAvailable,
  detectarNovoCommit,
  dismissAppUpdate,
  markAppUpdateAvailable,
  useAppUpdateAvailable,
  useAppUpdateCommit,
} from '../lib/appUpdate';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { useDownwind } from '../context/DownwindContext';

interface VersionInfo {
  commit: string;
}

export const UpdateNotificationBanner: React.FC = () => {
  const { downwindAtivo } = useDownwind();
  const temAtualizacao = useAppUpdateAvailable();
  const commitDisponivel = useAppUpdateCommit();
  const [atualizando, setAtualizando] = useState(false);
  const commitDoBundle = process.env.NEXT_PUBLIC_BUILD_COMMIT;

  const checarVersao = useCallback(async () => {
    try {
      const res = await fetch(`/api/version?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
      if (!res.ok) return;

      const data = (await res.json()) as VersionInfo;
      const novoCommit = detectarNovoCommit(commitDoBundle, data.commit);
      if (novoCommit) {
        markAppUpdateAvailable(novoCommit);
      } else {
        // Remove inclusive um alerta falso deixado por um update do Service
        // Worker quando o código aberto já é o mesmo que está em produção.
        clearAppUpdateAvailable();
      }
    } catch {
      // Falha temporária de rede não significa que existe atualização.
    }
  }, [commitDoBundle]);

  const aplicarAtualizacao = useCallback(async () => {
    setAtualizando(true);
    await applyAppUpdate();
  }, []);

  useEffect(() => {
    // O SW cuida apenas de push. `updatefound` não identifica versão do app e
    // não pode acender o banner: o arquivo pode reinstalar sem mudança de código.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
    }

    const timeoutInicial = window.setTimeout(checarVersao, 3000);
    const intervalo = window.setInterval(() => {
      if (!document.hidden) checarVersao();
    }, 60000);

    const onAppVisivel = () => {
      if (!document.hidden) checarVersao();
    };

    document.addEventListener('visibilitychange', onAppVisivel);
    window.addEventListener('focus', onAppVisivel);

    return () => {
      window.clearTimeout(timeoutInicial);
      window.clearInterval(intervalo);
      document.removeEventListener('visibilitychange', onAppVisivel);
      window.removeEventListener('focus', onAppVisivel);
    };
  }, [checarVersao]);

  // Nunca interrompe o velejador durante um downwind ativo.
  if (!temAtualizacao || downwindAtivo) return null;

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
            onClick={() => dismissAppUpdate(commitDisponivel)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 active:scale-95 transition-all"
            aria-label="Dispensar aviso desta versão"
            title="Lembrar apenas na próxima versão"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
