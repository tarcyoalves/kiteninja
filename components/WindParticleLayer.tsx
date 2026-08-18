'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import type { Spot } from '@/types';
import { vetorVento, corPorForca, campoDeVento } from '@/lib/windVector';

/**
 * Camada de partículas que mostra PARA ONDE o vento sopra, sobre o mapa.
 *
 * Por que canvas e não marcadores animados: são centenas de partículas
 * redesenhadas a cada frame. Como DOM, cada uma seria um nó com transform, e o
 * navegador de celular derrete. Um canvas só, com desenho manual, mantém 60fps
 * num aparelho modesto.
 *
 * O campo de vento é interpolado a partir dos spots: cada spot conhece a própria
 * direção e intensidade (Open-Meteo), e um ponto qualquer do mapa recebe a média
 * dos spots próximos, ponderada por 1/distância². Não é um modelo meteorológico
 * — é uma leitura visual da tendência entre os pontos que medimos, que é
 * exatamente o que o velejador quer: "de onde vem e quão forte".
 */

interface Props {
  spots: Spot[];
  /** Desliga a animação (modo praia / economia de bateria). */
  paused?: boolean;
}

interface Particula {
  x: number; // pixel na tela
  y: number;
  idade: number;
  vida: number;
}

export function WindParticleLayer({ spots, paused = false }: Props) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particulasRef = useRef<Particula[]>([]);
  const frameRef = useRef<number>(0);
  const spotsRef = useRef<Spot[]>(spots);
  const reprojetarRef = useRef<(() => void) | null>(null);

  // Mantém os spots atuais sem reiniciar a animação a cada refresh de clima.
  spotsRef.current = spots;

  // Quando o conteúdo de spots chega ou atualiza (assíncrono da API), reprojeta o campo
  // sem recriar as partículas (o que causaria piscada na tela).
  useEffect(() => {
    reprojetarRef.current?.();
  }, [spots]);

  useEffect(() => {
    const container = map.getContainer();
    const canvas = document.createElement('canvas');
    canvas.className = 'wind-particle-canvas';
    // pointer-events none é essencial: sem isso o canvas engole arrasto e zoom.
    canvas.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:200;';
    container.appendChild(canvas);
    canvasRef.current = canvas;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let largura = 0;
    let altura = 0;
    let isRodando = false;

    // Cache dos spots já projetados em pixel: projetar é caro e só muda quando o
    // mapa se move ou novos dados chegam.
    let projetados: { x: number; y: number; vx: number; vy: number; forca: number }[] = [];

    function dimensionar() {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      // Limita o devicePixelRatio a 2: num celular com dpr 3 o custo triplica
      // sem ganho visível para partículas finas.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      largura = clientWidth;
      altura = clientHeight;
      canvas.width = Math.floor(clientWidth * dpr);
      canvas.height = Math.floor(clientHeight * dpr);
      canvas.style.width = `${clientWidth}px`;
      canvas.style.height = `${clientHeight}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function projetarSpots() {
      projetados = spotsRef.current
        .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
        .map((s) => {
          const p = map.latLngToContainerPoint([s.lat, s.lng]);
          const { vx, vy } = vetorVento(s.windDirectionDeg ?? 0);
          return { x: p.x, y: p.y, vx, vy, forca: Math.max(s.currentKnots ?? 0, 0) };
        });
    }

    /** Campo de vento num ponto: delega ao módulo testado em lib/windVector. */
    function campo(x: number, y: number) {
      return campoDeVento(x, y, projetados);
    }

    function nascer(p: Particula) {
      p.x = Math.random() * (largura || 1);
      p.y = Math.random() * (altura || 1);
      p.idade = 0;
      // Vidas diferentes evitam que todas as partículas pisquem em sincronia.
      p.vida = 60 + Math.random() * 90;
    }

    function popular() {
      if (largura <= 0 || altura <= 0) return;
      // Densidade proporcional à área, com teto: numa tela grande não vale
      // gastar mais partículas do que o olho distingue.
      const alvo = Math.min(Math.round((largura * altura) / 5200), 320);
      const atual = particulasRef.current;
      atual.length = 0;
      for (let i = 0; i < alvo; i++) {
        const p: Particula = { x: 0, y: 0, idade: 0, vida: 0 };
        nascer(p);
        // Espalha a idade inicial para o campo já nascer preenchido.
        p.idade = Math.random() * p.vida;
        atual.push(p);
      }
    }

    function desenhar() {
      if (!isRodando || largura === 0 || altura === 0) return;

      // Em vez de limpar, pinta um véu translúcido: o resto do frame anterior
      // vira o rastro da partícula, sem precisar guardar histórico de posições.
      ctx!.globalCompositeOperation = 'destination-out';
      ctx!.fillStyle = 'rgba(0,0,0,0.12)';
      ctx!.fillRect(0, 0, largura, altura);
      ctx!.globalCompositeOperation = 'source-over';

      ctx!.lineWidth = 1.35;
      ctx!.lineCap = 'round';

      for (const p of particulasRef.current) {
        const { vx, vy, forca } = campo(p.x, p.y);

        // Garante velocidade visível mesmo com vento leve
        const forcaEfetiva = Math.max(forca, 10);
        const vxEfetivo = vx === 0 && vy === 0 ? -0.9 : vx; // fallback direção ESE/E
        const vyEfetivo = vx === 0 && vy === 0 ? 0.3 : vy;

        // Escala: 25 nós ≈ 2.6 px/frame. Rápido o bastante para ler a direção,
        // lento o bastante para não virar chuvisco.
        const vel = 0.6 + (forcaEfetiva / 25) * 2.0;
        const nx = p.x + vxEfetivo * vel;
        const ny = p.y + vyEfetivo * vel;

        // Escala de cor idêntica ao resto do app (lib/windVector).
        const cor = corPorForca(forca || 15);

        ctx!.strokeStyle = cor;
        ctx!.beginPath();
        ctx!.moveTo(p.x, p.y);
        ctx!.lineTo(nx, ny);
        ctx!.stroke();

        p.x = nx;
        p.y = ny;
        p.idade++;

        // Renasce ao morrer ou ao sair da tela; sem isso as partículas se
        // acumulam na borda a favor do vento e o meio do mapa esvazia.
        if (p.idade > p.vida || nx < -10 || nx > largura + 10 || ny < -10 || ny > altura + 10) {
          nascer(p);
        }
      }

      frameRef.current = requestAnimationFrame(desenhar);
    }

    function iniciar() {
      cancelAnimationFrame(frameRef.current);
      dimensionar();
      projetarSpots();

      if (particulasRef.current.length === 0) {
        popular();
      }

      if (largura > 0 && altura > 0) {
        isRodando = true;
        frameRef.current = requestAnimationFrame(desenhar);
      }
    }

    function parar() {
      isRodando = false;
      cancelAnimationFrame(frameRef.current);
      if (ctx && largura > 0 && altura > 0) {
        ctx.clearRect(0, 0, largura, altura);
      }
    }

    function reprojetar() {
      projetarSpots();
      if (!isRodando && !paused && !document.hidden && !semMovimento.matches) {
        const { clientWidth, clientHeight } = container;
        if (clientWidth > 0 && clientHeight > 0) {
          iniciar();
        }
      }
    }
    reprojetarRef.current = reprojetar;

    function aoMover() {
      // Durante o movimento do mapa, apenas atualiza as projeções dos spots em pixels
      // sem interromper a animação nem zerar o canvas.
      projetarSpots();
    }

    function aoTerminarMover() {
      projetarSpots();
      if (!isRodando && !paused && !document.hidden && !semMovimento.matches) {
        iniciar();
      }
    }

    /* Aba em segundo plano: o rAF já é suspenso pelo navegador, mas parar
       explicitamente garante que nada acumule ao voltar. */
    function aoTrocarVisibilidade() {
      if (document.hidden) parar();
      else if (!paused && !semMovimento.matches) iniciar();
    }

    map.on('move', aoMover);
    map.on('zoom', aoMover);
    map.on('moveend', aoTerminarMover);
    map.on('zoomend', aoTerminarMover);
    map.on('resize', aoTerminarMover);
    document.addEventListener('visibilitychange', aoTrocarVisibilidade);

    // Respeita quem pediu menos animação no sistema — e economiza bateria.
    const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)');

    function iniciarQuandoPuder() {
      if (paused || semMovimento.matches) return;
      if (document.hidden) return; // visibilitychange assume daqui
      iniciar();
    }

    iniciarQuandoPuder();

    /* O container do Leaflet pode ter 0px no primeiro frame (mapa ainda
       dimensionando). Popular nesse instante gera campo vazio, então um
       observer redimensiona e repovoa quando a área real aparece. */
    const observer = new ResizeObserver(() => {
      if (paused || document.hidden || semMovimento.matches) return;
      const { clientWidth, clientHeight } = container;
      if (clientWidth > 0 && clientHeight > 0) {
        dimensionar();
        if (particulasRef.current.length === 0) {
          popular();
        }
        if (!isRodando) {
          iniciar();
        }
      }
    });
    observer.observe(container);

    return () => {
      reprojetarRef.current = null;
      parar();
      map.off('move', aoMover);
      map.off('zoom', aoMover);
      map.off('moveend', aoTerminarMover);
      map.off('zoomend', aoTerminarMover);
      map.off('resize', aoTerminarMover);
      document.removeEventListener('visibilitychange', aoTrocarVisibilidade);
      observer.disconnect();
      canvas.remove();
      canvasRef.current = null;
    };
  }, [map, paused]);

  return null;
}
