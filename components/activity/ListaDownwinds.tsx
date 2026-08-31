'use client';

import React from 'react';
import { Route, Users, Radio, Lock, Globe, Link2, Check } from 'lucide-react';
import type { DownwindResumo } from '../../types';

/**
 * A lista de downwinds visíveis ao velejador.
 *
 * POR QUE ESTA TELA EXISTE
 *
 * Não havia lista nenhuma. `GET /api/downwind` não existia (devolvia 405), e
 * um downwind `privado` não gera evento — então ele não aparecia nem na aba
 * Eventos. Um velejador criou um downwind, compartilhou o link, e **nem ele
 * mesmo** conseguia ver o que tinha criado.
 *
 * Por isso o cartão mostra explicitamente a VISIBILIDADE: era exatamente a
 * informação que faltava para entender por que "não apareceu nada". Um
 * downwind privado é privado de propósito, mas quem o criou precisa ver isso
 * escrito, não deduzir do silêncio.
 */

const ROTULO_STATUS: Record<DownwindResumo['status'], string> = {
  aberto: 'Aberto',
  em_andamento: 'Na água agora',
  encerrado: 'Encerrado',
  cancelado: 'Cancelado',
};

const COR_STATUS: Record<DownwindResumo['status'], string> = {
  aberto: 'bg-cyan-500/15 text-cyan-300 border-cyan-400/30',
  em_andamento: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  encerrado: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
  cancelado: 'bg-slate-700/40 text-slate-500 border-slate-600/40',
};

function formatarQuando(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface CartaoProps {
  dw: DownwindResumo;
  onAbrir: (id: string) => void;
  onCopiarLink: (id: string) => void;
  linkCopiadoId: string | null;
}

const CartaoDownwind: React.FC<CartaoProps> = ({ dw, onAbrir, onCopiarLink, linkCopiadoId }) => {
  const quando = formatarQuando(dw.iniciadoEm ?? dw.previstoPara);
  const trajeto = [dw.spotSaidaNome, dw.spotChegadaNome].filter(Boolean).join(' → ');

  return (
    <div className="p-3.5 rounded-2xl bg-[#0F172A] border border-slate-700/70 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-black text-sm text-white truncate flex items-center gap-1.5">
            <Route size={15} className="text-cyan-400 shrink-0" />
            <span className="truncate">{dw.nome}</span>
          </h4>
          {trajeto && <p className="mt-0.5 text-[11px] text-slate-400 truncate">{trajeto}</p>}
        </div>
        <span
          className={`shrink-0 px-2 py-0.5 rounded-lg border text-[10px] font-black ${COR_STATUS[dw.status]}`}
        >
          {ROTULO_STATUS[dw.status]}
        </span>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-slate-400 flex-wrap">
        <span className="flex items-center gap-1">
          <Users size={12} />
          {dw.participantesCount}
        </span>
        {/*
          A visibilidade fica visível de propósito: "criei e não apareceu para
          ninguém" era exatamente a confusão que a falta desta lista causava.
        */}
        <span className="flex items-center gap-1">
          {dw.visibilidade === 'comunidade' ? (
            <>
              <Globe size={12} /> Comunidade
            </>
          ) : (
            <>
              <Lock size={12} /> Só por convite
            </>
          )}
        </span>
        {quando && <span>{quando}</span>}
        {!dw.criadoPorMim && <span className="truncate">por {dw.criadorNome}</span>}
      </div>

      <div className="flex items-center gap-2">
        {dw.status === 'em_andamento' && (
          <button
            type="button"
            onClick={() => onAbrir(dw.id)}
            className="flex-1 h-9 rounded-xl bg-emerald-500 text-slate-950 font-black text-xs active:scale-95 transition-transform flex items-center justify-center gap-1.5"
          >
            <Radio size={14} />
            Ver ao vivo
          </button>
        )}
        {dw.criadoPorMim && dw.status !== 'encerrado' && dw.status !== 'cancelado' && (
          <button
            type="button"
            onClick={() => onCopiarLink(dw.id)}
            className="flex-1 h-9 rounded-xl bg-slate-800 border border-slate-600 text-slate-200 font-black text-xs active:scale-95 transition-transform flex items-center justify-center gap-1.5"
          >
            {linkCopiadoId === dw.id ? (
              <>
                <Check size={14} className="text-emerald-400" />
                Copiado
              </>
            ) : (
              <>
                <Link2 size={14} />
                Convidar
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

interface Props {
  downwinds: DownwindResumo[];
  onAbrir: (id: string) => void;
  onCopiarLink: (id: string) => void;
  linkCopiadoId: string | null;
}

export const ListaDownwinds: React.FC<Props> = ({
  downwinds,
  onAbrir,
  onCopiarLink,
  linkCopiadoId,
}) => {
  if (downwinds.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <h3 className="text-xs font-black text-slate-400 uppercase tracking-wide px-0.5">
        Downwinds ({downwinds.length})
      </h3>
      {downwinds.map((dw) => (
        <CartaoDownwind
          key={dw.id}
          dw={dw}
          onAbrir={onAbrir}
          onCopiarLink={onCopiarLink}
          linkCopiadoId={linkCopiadoId}
        />
      ))}
    </div>
  );
};
