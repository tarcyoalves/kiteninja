'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Scissors, Plus, Minus, MoveHorizontal } from 'lucide-react';

export interface TrechoVideo {
  inicioSeg: number;
  fimSeg: number;
}

/**
 * Converte posição em pixels para segundos na timeline.
 */
export function posicaoParaSegundo(px: number, larguraPx: number, duracao: number): number {
  if (larguraPx <= 0 || duracao <= 0) return 0;
  const percentual = Math.max(0, Math.min(1, px / larguraPx));
  return percentual * duracao;
}

/**
 * Converte segundos para percentual da timeline.
 */
export function segundoParaPercentual(seg: number, duracao: number): number {
  if (duracao <= 0) return 0;
  return Math.max(0, Math.min(1, seg / duracao));
}

/**
 * Formata segundos para string amigável (ex: 4.23 -> "4,2s").
 */
export function formatarSegundos(seg: number): string {
  const arredondado = Math.round(seg * 10) / 10;
  return `${arredondado.toString().replace('.', ',')}s`;
}

/**
 * Valida e ajusta o trecho para respeitar os limites.
 */
export function clampTrecho(
  trecho: TrechoVideo,
  duracao: number,
  minSeg: number = 1.5,
  maxSeg: number = 15
): TrechoVideo {
  let { inicioSeg, fimSeg } = trecho;

  if (duracao <= 0) return { inicioSeg: 0, fimSeg: minSeg };

  // Limites básicos
  inicioSeg = Math.max(0, Math.min(duracao, inicioSeg));
  fimSeg = Math.max(0, Math.min(duracao, fimSeg));

  // Garante início antes do fim
  if (inicioSeg >= fimSeg) {
    if (inicioSeg + minSeg <= duracao) {
      fimSeg = inicioSeg + minSeg;
    } else {
      fimSeg = duracao;
      inicioSeg = Math.max(0, fimSeg - minSeg);
    }
  }

  // Se a duração for maior que o máximo permitido
  if (fimSeg - inicioSeg > maxSeg) {
    fimSeg = inicioSeg + maxSeg;
    if (fimSeg > duracao) {
      fimSeg = duracao;
      inicioSeg = Math.max(0, fimSeg - maxSeg);
    }
  }

  // Se a distância for menor que o mínimo
  if (fimSeg - inicioSeg < minSeg) {
    fimSeg = Math.min(duracao, inicioSeg + minSeg);
    if (fimSeg - inicioSeg < minSeg) {
      inicioSeg = Math.max(0, fimSeg - minSeg);
    }
  }

  return {
    inicioSeg: Math.round(inicioSeg * 10) / 10,
    fimSeg: Math.round(fimSeg * 10) / 10,
  };
}

/**
 * Corrige valorInicial que pode estar fora dos limites do vídeo.
 */
export function validarValorInicial(
  valorInicial: TrechoVideo | undefined,
  duracao: number,
  minSeg: number = 1.5,
  maxSeg: number = 15
): TrechoVideo {
  if (!valorInicial) {
    return { inicioSeg: 0, fimSeg: Math.min(minSeg, duracao > 0 ? duracao : minSeg) };
  }

  if (
    typeof valorInicial.inicioSeg !== 'number' ||
    typeof valorInicial.fimSeg !== 'number' ||
    isNaN(valorInicial.inicioSeg) ||
    isNaN(valorInicial.fimSeg)
  ) {
    return { inicioSeg: 0, fimSeg: Math.min(minSeg, duracao > 0 ? duracao : minSeg) };
  }

  return clampTrecho(valorInicial, duracao, minSeg, maxSeg);
}

interface VideoTrimmerProps {
  src: string;
  valorInicial?: TrechoVideo;
  onChange: (trecho: TrechoVideo) => void;
  maxSeg?: number;
  minSeg?: number;
}

export const VideoTrimmer: React.FC<VideoTrimmerProps> = ({
  src,
  valorInicial,
  onChange,
  maxSeg = 15,
  minSeg = 1.5,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);

  const [duracaoVideo, setDuracaoVideo] = useState(0);
  const [miniaturas, setMiniaturas] = useState<string[]>([]);
  const [carregandoMiniaturas, setCarregandoMiniaturas] = useState(true);
  const [trecho, setTrecho] = useState<TrechoVideo>({ inicioSeg: 0, fimSeg: 6 });
  const [tocando, setTocando] = useState(false);
  const [posicaoAtual, setPosicaoAtual] = useState(0);

  // Arraste: 'inicio' | 'fim' | 'janela' (move o trecho inteiro) | null
  const [modoArraste, setModoArraste] = useState<'inicio' | 'fim' | 'janela' | null>(null);
  const dragStartRef = useRef<{ clientX: number; inicioSeg: number; fimSeg: number } | null>(null);

  // Inicializa o trecho com base no valor inicial
  useEffect(() => {
    if (valorInicial && duracaoVideo > 0) {
      setTrecho(validarValorInicial(valorInicial, duracaoVideo, minSeg, maxSeg));
    }
  }, [valorInicial, duracaoVideo, minSeg, maxSeg]);

  // Carrega metadados do vídeo e gera filmstrip
  const handleLoadedMetadata = useCallback(() => {
    if (!videoRef.current) return;
    const duracao = videoRef.current.duration;
    if (duracao && isFinite(duracao)) {
      setDuracaoVideo(duracao);
      setTrecho((atual) => validarValorInicial(atual.fimSeg > 0 ? atual : valorInicial, duracao, minSeg, maxSeg));
      gerarMiniaturas(duracao);
    }
  }, [valorInicial, minSeg, maxSeg]);

  // Gera 8 miniaturas ao longo do vídeo para o filmstrip
  const gerarMiniaturas = async (duracao: number) => {
    setCarregandoMiniaturas(true);
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 70;
    const ctx = canvas.getContext('2d');

    const v = document.createElement('video');
    v.src = src;
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';

    await new Promise((res) => {
      v.onloadedmetadata = () => res(true);
      v.onerror = () => res(false);
      setTimeout(() => res(false), 4000);
    });

    const qtd = 8;
    const thumbs: string[] = [];

    for (let i = 0; i < qtd; i++) {
      const tempo = (i / (qtd - 1 || 1)) * Math.max(0.1, duracao - 0.2);
      try {
        v.currentTime = tempo;
        await new Promise((res) => {
          v.onseeked = () => res(true);
          setTimeout(() => res(false), 500);
        });
        if (ctx) {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          thumbs.push(canvas.toDataURL('image/jpeg', 0.6));
        }
      } catch {
        // ignora frame individual
      }
    }

    setMiniaturas(thumbs.length > 0 ? thumbs : []);
    setCarregandoMiniaturas(false);
  };

  // Aplica novo trecho e notifica componente pai
  const atualizarTrecho = useCallback(
    (novo: TrechoVideo) => {
      const ajustado = clampTrecho(novo, duracaoVideo, minSeg, maxSeg);
      setTrecho(ajustado);
      onChange(ajustado);
      if (videoRef.current) {
        videoRef.current.currentTime = ajustado.inicioSeg;
      }
    },
    [duracaoVideo, minSeg, maxSeg, onChange]
  );

  // Botões de micro-ajuste (+/- 0.5s)
  const ajustarInicio = (delta: number) => {
    atualizarTrecho({
      inicioSeg: Math.max(0, trecho.inicioSeg + delta),
      fimSeg: trecho.fimSeg,
    });
  };

  const ajustarFim = (delta: number) => {
    atualizarTrecho({
      inicioSeg: trecho.inicioSeg,
      fimSeg: Math.min(duracaoVideo || 100, trecho.fimSeg + delta),
    });
  };

  // Início do arraste
  const iniciarArraste = (modo: 'inicio' | 'fim' | 'janela') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setModoArraste(modo);
    dragStartRef.current = {
      clientX: e.clientX,
      inicioSeg: trecho.inicioSeg,
      fimSeg: trecho.fimSeg,
    };
    if (tocando && videoRef.current) {
      videoRef.current.pause();
      setTocando(false);
    }
  };

  // Gerenciador global de ponteiro (Window Listener) - não perde o foco
  useEffect(() => {
    if (!modoArraste) return;

    const onPointerMove = (e: PointerEvent) => {
      if (!filmstripRef.current || !dragStartRef.current || duracaoVideo <= 0) return;

      const rect = filmstripRef.current.getBoundingClientRect();
      const deltaPx = e.clientX - dragStartRef.current.clientX;
      const deltaSeg = (deltaPx / rect.width) * duracaoVideo;

      let novoTrecho: TrechoVideo = { ...trecho };

      if (modoArraste === 'inicio') {
        const novoInicio = Math.max(0, dragStartRef.current.inicioSeg + deltaSeg);
        novoTrecho = clampTrecho(
          { inicioSeg: novoInicio, fimSeg: trecho.fimSeg },
          duracaoVideo,
          minSeg,
          maxSeg
        );
      } else if (modoArraste === 'fim') {
        const novoFim = Math.min(duracaoVideo, dragStartRef.current.fimSeg + deltaSeg);
        novoTrecho = clampTrecho(
          { inicioSeg: trecho.inicioSeg, fimSeg: novoFim },
          duracaoVideo,
          minSeg,
          maxSeg
        );
      } else if (modoArraste === 'janela') {
        const dur = dragStartRef.current.fimSeg - dragStartRef.current.inicioSeg;
        let novoInicio = dragStartRef.current.inicioSeg + deltaSeg;
        novoInicio = Math.max(0, Math.min(duracaoVideo - dur, novoInicio));
        novoTrecho = {
          inicioSeg: Math.round(novoInicio * 10) / 10,
          fimSeg: Math.round((novoInicio + dur) * 10) / 10,
        };
      }

      setTrecho(novoTrecho);
      onChange(novoTrecho);

      // Mostra preview do frame em tempo real
      if (videoRef.current) {
        const previewTime =
          modoArraste === 'fim' ? novoTrecho.fimSeg : novoTrecho.inicioSeg;
        videoRef.current.currentTime = previewTime;
      }
    };

    const onPointerUp = () => {
      setModoArraste(null);
      dragStartRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [modoArraste, duracaoVideo, minSeg, maxSeg, onChange, trecho]);

  // Reprodução em loop do trecho recortado
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (tocando) {
      videoRef.current.pause();
      setTocando(false);
    } else {
      videoRef.current.currentTime = trecho.inicioSeg;
      videoRef.current.play();
      setTocando(true);
    }
  };

  // Monitora o fim do trecho para loop contínuo
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const atual = videoRef.current.currentTime;
    setPosicaoAtual(atual);
    if (tocando && atual >= trecho.fimSeg) {
      videoRef.current.currentTime = trecho.inicioSeg;
      videoRef.current.play();
    }
  };

  const duracaoTrecho = Math.max(0, trecho.fimSeg - trecho.inicioSeg);
  const inicioPct = segundoParaPercentual(trecho.inicioSeg, duracaoVideo) * 100;
  const fimPct = segundoParaPercentual(trecho.fimSeg, duracaoVideo) * 100;
  const playheadPct = segundoParaPercentual(posicaoAtual, duracaoVideo) * 100;

  return (
    <div className="w-full bg-[#0B1220] rounded-2xl border border-slate-700/80 p-4 space-y-4 shadow-xl">
      {/* Video de visualização e decodificação */}
      <div className="relative w-full aspect-video max-h-56 bg-black rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center">
        <video
          ref={videoRef}
          src={src}
          className="w-full h-full object-contain"
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          crossOrigin="anonymous"
        />

        {/* Botão flutuante de play/pause no centro do preview */}
        <button
          onClick={togglePlay}
          className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-cyan-500/90 hover:bg-cyan-400 text-slate-950 flex items-center justify-center shadow-2xl backdrop-blur-md active:scale-95 transition-all opacity-80 hover:opacity-100"
          title={tocando ? 'Pausar prévia' : 'Tocar trecho'}
        >
          {tocando ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
        </button>
      </div>

      {/* Filmstrip & Seletor Visual */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-slate-400 font-bold px-1">
          <span className="flex items-center gap-1">
            <Scissors size={13} className="text-amber-400" />
            Seletor de Corte (Arraste as alças amarelas)
          </span>
          <span className="text-amber-300 font-black">
            {formatarSegundos(duracaoTrecho)} selecionados
          </span>
        </div>

        <div
          ref={filmstripRef}
          className="relative h-20 bg-slate-900 rounded-xl overflow-hidden select-none border border-slate-700 touch-none"
        >
          {/* Miniaturas de fundo */}
          {carregandoMiniaturas ? (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs font-semibold">
              Gerando visualização da timeline...
            </div>
          ) : (
            <div className="absolute inset-0 flex">
              {miniaturas.map((mini, i) => (
                <img
                  key={i}
                  src={mini}
                  alt=""
                  className="h-full object-cover pointer-events-none"
                  style={{ width: `${100 / miniaturas.length}%` }}
                />
              ))}
            </div>
          )}

          {/* Sombra escura fora do trecho selecionado */}
          <div
            className="absolute top-0 bottom-0 left-0 bg-black/75 pointer-events-none transition-all"
            style={{ width: `${inicioPct}%` }}
          />
          <div
            className="absolute top-0 bottom-0 right-0 bg-black/75 pointer-events-none transition-all"
            style={{ width: `${100 - fimPct}%` }}
          />

          {/* Janela central amarela selecionada (pode ser arrastada inteira) */}
          <div
            onPointerDown={iniciarArraste('janela')}
            className={`absolute top-0 bottom-0 border-y-2 border-amber-400 bg-amber-400/15 cursor-grab active:cursor-grabbing flex items-center justify-center group ${
              modoArraste === 'janela' ? 'border-amber-300 bg-amber-400/25' : ''
            }`}
            style={{
              left: `${inicioPct}%`,
              width: `${Math.max(2, fimPct - inicioPct)}%`,
            }}
            title="Arraste para mover o trecho inteiro"
          >
            <MoveHorizontal size={16} className="text-amber-300 opacity-60 group-hover:opacity-100 transition-opacity" />
          </div>

          {/* Alça de Início (área de toque ampliada para 44px) */}
          <div
            onPointerDown={iniciarArraste('inicio')}
            className="absolute top-0 bottom-0 w-11 -translate-x-1/2 cursor-ew-resize flex items-center justify-center z-20 group touch-none"
            style={{ left: `${inicioPct}%` }}
            title="Arraste para mudar o início"
          >
            <div className="w-1.5 h-full bg-amber-400 rounded-l shadow-lg group-hover:bg-amber-300 group-active:scale-110 transition-transform" />
            <div className="absolute w-6 h-6 bg-amber-400 border-2 border-white rounded-full shadow-2xl flex items-center justify-center text-[9px] font-black text-slate-950 group-hover:scale-110 transition-transform">
              ◀
            </div>
          </div>

          {/* Alça de Fim (área de toque ampliada para 44px) */}
          <div
            onPointerDown={iniciarArraste('fim')}
            className="absolute top-0 bottom-0 w-11 -translate-x-1/2 cursor-ew-resize flex items-center justify-center z-20 group touch-none"
            style={{ left: `${fimPct}%` }}
            title="Arraste para mudar o fim"
          >
            <div className="w-1.5 h-full bg-amber-400 rounded-r shadow-lg group-hover:bg-amber-300 group-active:scale-110 transition-transform" />
            <div className="absolute w-6 h-6 bg-amber-400 border-2 border-white rounded-full shadow-2xl flex items-center justify-center text-[9px] font-black text-slate-950 group-hover:scale-110 transition-transform">
              ▶
            </div>
          </div>

          {/* Playhead indicador da reprodução */}
          {duracaoVideo > 0 && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 z-10 pointer-events-none"
              style={{ left: `${playheadPct}%` }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-cyan-400 rounded-full" />
            </div>
          )}
        </div>
      </div>

      {/* Botões de Micro-Ajuste Preciso (+/- 0.5s) */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        {/* Controle do Início */}
        <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-300">
            <span>Início:</span>
            <span className="text-amber-400 font-mono font-bold text-xs">{formatarSegundos(trecho.inicioSeg)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => ajustarInicio(-0.5)}
              className="flex-1 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold flex items-center justify-center gap-0.5 active:scale-95 transition-all"
              title="Voltar 0.5s no início"
            >
              <Minus size={12} /> 0.5s
            </button>
            <button
              onClick={() => ajustarInicio(0.5)}
              className="flex-1 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold flex items-center justify-center gap-0.5 active:scale-95 transition-all"
              title="Avançar 0.5s no início"
            >
              <Plus size={12} /> 0.5s
            </button>
          </div>
        </div>

        {/* Controle do Fim */}
        <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-300">
            <span>Fim:</span>
            <span className="text-amber-400 font-mono font-bold text-xs">{formatarSegundos(trecho.fimSeg)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => ajustarFim(-0.5)}
              className="flex-1 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold flex items-center justify-center gap-0.5 active:scale-95 transition-all"
              title="Voltar 0.5s no fim"
            >
              <Minus size={12} /> 0.5s
            </button>
            <button
              onClick={() => ajustarFim(0.5)}
              className="flex-1 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold flex items-center justify-center gap-0.5 active:scale-95 transition-all"
              title="Avançar 0.5s no fim"
            >
              <Plus size={12} /> 0.5s
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
