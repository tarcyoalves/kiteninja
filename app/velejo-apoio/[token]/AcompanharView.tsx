'use client';

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2, MapPin, Navigation, PartyPopper, Timer } from 'lucide-react';
import { estadoSinal } from '@/lib/downwind';
import type { PontoTrilha } from '@/lib/trilhaDownwind';

/** Leaflet é client-only — mesmo padrão do resto do app. */
const TrilhaAoVivoMapa = dynamic(
  () => import('@/components/TrilhaAoVivoMapa').then((m) => m.TrilhaAoVivoMapa),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center bg-[#090e1a] text-cyan-400">
        <Loader2 size={28} className="animate-spin" />
      </div>
    ),
  }
);

/** Mesma cadência do mapa do downwind: um GET a cada 30s, e só. */
const INTERVALO_MS = 30_000;

interface Resposta {
  disponivel: boolean;
  motivo: 'expirado' | 'encerrado' | null;
  velejador: { nome: string; avatarUrl: string | null };
  iniciadoEm?: string;
  trilha?: PontoTrilha[];
  ultimaPosicao?: { lat: number; lng: number; registradoEm: string } | null;
}

export const AcompanharView: React.FC = () => {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erroRede, setErroRede] = useState(false);
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  const buscar = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/velejo-apoio/${token}`, { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setDados({
          disponivel: false,
          motivo: 'expirado',
          velejador: { nome: '', avatarUrl: null },
        });
        setErroRede(false);
        return;
      }
      setDados(body as Resposta);
      setErroRede(false);
    } catch {
      // Rede caiu: mantém o último estado na tela em vez de piscar erro. Quem
      // está dirigindo prefere uma posição de um minuto atrás a uma tela vazia.
      setErroRede(true);
    }
  }, [token]);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      if (cancelado) return;
      await buscar();
    })();
    const id = setInterval(buscar, INTERVALO_MS);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [buscar]);

  if (dados === null) {
    return (
      <main className="fixed inset-0 bg-[#0F172A] flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-cyan-400" />
      </main>
    );
  }

  if (!dados.disponivel) {
    // Os dois motivos pedem reações diferentes de quem está no carro: um pede
    // outro link, o outro quer dizer "pode ir buscar".
    const encerrado = dados.motivo === 'encerrado';
    return (
      <main className="min-h-screen bg-[#0F172A] text-slate-100 flex items-center justify-center p-5">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="text-5xl" aria-hidden="true">
            {encerrado ? '🏁' : '⏳'}
          </div>
          <h1 className="text-xl font-black">
            {encerrado ? 'O velejo terminou' : 'Link indisponível'}
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            {encerrado
              ? `${dados.velejador.nome || 'O velejador'} saiu da água. O acompanhamento ao vivo acaba junto com o velejo.`
              : 'Este link de acompanhamento expirou (dura 12 horas) ou não é válido. Peça um novo a quem está velejando.'}
          </p>
          <Link
            href="/"
            className="inline-block mt-2 px-5 py-3 rounded-2xl bg-slate-800 text-slate-200 font-bold text-sm"
          >
            Conhecer o KiteNinja
          </Link>
        </div>
      </main>
    );
  }

  const ultima = dados.ultimaPosicao ?? null;
  const { estado, minutosSemReportar } = estadoSinal(
    ultima ? new Date(ultima.registradoEm) : null,
    agora
  );
  const corSinal =
    estado === 'ok' ? 'text-emerald-400' : estado === 'atrasado' ? 'text-amber-400' : 'text-rose-400';
  const textoSinal =
    minutosSemReportar === null
      ? 'aguardando primeiro sinal'
      : minutosSemReportar < 1
        ? 'agora há pouco'
        : `há ${Math.floor(minutosSemReportar)} min`;

  return (
    <main className="fixed inset-0 flex flex-col bg-[#090e1a] text-slate-100">
      <header className="shrink-0 px-4 py-3 bg-[#0F172A] border-b border-slate-800 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 overflow-hidden shrink-0 flex items-center justify-center">
          {dados.velejador.avatarUrl ? (
            <img
              src={dados.velejador.avatarUrl}
              alt={dados.velejador.nome}
              className="w-full h-full object-cover"
            />
          ) : (
            <Navigation size={16} className="text-cyan-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-black text-sm truncate">{dados.velejador.nome}</p>
          <p className={`text-[11px] font-bold flex items-center gap-1 ${corSinal}`}>
            <Timer size={11} aria-hidden="true" />
            <span>{textoSinal}</span>
          </p>
        </div>
      </header>

      <div className="flex-1 min-h-0 relative">
        <TrilhaAoVivoMapa
          trilha={dados.trilha ?? []}
          ultimaPosicao={ultima}
          nome={dados.velejador.nome}
        />
        {erroRede && (
          <div className="absolute top-2 left-2 right-2 z-map-ui px-3 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-200 text-[11px] font-bold text-center">
            Sem conexão — mostrando a última posição recebida.
          </div>
        )}
      </div>

      <footer className="shrink-0 px-4 py-3 bg-[#0F172A] border-t border-slate-800 text-[11px] text-slate-400 flex items-center gap-2">
        {ultima ? (
          <>
            <MapPin size={12} className="text-rose-400 shrink-0" />
            <span>
              {ultima.lat.toFixed(4)}, {ultima.lng.toFixed(4)}
            </span>
          </>
        ) : (
          <>
            <PartyPopper size={12} className="text-cyan-400 shrink-0" />
            <span>Ainda não recebemos a primeira posição.</span>
          </>
        )}
      </footer>
    </main>
  );
};
