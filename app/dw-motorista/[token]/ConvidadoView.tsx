'use client';

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { AlertTriangle, Car, Clock, Loader2, MessageCircle, PartyPopper } from 'lucide-react';
import { useDownwindBeacon } from '@/lib/useDownwindBeacon';
import { useDownwindPosicoes } from '@/lib/useDownwindPosicoes';
import { DownwindChat } from '@/components/DownwindChat';

/**
 * Experiência do link de 12h para apoio em terra sem conta.
 *
 * Fica de fora, de propósito, de TODA a árvore de providers do app principal
 * (AuthProvider, KiteDataProvider, DownwindProvider — montada em
 * app/page.tsx): esta tela não precisa de spots, feed, admin nem do resto do
 * app, e não montar esses providers aqui é o que garante isso na raiz, não
 * só a autorização do servidor. Reaproveita só o que é genuinamente do
 * domínio do mapa ao vivo — components/DownwindMapa.tsx e
 * components/DownwindChat.tsx (esta com a prop `meuUsuario`, pensada
 * exatamente para este caso — ver o comentário dela).
 */

const DownwindMapa = dynamic(
  () => import('@/components/DownwindMapa').then((m) => m.DownwindMapa),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center bg-[#090e1a] text-cyan-400">
        <Loader2 size={28} className="animate-spin" />
      </div>
    ),
  }
);

interface DownwindHeader {
  id: string;
  nome: string;
  status: string;
  saida: { nome: string; lat: number; lng: number } | null;
  chegada: { nome: string; lat: number; lng: number } | null;
}

type Fase = 'checando' | 'form' | 'conectado';

interface ConvidadoViewProps {
  token: string;
  downwindNome: string;
}

export const ConvidadoView: React.FC<ConvidadoViewProps> = ({ token, downwindNome }) => {
  const [fase, setFase] = useState<Fase>('checando');
  const [nome, setNome] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [downwind, setDownwind] = useState<DownwindHeader | null>(null);
  const [meuUserId, setMeuUserId] = useState<string | null>(null);
  const [meuNome, setMeuNome] = useState<string | null>(null);
  const [meuRiderId, setMeuRiderId] = useState<string | null>(null);
  const [chatAberto, setChatAberto] = useState(false);

  // "Já tenho sessão de convidado válida?" — cobre o refresh da página, que
  // reseta o estado React mas não o cookie httpOnly de 12h.
  const checarSessao = useCallback(async () => {
    try {
      const res = await fetch('/api/downwind/convite/sessao', { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (body?.downwind) {
        setDownwind(body.downwind as DownwindHeader);
        setMeuUserId(body.meuUserId as string);
        setMeuNome(body.meuNome as string);
        setMeuRiderId(body.meuRiderId as string);
        return true;
      }
    } catch {
      // Falha de rede na checagem inicial: trata como "sem sessão" e mostra
      // o formulário — o pior caso é pedir o nome de novo, não travar a tela.
    }
    return false;
  }, []);

  useEffect(() => {
    (async () => {
      const ok = await checarSessao();
      setFase(ok ? 'conectado' : 'form');
    })();
  }, [checarSessao]);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim() || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/downwind/convite/${token}/entrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? 'Não foi possível entrar.');

      const ok = await checarSessao();
      if (!ok) throw new Error('Entrada confirmada, mas não foi possível carregar o downwind.');
      setFase('conectado');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha de conexão.');
    } finally {
      setEnviando(false);
    }
  };

  const emAndamento = downwind?.status === 'em_andamento';
  // Reporta a própria posição como qualquer apoio_terra — pedido do dono: o
  // carro também aparece no mapa para os velejadores.
  const beacon = useDownwindBeacon(downwind?.id ?? null, emAndamento);
  const { participantes, minhaTrilha, servePosicoes } = useDownwindPosicoes(
    downwind?.id ?? null,
    false
  );

  if (fase === 'checando') {
    return (
      <main className="fixed inset-0 bg-[#0F172A] flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-cyan-400" />
      </main>
    );
  }

  if (fase === 'form') {
    return (
      <main className="fixed inset-0 bg-[#0F172A] text-slate-100 flex items-center justify-center p-5">
        <form onSubmit={entrar} className="w-full max-w-sm space-y-5 text-center">
          <div className="text-5xl" aria-hidden="true">
            🚗
          </div>
          <div>
            <h1 className="text-xl font-black">Apoio em terra</h1>
            <p className="text-sm text-slate-400 mt-1">{downwindNome}</p>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Digite seu nome para ver o mapa ao vivo e conversar com o grupo.
            Este acesso é válido por 12 horas e não cria conta — só mapa e
            chat desta travessia.
          </p>

          {erro && (
            <div className="flex items-center gap-2 p-2.5 bg-red-950/40 border border-red-500/40 rounded-xl text-red-300 text-xs font-medium text-left">
              <AlertTriangle size={14} className="text-red-400 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value.slice(0, 60))}
            placeholder="Seu nome"
            autoFocus
            className="w-full p-3.5 rounded-2xl bg-[#1E293B] border border-slate-700 text-white text-center font-bold focus:outline-hidden focus:border-cyan-400"
          />

          <button
            type="submit"
            disabled={!nome.trim() || enviando}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-black disabled:opacity-50 active:scale-95 transition-all"
          >
            {enviando ? <Loader2 size={18} className="animate-spin" /> : <Car size={18} />}
            <span>Entrar como apoio</span>
          </button>
        </form>
      </main>
    );
  }

  // fase === 'conectado', mas o downwind pode ter terminado enquanto o
  // convidado estava com a tela aberta (servePosicoes vira false).
  if (!downwind || !servePosicoes) {
    return (
      <main className="fixed inset-0 bg-[#0F172A] text-slate-100 flex items-center justify-center p-5">
        <div className="text-center space-y-3">
          <PartyPopper size={40} className="mx-auto text-amber-400" />
          <h1 className="text-lg font-black">Downwind encerrado</h1>
          <p className="text-sm text-slate-400 max-w-xs">
            Obrigado pelo apoio! Este link não mostra mais o mapa ao vivo.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="fixed inset-0 bg-[#090e1a] flex flex-col">
      <div className="shrink-0 px-4 py-3 bg-[#0F172A] border-b border-slate-800 overlay-safe-top flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="font-black text-sm text-white truncate">{downwind.nome}</h1>
          <p className="text-[11px] text-slate-400 flex items-center gap-1">
            <Clock size={11} />
            Acesso de apoio · válido por 12h
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
        {emAndamento ? (
          meuUserId && (
            <DownwindMapa
              meuUserId={meuUserId}
              saida={downwind.saida}
              chegada={downwind.chegada}
              participantes={participantes}
              minhaTrilha={minhaTrilha}
            />
          )
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-slate-500 px-6">
            <Car size={40} className="opacity-40" />
            <p className="text-xs text-center max-w-[240px]">
              O downwind ainda não começou. O mapa ao vivo liga assim que a
              travessia iniciar.
            </p>
          </div>
        )}
      </div>

      {!beacon.ultimaPosicaoEm && emAndamento && (
        <div className="shrink-0 px-4 py-2 bg-amber-950/40 border-t border-amber-800/40 text-amber-300 text-[11px] flex items-center gap-1.5 overlay-safe-bottom">
          <AlertTriangle size={12} className="shrink-0" />
          Aguardando sua localização — confirme a permissão de GPS do navegador.
        </div>
      )}

      {chatAberto && meuUserId && meuNome && meuRiderId && (
        <DownwindChat
          downwindId={downwind.id}
          onFechar={() => setChatAberto(false)}
          meuUsuario={{ id: meuUserId, name: meuNome, riderId: meuRiderId }}
        />
      )}
    </main>
  );
};
