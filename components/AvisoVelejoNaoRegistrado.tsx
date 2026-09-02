'use client';

import React, { useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Save, Trash2 } from 'lucide-react';
import {
  lerTrilhaRecuperavel,
  prefillDeTrilhaSalva,
} from '../lib/trilhaPersistida';
import { limparTrilhaSalva } from '../lib/useTrilhaSessao';
import { useKiteData } from '../context/KiteDataContext';

/**
 * "Você tem um velejo que não chegou a ser registrado."
 *
 * POR QUE ESTE AVISO MORA NO LOGBOOK
 *
 * A trilha do Modo Navegação passou a sobreviver a um fechamento do app (ver
 * `lib/trilhaPersistida.ts`), mas o único lugar que oferecia recuperá-la era o
 * próprio Modo Navegação — e ninguém abre o Modo Navegação para procurar um
 * velejo perdido. **A pessoa vai ao Logbook**, porque é onde o velejo deveria
 * estar e não está.
 *
 * Um dado salvo que ninguém encontra é, na prática, um dado perdido. Foi o
 * mesmo erro do downwind invisível (`docs/BUG-DOWNWIND-INVISIVEL.md`): existia
 * no banco e não aparecia em tela nenhuma.
 *
 * E o verbo aqui é REGISTRAR, não "retomar". No Modo Navegação faz sentido
 * voltar a navegar; aqui a pessoa já saiu da água e o que ela quer é o
 * registro.
 */

/**
 * `localStorage` não avisa quando muda, e ler no corpo do componente seria
 * impuro (dois renders do mesmo estado dando respostas diferentes). O
 * snapshot é tirado uma vez e fica estável até o componente sumir — que é
 * exatamente o que acontece quando o velejo é registrado ou descartado.
 */
function assinarNada(): () => void {
  return () => {};
}

let cache: ReturnType<typeof lerTrilhaRecuperavel> | undefined;
function lerNoCliente() {
  if (cache === undefined) cache = lerTrilhaRecuperavel();
  return cache;
}
function lerNoServidor() {
  return null;
}

export const AvisoVelejoNaoRegistrado: React.FC = () => {
  const { abrirLoggerComResumo } = useKiteData();
  const salvo = useSyncExternalStore(assinarNada, lerNoCliente, lerNoServidor);
  const [dispensado, setDispensado] = useState(false);

  if (!salvo || dispensado) return null;

  const prefill = prefillDeTrilhaSalva(salvo);
  if (!prefill) return null;

  const registrar = () => {
    /*
     * NÃO limpa a trilha salva aqui. Quem limpa é o `addSession` depois do
     * servidor confirmar (ver KiteDataContext): se a pessoa abrir o
     * formulário e fechar sem salvar, ou a rede cair, o backup precisa
     * continuar existindo. Apagar no clique perderia o velejo por um toque
     * acidental.
     */
    abrirLoggerComResumo(prefill);
    setDispensado(true);
  };

  const descartar = () => {
    limparTrilhaSalva();
    cache = null;
    setDispensado(true);
  };

  return (
    <div className="p-3.5 rounded-2xl border border-amber-500/40 bg-amber-500/10">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-[13px] font-black text-amber-200">Velejo sem registro</p>
          <p className="mt-0.5 text-[11px] leading-snug text-amber-100/80">
            O app fechou antes de você salvar. Guardamos{' '}
            <strong>{salvo.distanciaKm.toFixed(1)} km</strong> e{' '}
            <strong>{prefill.durationMinutes} min</strong> de trilha.
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={registrar}
          className="flex-1 h-9 rounded-xl bg-amber-400 text-slate-950 font-black text-xs active:scale-95 transition-transform flex items-center justify-center gap-1.5"
        >
          <Save size={14} />
          Registrar agora
        </button>
        <button
          type="button"
          onClick={descartar}
          className="h-9 px-3 rounded-xl bg-slate-800 border border-slate-600 text-slate-300 font-black text-xs active:scale-95 transition-transform flex items-center justify-center gap-1.5"
        >
          <Trash2 size={14} />
          Descartar
        </button>
      </div>
    </div>
  );
};
