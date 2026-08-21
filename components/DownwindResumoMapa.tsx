'use client';

import 'leaflet/dist/leaflet.css';

import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';

/**
 * Mini-mapa do resumo pós-downwind: a trilha de UM participante selecionado
 * (nunca todos ao mesmo tempo — mesma decisão de "sopa visual" do mapa ao
 * vivo, docs/PLANO-DOWNWIND-MAPA.md), estática, sem polling. Client-only via
 * `dynamic(..., { ssr: false })` — mesmo padrão de components/DownwindMapa.tsx.
 */

function criarIconePonto(cor: string, letra: string): L.DivIcon {
  const html = `<div style="width:20px;height:20px;border-radius:9999px;background:${cor};border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;color:white;box-shadow:0 2px 6px rgba(0,0,0,.5);">${letra}</div>`;
  return L.divIcon({ html, className: 'custom-spot-marker', iconSize: [20, 20], iconAnchor: [10, 10] });
}

/** Enquadra o mapa em todos os pontos disponíveis (trilha + saída/chegada). */
function EnquadrarBounds({ pontos }: { pontos: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    const remedir = () => map.invalidateSize({ animate: false });
    const raf = requestAnimationFrame(remedir);
    return () => cancelAnimationFrame(raf);
  }, [map]);

  useEffect(() => {
    if (pontos.length === 0) return;
    if (pontos.length === 1) {
      map.setView(pontos[0], 14, { animate: false });
      return;
    }
    map.fitBounds(L.latLngBounds(pontos), { padding: [24, 24], animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pontos.length]);

  return null;
}

interface DownwindResumoMapaProps {
  saida: { lat: number; lng: number } | null;
  chegada: { lat: number; lng: number } | null;
  trilha: Array<[number, number, number]>;
  cor: string;
}

export const DownwindResumoMapa: React.FC<DownwindResumoMapaProps> = ({
  saida,
  chegada,
  trilha,
  cor,
}) => {
  const pontosTrilha = useMemo<[number, number][]>(
    () => trilha.map(([lat, lng]) => [lat, lng]),
    [trilha]
  );
  const todosPontos = useMemo<[number, number][]>(() => {
    const p: [number, number][] = [...pontosTrilha];
    if (saida) p.push([saida.lat, saida.lng]);
    if (chegada) p.push([chegada.lat, chegada.lng]);
    return p;
  }, [pontosTrilha, saida, chegada]);

  const centroFallback: [number, number] = todosPontos[0] ?? [-4.5, -37.5];

  return (
    <MapContainer
      center={centroFallback}
      zoom={13}
      zoomControl={false}
      attributionControl={false}
      dragging={true}
      scrollWheelZoom={false}
      className="w-full h-full"
      style={{ background: '#090e1a' }}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="" />
      <EnquadrarBounds pontos={todosPontos} />

      {saida && <Marker position={[saida.lat, saida.lng]} icon={criarIconePonto('#0ea5e9', 'A')} />}
      {chegada && <Marker position={[chegada.lat, chegada.lng]} icon={criarIconePonto('#10b981', 'B')} />}

      {pontosTrilha.length > 1 && (
        <>
          <Polyline positions={pontosTrilha} pathOptions={{ color: '#ffffff', weight: 6, opacity: 0.25 }} />
          <Polyline positions={pontosTrilha} pathOptions={{ color: cor, weight: 3, opacity: 0.95 }} />
        </>
      )}
    </MapContainer>
  );
};
