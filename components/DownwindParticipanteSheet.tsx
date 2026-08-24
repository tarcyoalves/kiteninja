'use client';

import React, { useEffect, useState } from 'react';
import { Crown, Loader2, ShieldCheck, X } from 'lucide-react';
import { estadoSinal } from '@/lib/downwind';
import { haversineKm } from '@/lib/geo';
import { formatDistance } from '@/lib/geoFormat';
import { corDoUsuario, COR_SINAL } from '@/lib/downwindCores';
import { iniciaisDoNome } from '@/lib/htmlEscape';
import type { DownwindParticipanteMapa } from '@/lib/useDownwindPosicoes';

/**
 * Painel de detalhe ao tocar num participante do mapa. "Há quanto tempo
 * reportou" vem em destaque tipográfico de propósito — é o dado de segurança
 * desta tela, não um detalhe.
 */

interface DownwindParticipanteSheetProps {
  participante: DownwindParticipanteMapa;
  meuUserId: string;
  minhaPosicao: { lat: number; lng: number } | null;
  onFechar: () => void;
  onDefinirComoMeuApoio: () => Promise<void>;
}

export const DownwindParticipanteSheet: React.FC<DownwindParticipanteSheetProps> = ({
  participante: p,
  meuUserId,
  minhaPosicao,
  onFechar,
  onDefinirComoMeuApoio,
}) => {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  const [salvando, setSalvando] = useState(false);

  const { estado, minutosSemReportar } = estadoSinal(
    p.registradoEm ? new Date(p.registradoEm) : null,
    agora
  );
  const textoSinal =
    minutosSemReportar === null
      ? 'nunca reportou'
      : minutosSemReportar < 1
        ? 'há poucos segundos'
        : `há ${Math.floor(minutosSemReportar)} min`;

  const distanciaKm =
    minhaPosicao && p.lat !== null && p.lng !== null
      ? haversineKm(minhaPosicao, { lat: p.lat, lng: p.lng })
      : null;

  // Mostra o botão sempre que o alvo é um motorista ainda não vinculado a
  // mim — tanto faz se quem está olhando é o próprio velejador escolhendo o
  // seu apoio quanto o organizador designando por outro. A validação real
  // (mesmo downwind, papel certo, quem pode mexer no vínculo de quem) é do
  // servidor — lib/downwindAcesso.ts, `apoioValido` e `podeDefinirApoio`.
  // `souOrganizador` não filtra nada aqui de propósito: um 403 do servidor
  // quando não se aplica é aceitável, esconder o botão errado não é.
  const possoDefinirComoApoio = p.papel === 'apoio_terra' && p.userId !== meuUserId && !p.ehMeuApoio;

  return (
    <div
      // Sem .map-card-bottom (globals.css) de propósito: o componente pai já
      // reserva a altura do BottomNav e esta folha fica dentro da área do mapa.
      // A barra de ações do downwind também é um sibling shrink-0, então um
      // offset interno pequeno é suficiente.
      className="absolute inset-x-3 bottom-2 z-map-ui rounded-2xl bg-[#0F172A]/95 backdrop-blur-md border border-slate-700 shadow-2xl p-4 space-y-3"
      role="dialog"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center font-black text-sm text-slate-950 overflow-hidden"
            style={{ background: corDoUsuario(p.userId) }}
          >
            {p.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.avatarUrl} alt={p.nome} className="w-full h-full object-cover" />
            ) : (
              iniciaisDoNome(p.nome)
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="font-black text-sm text-white truncate">{p.nome}</h4>
              {p.ehOrganizador && <Crown size={13} className="text-amber-400 shrink-0" />}
            </div>
            <p className="text-[11px] text-slate-400">
              {p.papel === 'velejador' ? 'Velejador' : 'Apoio em terra'}
              {p.ehMeuApoio && ' · Seu apoio'}
              {p.souApoioDele && ' · Você é o apoio dele'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onFechar}
          className="shrink-0 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800"
          aria-label="Fechar"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="font-bold" style={{ color: COR_SINAL[estado] }}>
          Reportou {textoSinal}
        </span>
        {distanciaKm !== null && (
          <span className="text-slate-300 font-bold">{formatDistance(distanciaKm)} de você</span>
        )}
      </div>

      {possoDefinirComoApoio && (
        <button
          type="button"
          disabled={salvando}
          onClick={async () => {
            setSalvando(true);
            await onDefinirComoMeuApoio();
            setSalvando(false);
          }}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-black active:scale-95 transition-all disabled:opacity-60"
        >
          {salvando ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          Definir como meu apoio
        </button>
      )}
    </div>
  );
};
