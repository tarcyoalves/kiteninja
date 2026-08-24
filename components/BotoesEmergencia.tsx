'use client';

import React from 'react';
import { Phone } from 'lucide-react';
import {
  NUMEROS_EMERGENCIA,
  NUMEROS_PRIORITARIOS,
  type NumeroEmergencia,
} from '../lib/emergencia';

/**
 * Botões de discagem direta para as autoridades.
 *
 * `tel:` é usado de propósito, e não uma tela intermediária do app: abre o
 * discador nativo com o número já preenchido, funciona **sem internet** (basta
 * sinal de voz) e não depende de nada nosso continuar de pé. Numa emergência,
 * menos software no caminho é melhor.
 *
 * Duas variantes:
 *  - `completo`: as quatro autoridades com a linha "quando ligar". Para o painel
 *    de SOS ativo e para o menu, onde o velejador tem um instante para escolher.
 *  - `compacto`: só 193/185, sem explicação. Para espaços curtos (erro de rede).
 */

interface BotoesEmergenciaProps {
  variante?: 'completo' | 'compacto';
  className?: string;
}

function Botao({ n, compacto }: { n: NumeroEmergencia; compacto: boolean }) {
  if (compacto) {
    return (
      <a
        href={`tel:${n.numero}`}
        className={`flex-1 py-1.5 rounded-lg ${n.cor} text-white font-black text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-transform`}
        aria-label={`Ligar para ${n.nome}, ${n.numero}`}
      >
        <Phone size={13} aria-hidden="true" />
        {n.numero}
      </a>
    );
  }

  return (
    <a
      href={`tel:${n.numero}`}
      className={`py-2.5 px-3 rounded-xl ${n.cor} text-white flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-all shadow-lg`}
      aria-label={`Ligar para ${n.nome}, ${n.numero}. ${n.quando}`}
    >
      <span className="flex items-center gap-1.5 font-black text-lg leading-none">
        <Phone size={17} aria-hidden="true" />
        {n.numero}
      </span>
      <span className="text-[10px] font-bold opacity-90">{n.nome}</span>
      <span className="text-[9px] opacity-75 text-center leading-tight">{n.quando}</span>
    </a>
  );
}

export const BotoesEmergencia: React.FC<BotoesEmergenciaProps> = ({
  variante = 'completo',
  className = '',
}) => {
  if (variante === 'compacto') {
    return (
      <div className={`flex gap-2 ${className}`}>
        {NUMEROS_PRIORITARIOS.map(n => (
          <Botao key={n.numero} n={n} compacto />
        ))}
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-2 gap-2 ${className}`}>
      {NUMEROS_EMERGENCIA.map(n => (
        <Botao key={n.numero} n={n} compacto={false} />
      ))}
    </div>
  );
};
