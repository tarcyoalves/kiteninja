'use client';

import React, { useCallback, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Ban, LifeBuoy, Loader2, MessageCircle, Navigation, Octagon, Route } from 'lucide-react';
import { useDownwind } from '../context/DownwindContext';
import { useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';
import { useSosHold } from '../lib/useSosHold';
import { useDownwindBeacon } from '../lib/useDownwindBeacon';
import { useDownwindPosicoes } from '../lib/useDownwindPosicoes';
import { DownwindChat } from '../components/DownwindChat';

// Leaflet é client-only — mesmo padrão de views/MapView.tsx.
const DownwindMapa = dynamic(
  () => import('../components/DownwindMapa').then((m) => m.DownwindMapa),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center bg-[#090e1a] text-cyan-400">
        <Loader2 size={28} className="animate-spin" />
      </div>
    ),
  }
);

/**
 * Tela de takeover do mapa ao vivo do downwind.
 *
 * O mapa em si (marcadores, trilha) chega na Fase 5 — este componente já
 * carrega a estrutura definitiva: cabeçalho, ações de ciclo de vida (iniciar,
 * encerrar minha travessia, encerrar/cancelar o downwind do grupo pelo
 * organizador) e o chat privado do grupo (única saída sem encerrar).
 *
 * app/page.tsx renderiza isto NO LUGAR das abas normais, sem BottomNav,
 * enquanto `downwindAtivo` existir — ver a decisão de produto documentada em
 * context/DownwindContext.tsx.
 */

/** Tempo de hold para confirmar "Encerrei o velejo" — mesmo padrão de
 * lib/useSosHold.ts, mas mais longo: sair da água é decisão, não reflexo. */
const HOLD_ENCERRAR_MS = 1500;

function usePressAndHold(duracaoMs: number, aoCompletar: () => void) {
  const [progresso, setProgresso] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inicio = useRef(0);
  const disparado = useRef(false);

  const iniciar = useCallback(() => {
    disparado.current = false;
    inicio.current = Date.now();
    setProgresso(0);
    timer.current = setInterval(() => {
      const p = Math.min((Date.now() - inicio.current) / duracaoMs, 1);
      setProgresso(p);
      if (p >= 1 && !disparado.current) {
        disparado.current = true;
        if (timer.current) clearInterval(timer.current);
        aoCompletar();
      }
    }, 16);
  }, [duracaoMs, aoCompletar]);

  const cancelar = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (!disparado.current) setProgresso(0);
  }, []);

  return { progresso, iniciar, cancelar };
}

export const DownwindAoVivoView: React.FC = () => {
  const { downwindAtivo, encerrarMinhaParticipacao, encerrarDownwind, cancelarDownwind } =
    useDownwind();
  const { myActiveSos, fetchActiveSos } = useKiteData();
  const { user } = useAuth();
  const [chatAberto, setChatAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);

  // Só reporta/consulta posição quando o downwind de fato está em andamento
  // (aberto ainda não tem ninguém navegando) — ver lib/downwindAcesso.ts.
  const emAndamento = downwindAtivo?.status === 'em_andamento';
  useDownwindBeacon(downwindAtivo?.id ?? null, emAndamento);
  const { participantes, minhaTrilha } = useDownwindPosicoes(
    downwindAtivo?.id ?? null,
    !emAndamento
  );

  const sos = useSosHold({
    hasActiveSos: Boolean(myActiveSos),
    onSosTriggered: () => fetchActiveSos(),
  });

  const encerrarVelejo = useCallback(async () => {
    setProcessando(true);
    const res = await encerrarMinhaParticipacao('encerrado');
    setProcessando(false);
    if (!res.ok) setErro(res.error ?? 'Falha ao encerrar.');
  }, [encerrarMinhaParticipacao]);

  const holdEncerrar = usePressAndHold(HOLD_ENCERRAR_MS, () => {
    try {
      navigator.vibrate?.(200);
    } catch {
      // vibração é cortesia
    }
    encerrarVelejo();
  });

  if (!downwindAtivo) return null;
  const { minhaParticipacao } = downwindAtivo;
  const souOrganizador = minhaParticipacao.ehOrganizador;

  return (
    <div className="flex flex-col app-viewport relative overflow-hidden bg-[#090e1a]">
      {/* Cabeçalho: nome do downwind + status, sempre visível — é o que
          lembra o velejador de que ele está preso nesta tela e por quê. */}
      <div className="shrink-0 px-4 py-3 bg-[#0F172A] border-b border-slate-800 flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="font-black text-sm text-white truncate">{downwindAtivo.nome}</h2>
          <p className="text-[11px] text-slate-400">
            {downwindAtivo.status === 'aberto' ? 'Ainda não começou' : 'Downwind em andamento'} ·{' '}
            {minhaParticipacao.papel === 'velejador' ? 'Velejador' : 'Apoio em terra'}
            {souOrganizador ? ' · Organizador' : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setChatAberto(true)}
          className="shrink-0 p-2.5 rounded-full bg-slate-800 text-cyan-400 active:scale-95 transition-all"
          aria-label="Abrir chat do grupo"
        >
          <MessageCircle size={18} />
        </button>
      </div>

      <div className="flex-1 min-h-0 relative">
        {downwindAtivo.status === 'aberto' ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-slate-500 bg-[#090e1a]">
            <Route size={40} className="opacity-40" />
            <p className="text-xs max-w-[240px] text-center">
              O downwind ainda não começou. O mapa ao vivo liga assim que a
              travessia iniciar.
            </p>
          </div>
        ) : user ? (
          <DownwindMapa
            meuUserId={user.id}
            saida={downwindAtivo.saida}
            chegada={downwindAtivo.chegada}
            participantes={participantes}
            minhaTrilha={minhaTrilha}
          />
        ) : null}
      </div>

      {erro && (
        <div className="shrink-0 px-4 py-2 bg-rose-950/60 border-t border-rose-800/50 text-rose-300 text-xs">
          {erro}
        </div>
      )}

      {/* Faixa de ações fixa. SOS sempre acessível (segurar 800ms), Encerrar
          velejo exige segurar 1500ms — decisão de produto (ver useSosHold e
          o comentário de trava real em context/DownwindContext.tsx). */}
      <div className="shrink-0 px-4 py-3 bg-[#0F172A] border-t border-slate-800 flex items-center justify-center gap-3 overlay-safe-bottom">
        {!myActiveSos && (
          <button
            type="button"
            onPointerDown={sos.startHold}
            onPointerUp={sos.cancelHold}
            onPointerCancel={sos.cancelHold}
            onPointerLeave={sos.cancelHold}
            disabled={sos.sending}
            className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-rose-950 border border-rose-700/60 text-rose-300 active:scale-95 transition-all"
            aria-label="Segurar para disparar SOS"
          >
            <LifeBuoy size={16} className={sos.sending ? 'animate-pulse' : undefined} />
            <span className="text-[10px] font-bold">{sos.sending ? '...' : 'SOS'}</span>
          </button>
        )}

        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            holdEncerrar.iniciar();
          }}
          onPointerUp={holdEncerrar.cancelar}
          onPointerCancel={holdEncerrar.cancelar}
          onPointerLeave={holdEncerrar.cancelar}
          disabled={processando}
          className="relative flex flex-col items-center gap-1 px-5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 active:scale-95 transition-all overflow-hidden"
          aria-label="Segurar para encerrar o velejo"
        >
          <div
            className="absolute inset-0 bg-cyan-500/30 origin-left transition-transform"
            style={{ transform: `scaleX(${holdEncerrar.progresso})` }}
          />
          <Navigation size={16} className="relative" />
          <span className="text-[10px] font-bold relative">Encerrar velejo</span>
        </button>

        {souOrganizador && downwindAtivo.status === 'aberto' && (
          // Cancelar só faz sentido ANTES de sair da praia: uma vez
          // 'em_andamento' há gente na água, e o caminho correto passa a ser
          // "Encerrar DW" (que exige todo mundo fora d'água primeiro).
          <button
            type="button"
            onClick={async () => {
              setProcessando(true);
              const res = await cancelarDownwind();
              setProcessando(false);
              if (!res.ok) setErro(res.error ?? 'Falha ao cancelar o downwind.');
            }}
            disabled={processando}
            className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 active:scale-95 transition-all"
            aria-label="Cancelar o downwind antes de começar"
          >
            <Ban size={16} />
            <span className="text-[10px] font-bold">Cancelar</span>
          </button>
        )}

        {souOrganizador && downwindAtivo.status === 'em_andamento' && (
          <button
            type="button"
            onClick={async () => {
              setProcessando(true);
              const res = await encerrarDownwind();
              setProcessando(false);
              if (!res.ok) setErro(res.error ?? 'Falha ao encerrar o downwind.');
            }}
            disabled={processando}
            className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-amber-950/60 border border-amber-700/50 text-amber-300 active:scale-95 transition-all"
            aria-label="Encerrar o downwind para todo o grupo"
          >
            <Octagon size={16} />
            <span className="text-[10px] font-bold">Encerrar DW</span>
          </button>
        )}
      </div>

      {chatAberto && (
        <DownwindChat downwindId={downwindAtivo.id} onFechar={() => setChatAberto(false)} />
      )}
    </div>
  );
};
