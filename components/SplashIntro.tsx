'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  parseIntroVideo,
  parseIntroVideoConfig,
  escolherVideoParaExibicao,
  type IntroVideo,
  type IntroVideoConfig,
} from '../lib/introVideo';

/**
 * Abertura exibida a quem chega sem sessão, antes da tela de login.
 *
 * Duas formas: o vídeo que o admin sobe no painel, ou a animação vetorial de
 * ~3,5s como reserva. A animação continua sendo o padrão porque não custa
 * download antes do primeiro pixel útil — importa no 4G fraco da praia, onde o
 * velejador está. Quando há vídeo configurado, ele ganha; se falhar em tocar,
 * cai na animação em vez de deixar tela preta.
 *
 * Três regras de respeito ao usuário, válidas nas duas formas:
 * 1. `prefers-reduced-motion` pula a abertura — movimento pode causar náusea
 *    e enjoo em quem tem sensibilidade vestibular.
 * 2. Botão "Pular" sempre visível: ninguém deve ser obrigado a esperar.
 * 3. Só aparece uma vez por sessão do navegador (sessionStorage), então
 *    recarregar a página não repete a espera.
 */

const DURATION_MS = 3500;
const STORAGE_KEY = 'kiteninja:intro-visto';

export const SplashAnimado: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [leaving, setLeaving] = useState(false);
  // onDone pode mudar de identidade entre renders; a ref evita reiniciar o timer.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const reduzMovimento =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduzMovimento) {
      doneRef.current();
      return;
    }

    // Fade de saída antes de desmontar, para não haver corte seco.
    const saida = setTimeout(() => setLeaving(true), DURATION_MS - 400);
    const fim = setTimeout(() => doneRef.current(), DURATION_MS);
    return () => {
      clearTimeout(saida);
      clearTimeout(fim);
    };
  }, []);

  function pular() {
    try {
      sessionStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Modo privado pode bloquear storage; pular ainda deve funcionar.
    }
    onDone();
  }

  return (
    <div
      className={`fixed inset-0 z-splash flex flex-col items-center justify-center bg-[#0B1220] transition-opacity duration-400 ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
      role="status"
      aria-label="Abertura do KiteNinja"
    >
      <svg
        viewBox="0 0 320 320"
        className="w-64 h-64 sm:w-72 sm:h-72"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="mar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0e7490" />
            <stop offset="100%" stopColor="#0B1220" />
          </linearGradient>
          <linearGradient id="linha" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0" />
            <stop offset="50%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Horizonte que sobe: o mar aparecendo */}
        <rect x="0" y="200" width="320" height="120" fill="url(#mar)" opacity="0.5">
          <animate attributeName="y" from="320" to="200" dur="1.1s" fill="freeze" />
        </rect>

        {/* Três rajadas de vento cruzando a tela, escalonadas */}
        {[
          { y: 96, w: 150, delay: '0.25s' },
          { y: 122, w: 200, delay: '0.45s' },
          { y: 148, w: 120, delay: '0.65s' },
        ].map((l) => (
          <rect key={l.y} x="-220" y={l.y} width={l.w} height="3" rx="1.5" fill="url(#linha)">
            <animate
              attributeName="x"
              from="-220"
              to="340"
              dur="1.5s"
              begin={l.delay}
              fill="freeze"
              calcMode="spline"
              keySplines="0.2 0 0.3 1"
              keyTimes="0;1"
            />
          </rect>
        ))}

        {/* Linhas do kite, desenhadas por stroke-dashoffset */}
        <g stroke="#22d3ee" strokeWidth="1.6" opacity="0.75">
          <line x1="160" y1="235" x2="120" y2="120" strokeDasharray="130" strokeDashoffset="130">
            <animate attributeName="stroke-dashoffset" from="130" to="0" dur="0.7s" begin="1.15s" fill="freeze" />
          </line>
          <line x1="160" y1="235" x2="205" y2="122" strokeDasharray="130" strokeDashoffset="130">
            <animate attributeName="stroke-dashoffset" from="130" to="0" dur="0.7s" begin="1.15s" fill="freeze" />
          </line>
        </g>

        {/* A pipa: sobe e infla */}
        <g opacity="0">
          <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="0.9s" fill="freeze" />
          <path
            d="M 96 112 Q 162 62 228 116 Q 162 104 96 112 Z"
            fill="#06b6d4"
            stroke="#67e8f9"
            strokeWidth="2.5"
          >
            <animateTransform
              attributeName="transform"
              type="translate"
              from="0 34"
              to="0 0"
              dur="1s"
              begin="0.9s"
              fill="freeze"
              calcMode="spline"
              keySplines="0.16 1 0.3 1"
              keyTimes="0;1"
            />
          </path>
        </g>

        {/* Velejador */}
        <g opacity="0">
          <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="1.5s" fill="freeze" />
          <circle cx="160" cy="228" r="7" fill="#e2e8f0" />
          <path d="M 160 236 L 160 256" stroke="#e2e8f0" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M 148 262 L 172 262" stroke="#f8fafc" strokeWidth="5" strokeLinecap="round" />
        </g>
      </svg>

      <div className="mt-2 text-center px-6">
        <h1
          className="text-4xl font-black tracking-tight text-white opacity-0"
          style={{ animation: 'kn-fade-up 0.7s ease-out 1.85s forwards' }}
        >
          Kite<span className="text-cyan-400">Ninja</span>
        </h1>
        <p
          className="mt-2 text-sm font-semibold text-slate-400 opacity-0"
          style={{ animation: 'kn-fade-up 0.7s ease-out 2.2s forwards' }}
        >
          Vento, maré e onda antes de montar o kite
        </p>
      </div>

      <button
        type="button"
        onClick={pular}
        className="absolute bottom-8 right-6 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-bold tracking-wide transition-colors"
      >
        Pular
      </button>

      <style jsx global>{`
        @keyframes kn-fade-up {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

/** Se a abertura já rodou nesta aba, não repetimos a espera. */
export function introJaVista(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const LAST_VIDEO_STORAGE_KEY = 'kiteninja:ultimo_video_intro';
/** Cache do vídeo inteiro para tocar na hora na próxima abertura, sem esperar a API. */
const CACHE_VIDEO_STORAGE_KEY = 'kiteninja:cache_video_intro';

/** Lê o vídeo cacheado da última abertura, se houver e ainda for válido. */
function lerVideoCacheado(): IntroVideo | null {
  try {
    const cru = localStorage.getItem(CACHE_VIDEO_STORAGE_KEY);
    if (!cru) return null;
    return parseIntroVideo(JSON.parse(cru));
  } catch {
    return null;
  }
}

function salvarVideoCacheado(v: IntroVideo | null): void {
  try {
    if (v) localStorage.setItem(CACHE_VIDEO_STORAGE_KEY, JSON.stringify(v));
    else localStorage.removeItem(CACHE_VIDEO_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function marcarIntroVista(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Sem storage, a intro repete — irritante, não quebrado.
  }
}

/**
 * Escolhe entre os vídeos configurados na playlist pelo admin e a animação vetorial.
 * Realiza rodízio inteligente a cada abertura do app.
 */
export const SplashIntro: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  // Decide NA HORA, de forma síncrona, a partir do vídeo cacheado da última abertura.
  // Sem tela preta esperando a API: se já vimos um vídeo antes, ele toca imediatamente.
  const cacheInicial =
    typeof window !== 'undefined' ? lerVideoCacheado() : null;

  const [decisao, setDecisao] = useState<'carregando' | 'video' | 'animacao'>(
    cacheInicial ? 'video' : 'carregando'
  );
  // O vídeo selecionado para ESTA sessão de reprodução nunca deve mudar no meio do caminho
  const [video, setVideo] = useState<IntroVideo | null>(cacheInicial);

  useEffect(() => {
    let ativo = true;
    const ctrl = new AbortController();
    // Sem cache, dá até 2.5s antes de cair na animação
    const prazoAnimacao = cacheInicial
      ? null
      : setTimeout(() => {
          if (ativo) setDecisao((d) => (d === 'carregando' ? 'animacao' : d));
        }, 2500);
    const prazoFetch = setTimeout(() => ctrl.abort(), 3000);

    (async () => {
      try {
        const res = await fetch('/api/intro-video', { signal: ctrl.signal });
        if (!res.ok) throw new Error('sem configuração');
        const data = (await res.json()) as { config?: unknown; video?: unknown };
        const config: IntroVideoConfig = parseIntroVideoConfig(data.config || data.video);

        let ultimoId: string | null = null;
        try {
          ultimoId = localStorage.getItem(LAST_VIDEO_STORAGE_KEY);
        } catch {
          // ignore
        }

        const selecionado = escolherVideoParaExibicao(config, ultimoId);
        if (!ativo) return;

        // Guarda o escolhido como cache pra PRÓXIMA abertura tocar na hora.
        salvarVideoCacheado(selecionado);
        try {
          if (selecionado?.id) localStorage.setItem(LAST_VIDEO_STORAGE_KEY, selecionado.id);
        } catch {
          // ignore
        }

        // Se ainda não decidimos (primeira abertura, sem cache), decide agora.
        setDecisao((d) => {
          if (d !== 'carregando') return d; // já está tocando o cache — não interrompe nem reinicia
          if (selecionado) {
            setVideo(selecionado);
            return 'video';
          }
          return 'animacao';
        });

        // Sem nenhum vídeo configurado: limpa o cache e mostra a animação.
        if (!selecionado) {
          salvarVideoCacheado(null);
          if (ativo) setDecisao('animacao');
        }
      } catch {
        if (ativo) setDecisao((d) => (d === 'carregando' ? 'animacao' : d));
      } finally {
        clearTimeout(prazoFetch);
      }
    })();

    return () => {
      ativo = false;
      ctrl.abort();
      clearTimeout(prazoFetch);
      if (prazoAnimacao) clearTimeout(prazoAnimacao);
    };
  }, []);

  if (decisao === 'carregando') {
    return <div className="fixed inset-0 z-splash bg-[#0B1220]" aria-hidden="true" />;
  }

  if (decisao === 'video' && video) {
    return (
      <SplashVideo
        video={video}
        onDone={onDone}
        onFalha={() => {
          salvarVideoCacheado(null);
          setDecisao('animacao');
        }}
      />
    );
  }

  return <SplashAnimado onDone={onDone} />;
};

/**
 * Toca apenas o trecho escolhido no editor. Reprodução fluida e sem travamentos.
 */
const SplashVideo: React.FC<{
  video: IntroVideo;
  onDone: () => void;
  onFalha: () => void;
}> = ({ video, onDone, onFalha }) => {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const falhaRef = useRef(onFalha);
  falhaRef.current = onFalha;

  useEffect(() => {
    const reduzMovimento =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduzMovimento) {
      doneRef.current();
      return;
    }

    const el = ref.current;
    if (!el) return;

    let encerrado = false;
    const finalizar = () => {
      if (encerrado) return;
      encerrado = true;
      setLeaving(true);
      setTimeout(() => doneRef.current(), 350);
    };

    let raf = 0;
    const vigiar = () => {
      if (el.currentTime >= video.fimSeg) {
        el.pause();
        finalizar();
        return;
      }
      raf = requestAnimationFrame(vigiar);
    };

    const iniciar = () => {
      if (encerrado) return;
      const inicio = video.inicioSeg < (el.duration || 999) ? video.inicioSeg : 0;
      // Só ajusta currentTime se o início for relevante (>0.3s)
      // Evita forçar seek desnecessário em vídeos que começam em 0s
      if (inicio > 0.3 && Math.abs(el.currentTime - inicio) > 0.2) {
        el.currentTime = inicio;
      }

      el.play()
        .then(() => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(vigiar);
        })
        .catch(() => {
          falhaRef.current();
        });
    };

    const onEnded = () => {
      finalizar();
    };

    const limite = setTimeout(
      finalizar,
      Math.min((video.fimSeg - video.inicioSeg) * 1000 + 4000, 20000)
    );

    el.addEventListener('loadedmetadata', iniciar);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', () => falhaRef.current());

    if (el.readyState >= 2) {
      iniciar();
    } else {
      iniciar();
    }

    return () => {
      el.removeEventListener('loadedmetadata', iniciar);
      el.removeEventListener('ended', onEnded);
      cancelAnimationFrame(raf);
      clearTimeout(limite);
    };
  }, [video.url, video.inicioSeg, video.fimSeg]);

  function pular() {
    marcarIntroVista();
    if (ref.current) {
      try {
        ref.current.pause();
        ref.current.src = '';
      } catch {}
    }
    onDone();
  }

  return (
    <div
      className={`fixed inset-0 w-screen h-screen z-splash bg-black overflow-hidden select-none transition-opacity duration-400 ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100dvh',
        minHeight: '-webkit-fill-available',
        zIndex: 99999,
        backgroundColor: '#000000',
        overflow: 'hidden',
      }}
      role="status"
      aria-label="Abertura do KiteNinja"
    >
      <video
        ref={ref}
        src={video.url}
        muted
        autoPlay
        playsInline
        poster={video.posterDataUrl}
        preload="auto"
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover block"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
          minHeight: '100%',
          objectFit: 'cover',
          objectPosition: 'center center',
          display: 'block',
        }}
      />
      <button
        onClick={pular}
        className="absolute left-1/2 -translate-x-1/2 px-6 py-2.5 rounded-full bg-black/50 border border-white/30 text-white text-sm font-black backdrop-blur-md active:scale-95 transition-all shadow-2xl z-30 pointer-events-auto"
        style={{
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        }}
      >
        Pular
      </button>
    </div>
  );
};
