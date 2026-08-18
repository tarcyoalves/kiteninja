'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import type { Spot } from '@/types';
import { vetorVento, corPorForca, campoDeVento } from '@/lib/windVector';

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

  // Quando o conteúdo de spots chega ou atualiza, reprojeta o campo
  useEffect(() => {
    reprojetarRef.current?.();
  }, [spots]);

  useEffect(() => {
    const container = map.getContainer();
    if (!container) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'wind-particle-canvas';
    // pointer-events: none para permitir arrastar e clicar nos spots
    // z-index: 450 para ficar acima dos tiles do mapa (200) e abaixo dos marcadores (600)
    canvas.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:450;';
    container.appendChild(canvas);
    canvasRef.current = canvas;

    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) return;

    let largura = 0;
    let altura = 0;
    let isRodando = false;

    // Cache dos spots já projetados em pixel
    let projetados: { x: number; y: number; vx: number; vy: number; forca: number }[] = [];

    function dimensionar() {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.floor(clientWidth * dpr);
      const targetH = Math.floor(clientHeight * dpr);

      // Evita redefinir canvas.width se o tamanho for idêntico (redefinir limpa o canvas)
      if (largura === clientWidth && altura === clientHeight && canvas.width === targetW && canvas.height === targetH) {
        return;
      }

      largura = clientWidth;
      altura = clientHeight;
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${clientWidth}px`;
      canvas.style.height = `${clientHeight}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function projetarSpots() {
      if (!map) return;
      const validSpots = spotsRef.current.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
      
      if (validSpots.length === 0) {
        // Fallback para fluxo padrão do litoral Nordeste (Alísios ENE 17 nós)
        projetados = [
          { x: largura * 0.5, y: altura * 0.5, vx: -0.9, vy: 0.35, forca: 17 }
        ];
        return;
      }

      projetados = validSpots.map((s) => {
        const p = map.latLngToContainerPoint([s.lat, s.lng]);
        const { vx, vy } = vetorVento(s.windDirectionDeg ?? 65);
        return {
          x: p.x,
          y: p.y,
          vx: Number.isFinite(vx) ? vx : -0.9,
          vy: Number.isFinite(vy) ? vy : 0.35,
          forca: Math.max(s.currentKnots ?? 17, 10),
        };
      });
    }

    function campo(x: number, y: number) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { vx: -0.9, vy: 0.35, forca: 17 };
      }
      return campoDeVento(x, y, projetados);
    }

    function nascer(p: Particula) {
      p.x = Math.random() * (largura || 400);
      p.y = Math.random() * (altura || 600);
      p.idade = 0;
      p.vida = 50 + Math.random() * 80;
    }

    function popular() {
      if (largura <= 0 || altura <= 0) return;
      const alvo = Math.min(Math.round((largura * altura) / 4500), 300);
      const atual = particulasRef.current;
      atual.length = 0;
      for (let i = 0; i < alvo; i++) {
        const p: Particula = { x: 0, y: 0, idade: 0, vida: 0 };
        nascer(p);
        p.idade = Math.random() * p.vida;
        atual.push(p);
      }
    }

    function desenhar() {
      if (!isRodando || largura === 0 || altura === 0) return;

      // Efeito de rastro translúcido
      ctx!.globalCompositeOperation = 'destination-out';
      ctx!.fillStyle = 'rgba(0, 0, 0, 0.12)';
      ctx!.fillRect(0, 0, largura, altura);
      ctx!.globalCompositeOperation = 'source-over';

      ctx!.lineWidth = 1.4;
      ctx!.lineCap = 'round';

      for (const p of particulasRef.current) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          nascer(p);
          continue;
        }

        const { vx, vy, forca } = campo(p.x, p.y);
        const forcaEfetiva = Math.max(forca, 10);
        const vxEfetivo = !Number.isFinite(vx) || (vx === 0 && vy === 0) ? -0.9 : vx;
        const vyEfetivo = !Number.isFinite(vy) || (vx === 0 && vy === 0) ? 0.35 : vy;

        const vel = 0.7 + (forcaEfetiva / 25) * 2.1;
        const nx = p.x + vxEfetivo * vel;
        const ny = p.y + vyEfetivo * vel;

        if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
          nascer(p);
          continue;
        }

        const cor = corPorForca(forca || 17);
        ctx!.strokeStyle = cor;
        ctx!.beginPath();
        ctx!.moveTo(p.x, p.y);
        ctx!.lineTo(nx, ny);
        ctx!.stroke();

        p.x = nx;
        p.y = ny;
        p.idade++;

        if (p.idade > p.vida || nx < -15 || nx > largura + 15 || ny < -15 || ny > altura + 15) {
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
      if (!isRodando && !paused && !document.hidden) {
        iniciar();
      }
    }
    reprojetarRef.current = reprojetar;

    function aoMoverOuZoom() {
      projetarSpots();
    }

    function aoTerminarMoverOuZoom() {
      projetarSpots();
    }

    function aoTrocarVisibilidade() {
      if (document.hidden) parar();
      else if (!paused) iniciar();
    }

    map.on('move', aoMoverOuZoom);
    map.on('zoom', aoMoverOuZoom);
    map.on('moveend', aoTerminarMoverOuZoom);
    map.on('zoomend', aoTerminarMoverOuZoom);
    map.on('resize', () => {
      dimensionar();
      projetarSpots();
    });
    document.addEventListener('visibilitychange', aoTrocarVisibilidade);

    if (!paused && !document.hidden) {
      iniciar();
    }

    const observer = new ResizeObserver(() => {
      if (paused || document.hidden) return;
      const { clientWidth, clientHeight } = container;
      if (clientWidth > 0 && clientHeight > 0) {
        dimensionar();
        projetarSpots();
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
      map.off('move', aoMoverOuZoom);
      map.off('zoom', aoMoverOuZoom);
      map.off('moveend', aoTerminarMoverOuZoom);
      map.off('zoomend', aoTerminarMoverOuZoom);
      document.removeEventListener('visibilitychange', aoTrocarVisibilidade);
      observer.disconnect();
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    };
  }, [map, paused]);

  return null;
}
