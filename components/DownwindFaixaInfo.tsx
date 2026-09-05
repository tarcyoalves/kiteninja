'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { AlertTriangle, Users } from 'lucide-react';
import { contarSemSinal, progressoDownwind, velejadoresPendentes } from '@/lib/downwind';
import { haversineKm } from '@/lib/geo';
import { formatDistance } from '@/lib/geoFormat';
import type { DownwindParticipanteMapa } from '@/lib/useDownwindPosicoes';
import type { DownwindPonto } from '@/context/DownwindContext';

/**
 * Faixa fixa sobre o mapa, respondendo as quatro perguntas que de fato
 * aparecem na água (docs/PLANO-DOWNWIND-MAPA.md): cadê o pessoal, alguém
 * ficou pra trás, cadê o meu carro, quantos estão sem sinal. Cada item só
 * aparece quando há dado real para sustentá-lo — nunca inventa "0" quando na
 * verdade é "não sei".
 */

interface DownwindFaixaInfoProps {
  meuUserId: string;
  saida: DownwindPonto | null;
  chegada: DownwindPonto | null;
  participantes: DownwindParticipanteMapa[];
}

export const DownwindFaixaInfo: React.FC<DownwindFaixaInfoProps> = ({
  meuUserId,
  saida,
  chegada,
  participantes,
}) => {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  const velejadores = useMemo(
    () => participantes.filter((p) => p.papel === 'velejador'),
    [participantes]
  );

  const pendentes = useMemo(
    () =>
      velejadoresPendentes(
        velejadores.map((p) => ({
          userId: p.userId,
          papel: p.papel,
          ehOrganizador: p.ehOrganizador,
          estado: p.estado,
        }))
      ),
    [velejadores]
  );

  const maisAtras = useMemo(() => {
    if (!chegada || !saida) return null;
    let pior: { nome: string; percentual: number } | null = null;
    for (const p of velejadores) {
      if (p.estado !== 'navegando' || p.lat === null || p.lng === null) continue;
      const { percentual } = progressoDownwind(saida, chegada, { lat: p.lat, lng: p.lng });
      if (!pior || percentual < pior.percentual) pior = { nome: p.nome, percentual };
    }
    return pior;
  }, [velejadores, saida, chegada]);

  const meuApoio = participantes.find((p) => p.ehMeuApoio);
  const meuApoioDistKm =
    meuApoio && meuApoio.lat !== null && meuApoio.lng !== null
      ? (() => {
          const eu = participantes.find((p) => p.userId === meuUserId);
          if (!eu || eu.lat === null || eu.lng === null) return null;
          return haversineKm({ lat: eu.lat, lng: eu.lng }, { lat: meuApoio.lat!, lng: meuApoio.lng! });
        })()
      : null;

  // Só quem disse que está na água. Contar `confirmado` aqui anunciava "6 sem
  // sinal" sobre gente que ainda estava tomando café — ver contarSemSinal.
  const semSinal = useMemo(() => contarSemSinal(participantes, agora), [participantes, agora]);

  const itens: string[] = [];
  if (velejadores.length > 0) itens.push(`Na água: ${pendentes.length} de ${velejadores.length}`);
  if (maisAtras) itens.push(`Mais atrás: ${maisAtras.nome} (${Math.round(maisAtras.percentual)}%)`);
  if (meuApoioDistKm !== null) itens.push(`Seu apoio: ${formatDistance(meuApoioDistKm)}`);

  if (itens.length === 0 && semSinal === 0) return null;

  return (
    <div className="absolute top-2 left-2 right-2 z-map-ui flex flex-wrap items-center gap-1.5 pointer-events-none">
      {itens.map((texto, i) => (
        <span
          key={i}
          className="px-2.5 py-1 rounded-full bg-[#0F172A]/90 backdrop-blur-sm border border-slate-700/80 text-[10px] font-bold text-slate-200 flex items-center gap-1"
        >
          <Users size={10} className="text-cyan-400 shrink-0" />
          {texto}
        </span>
      ))}
      {semSinal > 0 && (
        <span className="px-2.5 py-1 rounded-full bg-rose-950/90 backdrop-blur-sm border border-rose-700/60 text-[10px] font-bold text-rose-300 flex items-center gap-1">
          <AlertTriangle size={10} className="shrink-0" />
          {semSinal} sem sinal
        </span>
      )}
    </div>
  );
};
