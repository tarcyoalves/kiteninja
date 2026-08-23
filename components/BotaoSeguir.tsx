'use client';

import React, { memo, useCallback, useEffect, useState } from 'react';
import { Check, Loader2, UserPlus, Users } from 'lucide-react';
import { rotuloBotaoSeguir } from '@/lib/social';
import type { RelacaoRider } from '@/types';

interface BotaoSeguirProps {
  riderId: string;
  /** Relação atual, vinda do servidor (busca ou perfil). */
  relacao: RelacaoRider;
  /**
   * Avisa o pai da NOVA relação assim que o toque acontece (otimista) e de
   * novo quando o servidor confirma — para uma lista (BuscarVelejadores) ou
   * um cabeçalho de perfil (contador de seguidores) refletirem a mudança sem
   * esperar um refetch completo.
   */
  onChangeRelacao?: (relacao: RelacaoRider) => void;
  className?: string;
}

/** A "próxima relação" depois de alternar seguir/deixar de seguir — pura o
 * suficiente para não precisar de mock de rede para raciocinar sobre ela,
 * mas vive aqui (não em lib/social.ts) porque só faz sentido junto do gesto
 * de alternar, que é deste componente. */
function proximaRelacao(atual: RelacaoRider, vouSeguir: boolean): RelacaoRider {
  if (vouSeguir) {
    return atual === 'segue_voce' ? 'amigos' : 'seguindo';
  }
  return atual === 'amigos' ? 'segue_voce' : 'nenhuma';
}

/**
 * Botão Seguir/Deixar de seguir (seção 4.2 do plano de rede social) — usado
 * inline na busca de velejadores e no cabeçalho do perfil público.
 *
 * Estado otimista, mesmo padrão da curtida em CardSessaoFeed.tsx: pinta no
 * toque, a requisição vai atrás; se falhar, reverte para a relação que veio
 * por prop (a última verdade confirmada do servidor).
 */
export const BotaoSeguir: React.FC<BotaoSeguirProps> = memo(function BotaoSeguir({
  riderId,
  relacao,
  onChangeRelacao,
  className = '',
}) {
  const [otimista, setOtimista] = useState<RelacaoRider | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Nova verdade do servidor chegou (ex.: perfil recarregado) — o override
  // local perde a validade, mesmo raciocínio do useEffect de CardSessaoFeed.
  useEffect(() => {
    setOtimista(null);
  }, [relacao]);

  const atual = otimista ?? relacao;
  const jaSigo = atual === 'seguindo' || atual === 'amigos';

  const alternar = useCallback(() => {
    if (enviando) return;
    const vouSeguir = !jaSigo;
    const prevista = proximaRelacao(atual, vouSeguir);
    setOtimista(prevista);
    onChangeRelacao?.(prevista);
    setEnviando(true);

    fetch(`/api/riders/${riderId}/follow`, { method: vouSeguir ? 'POST' : 'DELETE' })
      .then((res) => {
        if (!res.ok) throw new Error('seguir falhou');
        return res.json() as Promise<{ relacao: RelacaoRider }>;
      })
      .then((body) => {
        setOtimista(body.relacao);
        onChangeRelacao?.(body.relacao);
      })
      .catch(() => {
        // Reverte: some o override e volta a mostrar a relação que veio por
        // prop — nunca deixa o botão preso num estado que a rede não confirmou.
        setOtimista(null);
        onChangeRelacao?.(relacao);
      })
      .finally(() => setEnviando(false));
  }, [enviando, jaSigo, atual, riderId, onChangeRelacao, relacao]);

  const rotulo = rotuloBotaoSeguir(atual);

  return (
    <button
      type="button"
      onClick={alternar}
      disabled={enviando}
      aria-pressed={jaSigo}
      className={`inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full text-xs font-black transition-all active:scale-95 disabled:opacity-60 shrink-0 ${
        atual === 'amigos'
          ? 'bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40'
          : jaSigo
            ? 'bg-slate-800 text-slate-300 border border-slate-700 hover:border-slate-600'
            : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400 shadow-md shadow-cyan-500/25'
      } ${className}`}
    >
      {enviando ? (
        <Loader2 size={13} className="animate-spin" />
      ) : atual === 'amigos' ? (
        <Users size={13} />
      ) : jaSigo ? (
        <Check size={13} />
      ) : (
        <UserPlus size={13} />
      )}
      <span>{rotulo}</span>
    </button>
  );
});
