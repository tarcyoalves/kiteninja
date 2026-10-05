'use client';

import React, { useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';

/**
 * Indicador "última varredura do SOS".
 *
 * A escalada do SOS (5 -> 15 -> 50 km) só anda quando alguém chama a
 * varredura: o cron externo ou o polling dos clientes com o app aberto. Se as
 * duas fontes pararem, um pedido de socorro fica no raio inicial e nada
 * avisava o dono. Aqui a idade da última varredura aparece em vermelho acima
 * de 10 minutos (a decisão de "parada" vem do servidor, com o relógio do banco).
 *
 * Busca SÓ ao montar e no botão — sem setInterval: o Neon gratuito hiberna
 * quando ninguém o usa, e um painel esquecido aberto o manteria acordado
 * (mesmo defeito do polling do UserManager, T09).
 */

interface UltimaVarredura {
  em: string | null;
  segundosAtras: number | null;
  origem: 'polling' | 'cron' | null;
  fase: 'em_andamento' | 'concluida' | null;
  examinados: number | null;
  escalados: number | null;
  erros: number | null;
  parada: boolean;
}

function idade(segundos: number): string {
  const min = Math.floor(segundos / 60);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

export const SaudeSos: React.FC = () => {
  const [dados, setDados] = useState<UltimaVarredura | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  // Todo setState vem DEPOIS de um await (padrão da base para o React
  // Compiler); a flag inicial de carregamento já nasce `true`.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch('/api/admin/saude', { cache: 'no-store' });
        if (!res.ok) throw new Error('Não foi possível ler a saúde do SOS.');
        const corpo = (await res.json()) as { sosVarredura: UltimaVarredura };
        if (!vivo) return;
        setDados(corpo.sosVarredura);
        setFalha(null);
      } catch (e) {
        if (vivo) setFalha(e instanceof Error ? e.message : 'Falha ao carregar.');
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [recarga]);

  const atualizar = () => {
    setCarregando(true);
    setRecarga((n) => n + 1);
  };

  // Sem leitura (falha) não afirmamos que está tudo bem: fica vermelho também.
  const vermelho = falha !== null || (dados !== null && dados.parada);
  const origem =
    dados?.origem === 'cron' ? 'pelo agendador externo' : dados?.origem === 'polling' ? 'pelo app aberto' : null;

  let texto: string;
  if (falha) texto = falha;
  else if (dados === null) texto = 'lendo…';
  else if (dados.segundosAtras === null) texto = 'nenhuma registrada ainda';
  else texto = `há ${idade(dados.segundosAtras)}`;

  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl border text-xs ${
        vermelho
          ? 'bg-red-500/10 border-red-500/40 text-red-300'
          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Activity size={14} className="shrink-0" />
        <div className="min-w-0">
          <div className="font-bold">Última varredura do SOS: {texto}</div>
          {!falha && dados && dados.segundosAtras !== null && (
            <div className="text-[11px] opacity-80">
              {origem}
              {dados.fase === 'em_andamento' ? ' · não terminou (pode ter falhado)' : ''}
              {dados.erros ? ` · ${dados.erros} SOS com erro` : ''}
              {vermelho ? ' · acima de 10 min: a escalada pode estar parada' : ''}
            </div>
          )}
          {!falha && dados && dados.segundosAtras === null && (
            <div className="text-[11px] opacity-80">Confira o agendador em docs/CRON-EXTERNO-SOS.md.</div>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={atualizar}
        aria-label="Atualizar"
        className="p-1.5 rounded-lg bg-slate-800/70 text-slate-300 hover:text-white transition-colors shrink-0"
      >
        <RefreshCw size={14} className={carregando ? 'animate-spin' : ''} />
      </button>
    </div>
  );
};
