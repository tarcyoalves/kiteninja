'use client';

import React, { useEffect, useRef, useState } from 'react';
import { parseIntroVideo, type IntroVideo } from '../lib/introVideo';

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

export function marcarIntroVista(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Sem storage, a intro repete — irritante, não quebrado.
  }
}

/**
 * Escolhe entre o vídeo configurado pelo admin e a animação vetorial.
 *
 * Enquanto consulta a configuração não mostramos nada além do fundo: exibir a
 * animação e trocar por vídeo no meio daria um salto visual. A consulta é
 * rápida (rota cacheada na borda) e tem prazo curto — se demorar, seguimos com
 * a animação em vez de fazer o velejador esperar por causa da abertura.
 */
export const SplashIntro: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [decisao, setDecisao] = useState<'carregando' | 'video' | 'animacao'>('carregando');
  const [video, setVideo] = useState<IntroVideo | null>(null);

  useEffect(() => {
    let ativo = true;
    // Sem rede não há abertura em vídeo; o abort garante que a espera não passe
    // de 2,5s, senão a tela de login ficaria refém da configuração.
    const ctrl = new AbortController();
    const prazo = setTimeout(() => ctrl.abort(), 2500);

    (async () => {
      try {
        const res = await fetch('/api/intro-video', { signal: ctrl.signal });
        if (!res.ok) throw new Error('sem configuração');
        const data = (await res.json()) as { video?: unknown };
        const v = parseIntroVideo(data.video);
        if (!ativo) return;
        if (v) {
          setVideo(v);
          setDecisao('video');
        } else {
          setDecisao('animacao');
        }
      } catch {
        if (ativo) setDecisao('animacao');
      } finally {
        clearTimeout(prazo);
      }
    })();

    return () => {
      ativo = false;
      ctrl.abort();
      clearTimeout(prazo);
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
        onFalha={() => setDecisao('animacao')}
      />
    );
  }

  return <SplashAnimado onDone={onDone} />;
};

/**
 * Toca apenas o trecho escolhido no editor. Não recortamos o arquivo: o corte é
 * metadado, então o admin reajusta depois sem subir o vídeo de novo.
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
      setTimeout(() => doneRef.current(), 400);
    };

    // `timeupdate` dispara a cada ~250ms, o que deixaria passar um pedaço
    // visível além do fim do trecho; o rAF fecha no quadro certo.
    let raf = 0;
    const vigiar = () => {
      if (el.currentTime >= video.fimSeg) {
        el.pause();
        finalizar();
        return;
      }
      raf = requestAnimationFrame(vigiar);
    };

    const aoCarregar = () => {
      // Se o trecho salvo não couber no arquivo (vídeo trocado por fora),
      // começamos do zero em vez de travar num seek impossível.
      const inicio = video.inicioSeg < el.duration ? video.inicioSeg : 0;
      el.currentTime = inicio;
      el.play()
        .then(() => {
          raf = requestAnimationFrame(vigiar);
        })
        .catch(() => {
          // Autoplay barrado apesar do muted, ou codec sem suporte.
          onFalha();
        });
    };

    // Rede da praia pode travar no meio do download; não deixamos a abertura
    // segurar o login para sempre.
    const limite = setTimeout(finalizar, Math.min((video.fimSeg - video.inicioSeg) * 1000 + 4000, 20000));

    el.addEventListener('loadedmetadata', aoCarregar);
    el.addEventListener('error', onFalha);
    if (el.readyState >= 1) aoCarregar();

    return () => {
      el.removeEventListener('loadedmetadata', aoCarregar);
      el.removeEventListener('error', onFalha);
      cancelAnimationFrame(raf);
      clearTimeout(limite);
    };
  }, [video, onFalha]);

  function pular() {
    marcarIntroVista();
    onDone();
  }

  return (
    <div
      className={`fixed inset-0 z-splash bg-black transition-opacity duration-400 ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
      role="status"
      aria-label="Abertura do KiteNinja"
    >
      <video
        ref={ref}
        src={video.url}
        poster={video.posterDataUrl}
        // Sem `muted` o navegador barra o autoplay; sem `playsInline` o iOS
        // abre o vídeo em tela cheia própria e sequestra a navegação.
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        className="w-full h-full object-cover"
      />
      <button
        onClick={pular}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 px-5 py-2 rounded-full bg-white/15 border border-white/25 text-white text-sm font-bold backdrop-blur-md active:scale-95 transition-all"
      >
        Pular
      </button>
    </div>
  );
};
