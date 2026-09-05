'use client';

import 'leaflet/dist/leaflet.css';

import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { opcoesDeTile } from '@/lib/mapTiles';
import { escaparHtml, iniciaisDoNome } from '@/lib/htmlEscape';
import type { PontoTrilha } from '@/lib/trilhaDownwind';

interface Props {
  trilha: PontoTrilha[];
  ultimaPosicao: { lat: number; lng: number; registradoEm: string } | null;
  nome: string;
}

/**
 * Mapa da página pública de acompanhamento do velejo solo.
 *
 * DELIBERADAMENTE SEPARADO de `DownwindMapa`: aquele desenha N participantes,
 * papéis, cores por pessoa, apoio vinculado e estados de sinal — e é montado
 * dentro do app, com providers. Aqui é uma pessoa só, sem conta do outro lado,
 * numa página que não carrega nada do app. Reusar aquele componente traria
 * junto todo um domínio que não existe nesta tela, e amarraria as duas telas:
 * mexer no mapa do downwind passaria a poder quebrar a página do amigo no
 * carro.
 *
 * O mapa AQUI é para interagir — quem está no carro quer arrastar e dar zoom
 * para entender onde é o acesso à praia mais próximo. Por isso, ao contrário
 * do mapa do card do feed, os gestos ficam ligados.
 */
function SegueOVelejador({ posicao }: { posicao: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (!posicao) return;
    /*
     * `panTo`, não `setView`: recentralizar com zoom a cada 30s tiraria o
     * zoom que a pessoa acabou de dar para procurar a estrada de acesso. O
     * mapa acompanha, mas não desfaz o que ela fez.
     */
    map.panTo([posicao.lat, posicao.lng], { animate: true });
  }, [map, posicao]);
  return null;
}

export const TrilhaAoVivoMapa: React.FC<Props> = ({ trilha, ultimaPosicao, nome }) => {
  const pontos = useMemo<[number, number][]>(
    () => trilha.map((p) => [p[0], p[1]]),
    [trilha]
  );

  const centro: [number, number] = ultimaPosicao
    ? [ultimaPosicao.lat, ultimaPosicao.lng]
    : pontos.length > 0
      ? pontos[pontos.length - 1]
      : // Sem posição nenhuma ainda: o mapa abre no litoral do RN em vez de no
        // meio do Atlântico (0,0), que é onde um centro "vazio" cairia.
        [-5.0, -36.5];

  const icone = useMemo(
    () =>
      L.divIcon({
        className: '',
        html: `<div style="width:38px;height:38px;border-radius:9999px;border:3px solid #22d3ee;background:#0f172a;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;color:#22d3ee;box-shadow:0 0 0 4px rgba(34,211,238,.18);">${escaparHtml(
          iniciaisDoNome(nome)
        )}</div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      }),
    [nome]
  );

  return (
    <MapContainer
      center={centro}
      zoom={14}
      className="w-full h-full"
      zoomControl={false}
      attributionControl={false}
    >
      <TileLayer {...opcoesDeTile('satelite')} />
      {pontos.length > 1 && (
        <>
          {/* Três traços: contorno escuro, halo claro e a cor por cima. É o
              que mantém a trilha legível tanto sobre areia quanto sobre mar —
              mesma receita de CardSessaoFeedMapa. */}
          <Polyline positions={pontos} pathOptions={{ color: '#000000', weight: 8, opacity: 0.35 }} />
          <Polyline positions={pontos} pathOptions={{ color: '#ffffff', weight: 5, opacity: 0.55 }} />
          <Polyline positions={pontos} pathOptions={{ color: '#22d3ee', weight: 3, opacity: 0.95 }} />
        </>
      )}
      {ultimaPosicao && (
        <Marker position={[ultimaPosicao.lat, ultimaPosicao.lng]} icon={icone} />
      )}
      <SegueOVelejador posicao={ultimaPosicao} />
    </MapContainer>
  );
};
