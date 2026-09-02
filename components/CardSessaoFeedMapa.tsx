'use client';

import 'leaflet/dist/leaflet.css';

import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { opcoesDeTile } from '@/lib/mapTiles';

/**
 * A CAMADA DE CIMA da fluidez do feed (seção 3 do plano de rede social):
 * satélite REAL, só montado quando `CardSessaoFeed` decide (via
 * `IntersectionObserver`) que o card está na tela — nunca antes. Por isso
 * este componente é sempre carregado com `next/dynamic({ ssr: false })` no
 * card, igual ao padrão já usado em `DownwindResumoModal`/`MapView`.
 *
 * DIFERENÇA DELIBERADA para `components/DownwindResumoMapa.tsx` (que também
 * desenha trilha+satélite, mas dentro de um MODAL que o velejador abriu de
 * propósito para explorar o mapa): aqui é uma FIGURA dentro de um card de
 * feed que está rolando, não um mapa para interagir. Toda gesticulação que
 * poderia competir com o scroll da lista — arrastar, pinçar, roda do mouse,
 * duplo toque, teclado — fica DESLIGADA. Um mapa arrastável dentro de um
 * feed que rola verticalmente é a receita clássica de "o dedo do velejador
 * arrasta o mapa em vez de rolar a lista".
 */
interface CardSessaoFeedMapaProps {
  trilha: Array<[number, number, number]>;
  corTraco?: string;
}

function criarIconePonto(cor: string, letra: string): L.DivIcon {
  const html = `<div style="width:18px;height:18px;border-radius:9999px;background:${cor};border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;color:white;box-shadow:0 2px 6px rgba(0,0,0,.5);">${letra}</div>`;
  return L.divIcon({ html, className: 'custom-spot-marker', iconSize: [18, 18], iconAnchor: [9, 9] });
}

/** Enquadra o mapa na trilha inteira assim que monta — sem isso o mapa abriria
 * no centro do mundo (0,0) por um instante antes de qualquer `fitBounds`. */
function EnquadrarNaTrilha({ pontos }: { pontos: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    const raf = requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    return () => cancelAnimationFrame(raf);
  }, [map]);

  useEffect(() => {
    if (pontos.length === 0) return;
    if (pontos.length === 1) {
      map.setView(pontos[0], 14, { animate: false });
      return;
    }
    map.fitBounds(L.latLngBounds(pontos), { padding: [20, 20], animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pontos.length]);

  return null;
}

export const CardSessaoFeedMapa: React.FC<CardSessaoFeedMapaProps> = ({
  trilha,
  corTraco = '#22d3ee',
}) => {
  const pontos = useMemo<[number, number][]>(() => trilha.map(([lat, lng]) => [lat, lng]), [trilha]);
  const centroFallback: [number, number] = pontos[0] ?? [-4.5, -37.5];

  return (
    <MapContainer
      center={centroFallback}
      zoom={13}
      className="w-full h-full"
      style={{ background: '#090e1a' }}
      // É FIGURA, NÃO MAPA (ver comentário do arquivo) — todas as formas de
      // interagir com o Leaflet ficam desligadas, uma por uma, de propósito:
      zoomControl={false}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      touchZoom={false}
      keyboard={false}
      // Attribution continua ligado (padrão do Leaflet): Esri exige
      // atribuição visível nos termos de uso do World Imagery gratuito.
    >
      <TileLayer {...opcoesDeTile('satelite')} />
      <EnquadrarNaTrilha pontos={pontos} />

      {pontos.length > 1 && (
        <>
          <Marker position={pontos[0]} icon={criarIconePonto('#0ea5e9', 'A')} />
          <Marker position={pontos[pontos.length - 1]} icon={criarIconePonto('#10b981', 'B')} />
          {/* Casing em duas cores — mesmo raciocínio de DownwindResumoMapa:
              satélite varia demais de brilho (mar x areia x mata) para um
              halo de cor única se destacar em toda a trilha. */}
          <Polyline positions={pontos} pathOptions={{ color: '#000000', weight: 8, opacity: 0.35 }} />
          <Polyline positions={pontos} pathOptions={{ color: '#ffffff', weight: 5, opacity: 0.55 }} />
          <Polyline positions={pontos} pathOptions={{ color: corTraco, weight: 3, opacity: 0.95 }} />
        </>
      )}
    </MapContainer>
  );
};
