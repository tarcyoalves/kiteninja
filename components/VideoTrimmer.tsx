'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Scissors } from 'lucide-react';

export interface TrechoVideo {
  inicioSeg: number;
  fimSeg: number;
}

/**
 * Converte posição em pixels para segundos na timeline.
 * @param px Posição horizontal em pixels
 * @param larguraPx Largura total da área do filmstrip
 * @param duracao Duração total do vídeo em segundos
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
 * Arredonda para uma casa decimal para caber em UI mobile.
 */
export function formatarSegundos(seg: number): string {
  const arredondado = Math.round(seg * 10) / 10;
  // Substitui ponto por vírgula para português brasileiro
  return `${arredondado.toString().replace('.', ',')}s`;
}

/**
 * Valida e ajusta o trecho para respeitar os limites.
 * Se o trecho passar de maxSeg, empurra a outra alça (comportamento iOS).
 * Garante no mínimo minSeg entre as alças.
 */
export function clampTrecho(
  trecho: TrechoVideo,
  duracao: number,
  minSeg: number = 1.5,
  maxSeg: number = 12
): TrechoVideo {
  let { inicioSeg, fimSeg } = trecho;

  // Limites básicos
  inicioSeg = Math.max(0, Math.min(duracao, inicioSeg));
  fimSeg = Math.max(0, Math.min(duracao, fimSeg));

  // Garante início antes do fim
  if (inicioSeg >= fimSeg) {
    // Se a regra de minSeg permitir, ajusta; caso contrário, inverte
    if (inicioSeg >= minSeg) {
      fimSeg = inicioSeg + minSeg;
    } else {
      inicioSeg = 0;
      fimSeg = minSeg;
    }
  }

  // Limita ao fim do vídeo
  if (fimSeg > duracao) {
    fimSeg = duracao;
    inicioSeg = Math.max(0, fimSeg - minSeg);
  }
  if (inicioSeg < 0) {
    inicioSeg = 0;
  }

  // Se o trecho passou do maxSeg, empurra a outra alça
  const duracaoTrecho = fimSeg - inicioSeg;
  if (duracaoTrecho > maxSeg) {
    // Empurra a alça oposta para respeitar maxSeg
    fimSeg = inicioSeg + maxSeg;
    if (fimSeg > duracao) {
      fimSeg = duracao;
      inicioSeg = Math.max(0, fimSeg - maxSeg);
    }
  }

  // Garante minSeg de distância entre as alças
  const distancia = fimSeg - inicioSeg;
  if (distancia < minSeg) {
    // Empurra fimSeg para respeitar minSeg
    fimSeg = inicioSeg + minSeg;
    if (fimSeg > duracao) {
      fimSeg = duracao;
      inicioSeg = Math.max(0, fimSeg - minSeg);
    }
  }

  return { inicioSeg, fimSeg };
}

/**
 * Corrige valorInicial que pode estar fora dos limites do vídeo.
 */
export function validarValorInicial(
  valorInicial: TrechoVideo | undefined,
  duracao: number,
  minSeg: number = 1.5,
  maxSeg: number = 12
): TrechoVideo {
  if (!valorInicial) {
    // Padrão: primeiro minSeg do vídeo
    return { inicioSeg: 0, fimSeg: Math.min(minSeg, duracao) };
  }

  // Verifica se tem valores válidos
  if (
    typeof valorInicial.inicioSeg !== 'number' ||
    typeof valorInicial.fimSeg !== 'number' ||
    isNaN(valorInicial.inicioSeg) ||
    isNaN(valorInicial.fimSeg)
  ) {
    return { inicioSeg: 0, fimSeg: Math.min(minSeg, duracao) };
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
  maxSeg = 12,
  minSeg = 1.5,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);

  const [duracaoVideo, setDuracaoVideo] = useState(0);
  const [miniaturas, setMiniaturas] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [trecho, setTrecho] = useState<TrechoVideo>({ inicioSeg: 0, fimSeg: 0 });
  const [tocando, setTocando] = useState(false);
  const [posicaoAtual, setPosicaoAtual] = useState(0);

  // Controla qual alça está sendo arrastada
  const [alçaArrastando, setAlçaArrastando] = useState<'inicio' | 'fim' | null>(null);

  // Inicializa o trecho com valorInicial
  useEffect(() => {
    if (duracaoVideo > 0) {
      const corrigido = validarValorInicial(valorInicial, duracaoVideo, minSeg, maxSeg);
      setTrecho(corrigido);
      onChange(corrigido);
    }
  }, [duracaoVideo, valorInicial, minSeg, maxSeg, onChange]);

  // Extrai miniaturas do vídeo
  // O seek é assíncrono: precisamos esperar o evento 'seeked' antes de desenhar
  // cada quadro, senão capturamos o frame anterior.
  useEffect(() => {
    if (!videoRef.current || duracaoVideo <= 0) return;

    const video = videoRef.current;
    const NUM_MINIATURAS = 10;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Tamanho das miniaturas
    canvas.width = 160;
    canvas.height = 90;

    const tempMiniaturas: string[] = [];
    let extraidas = 0;

    const capturarQuadro = (tempo: number) => {
      return new Promise<void>((resolve) => {
        const handler = () => {
          video.removeEventListener('seeked', handler);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          tempMiniaturas.push(canvas.toDataURL('image/jpeg', 0.5));
          extraidas++;
          resolve();
        };
        video.addEventListener('seeked', handler);
        video.currentTime = tempo;
      });
    };

    const extrairTodas = async () => {
      setCarregando(true);
      for (let i = 0; i < NUM_MINIATURAS; i++) {
        const tempo = (duracaoVideo / NUM_MINIATURAS) * (i + 0.5);
        await capturarQuadro(tempo);
      }
      setMiniaturas(tempMiniaturas);
      setCarregando(false);
    };

    extrairTodas();
  }, [duracaoVideo]);

  // Cleanup do animation frame
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Loop de reprodução: timeupdate dispara a cada ~250ms, o que deixa
  // passar um pedaço visível além do fim. Por isso usamos também
  // requestAnimationFrame para precisão.
  useEffect(() => {
    if (!tocando || !videoRef.current) return;

    const video = videoRef.current;

    const verificarPosicao = () => {
      if (!videoRef.current) return;

      const atual = videoRef.current.currentTime;

      // Se passou do fim do trecho, volta para o início
      if (atual >= trecho.fimSeg) {
        videoRef.current.currentTime = trecho.inicioSeg;
      }

      setPosicaoAtual(videoRef.current.currentTime);

      if (tocando) {
        animationRef.current = requestAnimationFrame(verificarPosicao);
      }
    };

    animationRef.current = requestAnimationFrame(verificarPosicao);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [tocando, trecho.fimSeg, trecho.inicioSeg]);

  // Handler para quando o vídeo carrega metadados
  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuracaoVideo(videoRef.current.duration);
    }
  }, []);

  // Atualiza o frame do vídeo conforme arrasta
  useEffect(() => {
    if (videoRef.current && (alçaArrastando === 'inicio' || alçaArrastando === 'fim')) {
      const tempo = alçaArrastando === 'inicio' ? trecho.inicioSeg : trecho.fimSeg;
      videoRef.current.currentTime = tempo;
    }
  }, [trecho, alçaArrastando]);

  // Inicia o arraste de uma alça
  const handlePointerDown = useCallback(
    (alça: 'inicio' | 'fim') => (e: React.PointerEvent) => {
      e.preventDefault();
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      setAlçaArrastando(alça);
    },
    []
  );

  // Move a alça enquanto arrasta
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!alçaArrastando || !filmstripRef.current || !containerRef.current) return;

      const rect = filmstripRef.current.getBoundingClientRect();
      const largura = rect.width;
      const px = e.clientX - rect.left;

      const novoTempo = posicaoParaSegundo(px, largura, duracaoVideo);

      let novoTrecho: TrechoVideo;

      if (alçaArrastando === 'inicio') {
        novoTrecho = clampTrecho(
          { inicioSeg: novoTempo, fimSeg: trecho.fimSeg },
          duracaoVideo,
          minSeg,
          maxSeg
        );
      } else {
        novoTrecho = clampTrecho(
          { inicioSeg: trecho.inicioSeg, fimSeg: novoTempo },
          duracaoVideo,
          minSeg,
          maxSeg
        );
      }

      setTrecho(novoTrecho);
      onChange(novoTrecho);
    },
    [alçaArrastando, duracaoVideo, minSeg, maxSeg, onChange, trecho]
  );

  // Finaliza o arraste
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const target = e.currentTarget as HTMLElement;
      target.releasePointerCapture(e.pointerId);
      setAlçaArrastando(null);
    },
    []
  );

  // Controles de teclado para acessibilidade
  const handleKeyDown = useCallback(
    (alça: 'inicio' | 'fim') => (e: React.KeyboardEvent) => {
      const passo = e.shiftKey ? 1 : 0.1;
      let novoTempo: number;

      if (e.key === 'ArrowLeft') {
        novoTempo = (alça === 'inicio' ? trecho.inicioSeg : trecho.fimSeg) - passo;
      } else if (e.key === 'ArrowRight') {
        novoTempo = (alça === 'inicio' ? trecho.inicioSeg : trecho.fimSeg) + passo;
      } else {
        return;
      }

      e.preventDefault();

      let novoTrecho: TrechoVideo;
      if (alça === 'inicio') {
        novoTrecho = clampTrecho(
          { inicioSeg: novoTempo, fimSeg: trecho.fimSeg },
          duracaoVideo,
          minSeg,
          maxSeg
        );
      } else {
        novoTrecho = clampTrecho(
          { inicioSeg: trecho.inicioSeg, fimSeg: novoTempo },
          duracaoVideo,
          minSeg,
          maxSeg
        );
      }

      setTrecho(novoTrecho);
      onChange(novoTrecho);
    },
    [duracaoVideo, minSeg, maxSeg, onChange, trecho]
  );

  // Play/Pause
  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;

    if (tocando) {
      videoRef.current.pause();
      setTocando(false);
    } else {
      // Posiciona no início do trecho e toca
      videoRef.current.currentTime = trecho.inicioSeg;
      videoRef.current.play();
      setTocando(true);
    }
  }, [tocando, trecho.inicioSeg]);

  // Atualiza posicaoAtual quando toca
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setPosicaoAtual(videoRef.current.currentTime);
    }
  }, []);

  // Quando o vídeo termina (chega ao fim natural), volta para o trecho
  const handleEnded = useCallback(() => {
    if (videoRef.current && duracaoVideo > 0) {
      videoRef.current.currentTime = trecho.inicioSeg;
      if (tocando) {
        videoRef.current.play();
      }
    }
  }, [duracaoVideo, trecho.inicioSeg, tocando]);

  // Estilos
  const duracaoTrecho = trecho.fimSeg - trecho.inicioSeg;
  const excedeMax = duracaoTrecho > maxSeg;

  const inicioPercentual = segundoParaPercentual(trecho.inicioSeg, duracaoVideo) * 100;
  const fimPercentual = segundoParaPercentual(trecho.fimSeg, duracaoVideo) * 100;
  const posicaoPlayhead = segundoParaPercentual(posicaoAtual, duracaoVideo) * 100;

  return (
    <div className="w-full bg-[#0B1220] rounded-2xl border border-slate-700 p-4 space-y-4">
      {/* Video oculto para captura de frames */}
      <video
        ref={videoRef}
        src={src}
        className="hidden"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        crossOrigin="anonymous"
      />

      {/* Filmstrip */}
      <div ref={containerRef} className="relative">
        <div
          ref={filmstripRef}
          className="relative h-20 bg-slate-800 rounded-xl overflow-hidden select-none"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {/* Miniaturas */}
          {carregando ? (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">
              Carregando miniaturas...
            </div>
          ) : (
            <div className="absolute inset-0 flex">
              {miniaturas.map((mini, i) => (
                <img
                  key={i}
                  src={mini}
                  alt=""
                  className="h-full object-cover"
                  style={{ width: `${100 / miniaturas.length}%` }}
                />
              ))}
            </div>
          )}

          {/* Overlay escuro fora do trecho selecionado */}
          <div
            className="absolute top-0 bottom-0 bg-black/60 pointer-events-none"
            style={{ left: 0, width: `${inicioPercentual}%` }}
          />
          <div
            className="absolute top-0 bottom-0 bg-black/60 pointer-events-none"
            style={{ right: 0, width: `${100 - fimPercentual}%` }}
          />

          {/* Moldura amarelo вокруг trecho selecionado (estilo iOS) */}
          <div
            className="absolute top-0 bottom-0 border-2 border-amber-400 pointer-events-none"
            style={{
              left: `${inicioPercentual}%`,
              width: `${fimPercentual - inicioPercentual}%`,
            }}
          />

          {/* Alça de início */}
          <div
            className={`absolute top-0 bottom-0 w-3 cursor-ew-resize group ${
              alçaArrastando === 'inicio' ? 'z-20' : 'z-10'
            }`}
            style={{ left: `calc(${inicioPercentual}% - 6px)` }}
            role="slider"
            tabIndex={0}
            aria-label="Início do trecho"
            aria-valuemin={0}
            aria-valuemax={duracaoVideo}
            aria-valuenow={Math.round(trecho.inicioSeg * 10) / 10}
            onPointerDown={handlePointerDown('inicio')}
            onKeyDown={handleKeyDown('inicio')}
          >
            {/* Indicador visual da alça */}
            <div className="absolute top-0 bottom-0 left-0 w-1 bg-amber-400 rounded-full shadow-lg group-hover:bg-amber-300 group-focus:outline-none group-focus:ring-2 group-focus:ring-amber-400/50" />
            {/* Handle circle */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 bg-amber-400 rounded-full shadow-lg border-2 border-white group-hover:bg-amber-300 group-focus:outline-none group-focus:ring-2 group-focus:ring-amber-400/50" />
          </div>

          {/* Alça de fim */}
          <div
            className={`absolute top-0 bottom-0 w-3 cursor-ew-resize group ${
              alçaArrastando === 'fim' ? 'z-20' : 'z-10'
            }`}
            style={{ left: `calc(${fimPercentual}% - 6px)` }}
            role="slider"
            tabIndex={0}
            aria-label="Fim do trecho"
            aria-valuemin={0}
            aria-valuemax={duracaoVideo}
            aria-valuenow={Math.round(trecho.fimSeg * 10) / 10}
            onPointerDown={handlePointerDown('fim')}
            onKeyDown={handleKeyDown('fim')}
          >
            <div className="absolute top-0 bottom-0 left-0 w-1 bg-amber-400 rounded-full shadow-lg group-hover:bg-amber-300 group-focus:outline-none group-focus:ring-2 group-focus:ring-amber-400/50" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 bg-amber-400 rounded-full shadow-lg border-2 border-white group-hover:bg-amber-300 group-focus:outline-none group-focus:ring-2 group-focus:ring-amber-400/50" />
          </div>

          {/* Playhead - só mostra quando não está arrastando */}
          {alçaArrastando === null && duracaoVideo > 0 && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 z-0 pointer-events-none transition-all"
              style={{ left: `${posicaoPlayhead}%` }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-emerald-400 rounded-full" />
            </div>
          )}
        </div>
      </div>

      {/* Controles */}
      <div className="flex items-center justify-between">
        {/* Botão play/pause */}
        <button
          onClick={togglePlay}
          className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white transition-colors"
          aria-label={tocando ? 'Pausar vídeo' : 'Reproduzir trecho selecionado'}
        >
          {tocando ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
        </button>

        {/* Info do trecho */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-slate-300">
            <Scissors size={14} className="text-slate-400" />
            <span className="text-sm font-medium">
              {formatarSegundos(trecho.inicioSeg)} - {formatarSegundos(trecho.fimSeg)}
            </span>
          </div>

          <div
            className={`px-3 py-1 rounded-lg font-bold text-sm ${
              excedeMax
                ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                : 'bg-slate-700 text-slate-200'
            }`}
          >
            {formatarSegundos(duracaoTrecho)}
            {excedeMax && <span className="ml-1">/ {formatarSegundos(maxSeg)}</span>}
          </div>
        </div>
      </div>

      {/* Tempo atual */}
      <div className="text-center text-xs text-slate-400">
        {formatarSegundos(posicaoAtual)} / {formatarSegundos(duracaoVideo)}
      </div>
    </div>
  );
};
