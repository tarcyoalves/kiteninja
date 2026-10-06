'use client';

import { useSyncExternalStore } from 'react';

/**
 * Selo "Novo" que some depois que o velejador abre o item.
 *
 * Os selos do menu (Mapa, Anúncios, Reportar Bug) eram fixos no JSX: ficavam
 * "Novo" para sempre, e selo que nunca muda vira ruído — a pessoa para de ler
 * todos, inclusive os que importam. A marca de "visto" fica no aparelho
 * (localStorage), por item.
 *
 * `useSyncExternalStore` em vez de useState + efeito: lê o armazenamento sem
 * setState síncrono em efeito (React Compiler) e, no servidor, responde
 * "sem selo" — o selo aparece só no cliente, sem divergência de hidratação.
 */
const PREFIXO = 'kiteninja_selo_visto_';
const ouvintes = new Set<() => void>();

export function seloAindaNovo(chave: string): boolean {
  try {
    return localStorage.getItem(PREFIXO + chave) !== '1';
  } catch {
    // Sem armazenamento não há como lembrar; melhor não insistir no selo.
    return false;
  }
}

export function marcarSeloVisto(chave: string): void {
  try {
    localStorage.setItem(PREFIXO + chave, '1');
  } catch {
    // idem: sem armazenamento, nada a lembrar
  }
  ouvintes.forEach((avisar) => avisar());
}

function assinar(avisar: () => void) {
  ouvintes.add(avisar);
  return () => {
    ouvintes.delete(avisar);
  };
}

export function useSeloNovo(chave: string): boolean {
  return useSyncExternalStore(
    assinar,
    () => seloAindaNovo(chave),
    () => false,
  );
}
