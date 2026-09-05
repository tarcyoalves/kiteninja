'use client';

import React, { useEffect, useRef } from 'react';
import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { DURACAO_TWEEN_MS, interpolar, rumoDoMovimento, vaisAnimar } from '@/lib/animacaoMarcador';
import { posicaoNoInstante } from '@/lib/reproducaoTrilha';
import type { PontoTrilha } from '@/lib/trilhaDownwind';

interface Props {
  /** Última leitura conhecida. Usada quando não há trilha para reproduzir. */
  position: [number, number];
  /**
   * Últimas posições em ordem cronológica.
   *
   * Com duas ou mais, o marcador REPRODUZ o percurso continuamente em vez de
   * deslizar de leitura em leitura — é a diferença entre andar e dar um
   * pulinho a cada 45 segundos. Ver lib/reproducaoTrilha.ts.
   */
  trilha?: PontoTrilha[];
  icon: L.DivIcon;
  zIndexOffset?: number;
  eventHandlers?: Parameters<typeof Marker>[0]['eventHandlers'];
}

/**
 * Marcador que DESLIZA até a leitura nova, em vez de teleportar.
 *
 * POR QUE IMPERATIVO, E NÃO ESTADO DO REACT
 *
 * A animação roda a 60 quadros por segundo. Guardar a posição intermediária
 * em `useState` re-renderizaria a árvore do mapa 60 vezes por segundo — com
 * vinte participantes num downwind, isso derruba o quadro no celular na
 * praia, que é exatamente o aparelho que precisa aguentar.
 *
 * Então o React só renderiza quando chega leitura nova (a cada ~30s), e o
 * movimento entre uma e outra acontece direto no objeto do Leaflet, via
 * `setLatLng` dentro de um `requestAnimationFrame`. É a mesma técnica que os
 * apps de corrida usam.
 *
 * O `<Marker>` nasce já na posição de destino e é o efeito que o traz de
 * volta para a origem antes de animar: assim, se a animação não puder rodar
 * (aba escondida, `requestAnimationFrame` estrangulado), o marcador fica na
 * posição CERTA, não na antiga. Numa tela de segurança, o modo de falha tem
 * que ser "sem animação", nunca "posição velha".
 */
export const MarcadorSuave: React.FC<Props> = ({
  position,
  trilha,
  icon,
  zIndexOffset,
  eventHandlers,
}) => {
  const markerRef = useRef<L.Marker | null>(null);
  /** Onde o marcador está DESENHADO agora (não onde a prop diz). */
  const atualRef = useRef<[number, number]>(position);
  const frameRef = useRef<number | null>(null);
  /** Último rumo aplicado, para reaplicar quando o ícone é reconstruído. */
  const rumoRef = useRef<number | null>(null);

  /**
   * Reaplica a seta depois de o ícone ser trocado.
   *
   * O ícone do velejador é reconstruído a cada 15s (o relógio que atualiza o
   * anel de "sem sinal"), e o Leaflet troca o elemento inteiro — levando junto
   * a rotação que tinha sido aplicada no DOM. Sem isto, a seta sumia a cada
   * 15 segundos e só voltava na leitura seguinte.
   */
  useEffect(() => {
    const marker = markerRef.current;
    const rumo = rumoRef.current;
    if (!marker || rumo === null) return;
    const setaEl = marker.getElement()?.querySelector<HTMLElement>('[data-seta]');
    if (!setaEl) return;
    setaEl.style.transform = `rotate(${rumo}deg)`;
    setaEl.style.opacity = '1';
  }, [icon]);

  const reproduzindo = Array.isArray(trilha) && trilha.length >= 2;

  /**
   * MODO REPRODUÇÃO: o marcador anda sem parar.
   *
   * O laço só se reagenda enquanto há trilha à frente (`noFim === false`).
   * Chegando ao último ponto conhecido, ele para de rodar até chegar leitura
   * nova — sem isso, vinte marcadores parados n'água manteriam vinte laços de
   * animação acordados a 60Hz, gastando bateria para não desenhar movimento
   * nenhum.
   */
  useEffect(() => {
    if (!reproduzindo) return;
    const marker = markerRef.current;
    if (!marker) return;
    let vivo = true;
    let frame: number | null = null;
    /*
     * `performance.now()` e não `Date.now()`: o que importa é quanto tempo
     * passou desde que ESTA trilha chegou, não a hora do aparelho. Os carimbos
     * dos pontos vêm do relógio do servidor, e um celular desacertado deixaria
     * o marcador travado no começo ou no fim — ver lib/reproducaoTrilha.ts.
     * `performance.now()` ainda é monotônico: não anda para trás se o sistema
     * acertar a hora no meio da travessia.
     */
    const chegouEm = performance.now();

    const passo = () => {
      const r = posicaoNoInstante(trilha!, performance.now() - chegouEm);
      if (!vivo || !r) return;
      marker.setLatLng([r.lat, r.lng]);
      atualRef.current = [r.lat, r.lng];

      if (r.rumoGraus !== null) {
        rumoRef.current = r.rumoGraus;
        const setaEl = marker.getElement()?.querySelector<HTMLElement>('[data-seta]');
        if (setaEl) {
          setaEl.style.transform = `rotate(${r.rumoGraus}deg)`;
          setaEl.style.opacity = '1';
        }
      }

      if (!r.noFim) frame = requestAnimationFrame(passo);
      else frame = null;
    };

    frame = requestAnimationFrame(passo);
    return () => {
      vivo = false;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [reproduzindo, trilha]);

  useEffect(() => {
    // Reprodução no comando: o tween por leitura brigaria com ela pelo mesmo
    // marcador, e o resultado seria o boneco tremendo entre duas posições.
    if (reproduzindo) return;
    const marker = markerRef.current;
    const de = atualRef.current;
    const para = position;

    if (!marker || (de[0] === para[0] && de[1] === para[1])) {
      atualRef.current = para;
      return;
    }

    const origem = { lat: de[0], lng: de[1] };
    const destino = { lat: para[0], lng: para[1] };

    /*
     * A SETA aponta para onde a pessoa está indo — é o que faz o marcador ler
     * como "movimento" e não como "ponto que mudou de lugar".
     *
     * Procurada no DOM do próprio ícone (`data-seta`) em vez de vir por prop:
     * o ícone é HTML de `L.divIcon`, e reconstruí-lo a cada leitura só para
     * mudar um ângulo trocaria o elemento inteiro no meio da animação — o
     * avatar piscaria a cada 30 segundos.
     *
     * Sem rumo (pessoa parada) a seta some. Ver lib/animacaoMarcador.ts.
     */
    const rumo = rumoDoMovimento(origem, destino);
    rumoRef.current = rumo;
    const setaEl = marker.getElement()?.querySelector<HTMLElement>('[data-seta]');
    if (setaEl) {
      if (rumo === null) {
        setaEl.style.opacity = '0';
      } else {
        setaEl.style.transform = `rotate(${rumo}deg)`;
        setaEl.style.opacity = '1';
      }
    }

    // Salto grande demais para animar: vai direto. Ver o porquê em
    // lib/animacaoMarcador.ts.
    if (!vaisAnimar(origem, destino)) {
      marker.setLatLng(para);
      atualRef.current = para;
      return;
    }

    const inicio = performance.now();
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);

    const passo = (agora: number) => {
      const fracao = (agora - inicio) / DURACAO_TWEEN_MS;
      const p = interpolar(origem, destino, fracao);
      marker.setLatLng([p.lat, p.lng]);
      atualRef.current = [p.lat, p.lng];
      if (fracao < 1) {
        frameRef.current = requestAnimationFrame(passo);
      } else {
        // Encerra exatamente no destino: acumular erro de ponto flutuante ao
        // longo de uma travessia de três horas deslocaria o marcador.
        marker.setLatLng(para);
        atualRef.current = para;
        frameRef.current = null;
      }
    };

    frameRef.current = requestAnimationFrame(passo);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [position, reproduzindo]);

  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={icon}
      zIndexOffset={zIndexOffset}
      eventHandlers={eventHandlers}
    />
  );
};
