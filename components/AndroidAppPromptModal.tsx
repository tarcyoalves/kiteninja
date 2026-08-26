'use client';

import React, { useEffect, useState } from 'react';
import {
  Download,
  Smartphone,
  ShieldCheck,
  Radio,
  Sparkles,
  X,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useIsNativeApp } from '../lib/usePushNotifications';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const AndroidAppPromptModal: React.FC<{
  forcarAbertura?: boolean;
  onFechar?: () => void;
}> = ({ forcarAbertura = false, onFechar }) => {
  const { user } = useAuth();
  const ehAppNativo = useIsNativeApp();
  const [aberto, setAberto] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Captura evento de instalação PWA do Chrome/Edge
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (forcarAbertura) {
      setAberto(true);
      return;
    }

    // Só exibe automaticamente se for Android no navegador comum (não nativo, não standalone PWA)
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);

    if (!isAndroid || ehAppNativo || isStandalone || !user) {
      setAberto(false);
      return;
    }

    // Verifica se o usuário dispensou nas últimas 48 horas
    const dispensadoEm = localStorage.getItem('kiteninja_android_prompt_dismissed_at');
    if (dispensadoEm) {
      const tempoPassado = Date.now() - parseInt(dispensadoEm, 10);
      if (tempoPassado < 48 * 60 * 60 * 1000) {
        return;
      }
    }

    // Abre suavemente após 2.5 segundos do login
    const timer = setTimeout(() => {
      setAberto(true);
    }, 2500);

    return () => clearTimeout(timer);
  }, [user, ehAppNativo, forcarAbertura]);

  const fechar = () => {
    setAberto(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem('kiteninja_android_prompt_dismissed_at', Date.now().toString());
    }
    if (onFechar) onFechar();
  };

  const handleInstalarPWA = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        fechar();
      }
    } catch {
      // Ignora falhas de cancelamento
    }
  };

  const handleBaixarApk = () => {
    window.open('/api/download/android', '_blank');
    fechar();
  };

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-gradient-to-b from-[#0F172A] to-[#0B1220] border border-cyan-500/40 rounded-3xl p-5 shadow-2xl shadow-cyan-500/20 text-slate-200 relative animate-in slide-in-from-bottom-6 duration-300 ring-1 ring-cyan-400/20"
        role="dialog"
        aria-modal="true"
        aria-labelledby="android-prompt-title"
      >
        <button
          type="button"
          onClick={fechar}
          className="absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 transition-colors"
          aria-label="Fechar"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-slate-950 shadow-lg shadow-cyan-500/30 shrink-0">
            <Smartphone size={24} className="stroke-[2.2]" />
          </div>
          <div>
            <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[10px] font-bold uppercase tracking-wider">
              App Oficial Android
            </span>
            <h2 id="android-prompt-title" className="text-base font-black text-white leading-tight mt-0.5">
              Baixe o KiteNinja no Celular
            </h2>
          </div>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed mb-4">
          Você está acessando pelo navegador Android. Instale o app nativo para ter os recursos vitais de segurança:
        </p>

        <div className="space-y-2.5 mb-5 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-3.5 text-xs text-slate-300">
          <div className="flex items-start gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0 mt-0.5">
              <Radio size={14} />
            </div>
            <div>
              <strong className="text-white font-bold block">Rastreamento com Tela Apagada</strong>
              <span>Transmite seu GPS em segundo plano durante todo o downwind.</span>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-cyan-500/20 text-cyan-300 flex items-center justify-center shrink-0 mt-0.5">
              <ShieldCheck size={14} />
            </div>
            <div>
              <strong className="text-white font-bold block">Alertas Sonoros de Socorro</strong>
              <span>Receba alertas de SOS com som alto mesmo com o celular em silêncio.</span>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-blue-500/20 text-blue-300 flex items-center justify-center shrink-0 mt-0.5">
              <Sparkles size={14} />
            </div>
            <div>
              <strong className="text-white font-bold block">Fila Offline e Sem Barra</strong>
              <span>Experiência em tela cheia com armazenamento de dados sem internet.</span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {/* Opção 1: Download direto do APK */}
          <button
            type="button"
            onClick={handleBaixarApk}
            className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-slate-950 font-black text-xs sm:text-sm shadow-xl shadow-cyan-500/30 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            <Download size={18} className="stroke-[2.5]" />
            <span>Baixar Aplicativo Android (.APK)</span>
          </button>

          {/* Opção 2: PWA se disponível */}
          {deferredPrompt && (
            <button
              type="button"
              onClick={handleInstalarPWA}
              className="w-full py-2.5 px-4 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 font-bold text-xs active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <ExternalLink size={15} />
              <span>Instalar Atalho Rápido na Tela Inicial</span>
            </button>
          )}

          <button
            type="button"
            onClick={fechar}
            className="w-full py-2 text-center text-xs text-slate-400 hover:text-slate-300 transition-colors"
          >
            Continuar usando pelo navegador
          </button>
        </div>
      </div>
    </div>
  );
};