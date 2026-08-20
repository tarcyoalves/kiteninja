'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Mantém a tela ligada com a Screen Wake Lock API enquanto o Modo Navegação
 * (components/ModoNavegacao.tsx) está aberto.
 *
 * Por que isto existe: iOS PWA mata o JavaScript assim que a tela bloqueia ou
 * o app sai de primeiro plano (ver lib/usePositionBeacon.ts para o problema
 * de fundo). Sem impedir o bloqueio automático da tela, o beacon de posição
 * simplesmente para de rodar no meio de uma navegação — e é exatamente
 * durante uma navegação longa, com o celular no colete, que o rastreamento
 * de segurança mais importa.
 *
 * ARMADILHA CENTRAL DA API, que precisa ser tratada explicitamente: o
 * sentinel devolvido por `wakeLock.request()` é liberado automaticamente
 * pelo navegador sempre que o documento perde visibilidade (troca de app,
 * tela apaga por outro motivo, etc.). Se o código só adquirisse o lock uma
 * vez, o padrão clássico de bug seria: usuário sai do app um instante,
 * volta, e a tela apaga sozinha pouco depois — porque o lock morreu em
 * segundo plano e nunca foi readquirido. Por isso o hook escuta
 * `visibilitychange` e tenta readquirir toda vez que o documento volta a
 * ficar visível.
 */

/**
 * A Screen Wake Lock API ainda não está nos tipos padrão do TS/DOM em todo
 * lugar (varia por versão de `lib.dom.d.ts`), e testar o hook não deve
 * depender do tipo real `WakeLockSentinel` do navegador. Este subtipo
 * mínimo é só o que o hook de fato usa — permite passar um objeto simples
 * `{ released: false, release: async () => {} }` nos testes.
 */
export interface WakeLockLike {
  released: boolean;
  release: () => Promise<void>;
}

type NavigatorComWakeLock = Navigator & {
  wakeLock: { request: (tipo: 'screen') => Promise<WakeLockLike> };
};

/**
 * Suporte real: iOS 16.4+. Em versões anteriores, ou em navegador desktop
 * sem a API, `navigator.wakeLock` simplesmente não existe — não é um erro,
 * é ausência de feature, e o app precisa saber disso para avisar o usuário
 * (a tela pode apagar; o rastreamento pode parar) em vez de fingir que está
 * tudo coberto.
 */
export function suportaWakeLock(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

/**
 * Exportada para teste, no mesmo espírito de `lerPosicao` em
 * usePositionBeacon.ts: é aqui que mora a regra que não pode quebrar. A API
 * rejeita a Promise quando o documento não está visível e também por
 * política do navegador (ex.: usuário nunca interagiu com a página) — nos
 * dois casos isso é esperado, não uma falha para propagar. Uma rejeição
 * escapando daqui derrubaria o efeito do hook inteiro.
 */
export async function solicitarWakeLock(): Promise<WakeLockLike | null> {
  if (!suportaWakeLock()) return null;
  try {
    return await (navigator as NavigatorComWakeLock).wakeLock.request('screen');
  } catch {
    return null;
  }
}

/**
 * Decide, num evento de `visibilitychange`, se vale tentar readquirir o
 * lock. Extraída como função pura para ser testável sem jsdom nem um
 * `WakeLockSentinel` real — só precisa de `{ released: boolean } | null`.
 *
 * Não tenta readquirir enquanto a página está oculta (a própria API
 * rejeitaria) nem quando já existe um sentinel vivo (`released === false`),
 * para não disparar uma segunda requisição por cima de um lock que já está
 * funcionando.
 */
export function deveReadquirir(
  hidden: boolean,
  sentinelAtual: { released: boolean } | null
): boolean {
  if (hidden) return false;
  return sentinelAtual === null || sentinelAtual.released;
}

export interface UseWakeLockState {
  /** A tela está de fato travada ligada agora. */
  ativo: boolean;
  /** Este navegador tem a API. Se `false`, `ativo` nunca vai ficar `true`. */
  suportado: boolean;
}

/**
 * @param ligado Controla se o hook deve manter o lock adquirido. Passar
 *   `false` (ou desmontar) libera o lock — é assim que o Modo Navegação
 *   desliga o wake lock ao sair da tela preta.
 */
export function useWakeLock(ligado: boolean): UseWakeLockState {
  const [ativo, setAtivo] = useState(false);
  const sentinelRef = useRef<WakeLockLike | null>(null);
  const suportado = suportaWakeLock();

  useEffect(() => {
    if (!ligado) return;

    // Evita que uma resposta tardia de `adquirir()` (a Promise ainda em voo
    // quando o efeito já foi limpo) sobrescreva o estado depois do cleanup.
    let cancelado = false;

    const adquirir = async () => {
      const sentinel = await solicitarWakeLock();
      if (cancelado) {
        // Efeito já foi desmontado/desligado enquanto a requisição estava
        // pendente: não deixa um lock órfão vivo, libera na hora.
        sentinel?.release().catch(() => {});
        return;
      }
      sentinelRef.current = sentinel;
      setAtivo(sentinel !== null);
    };

    adquirir();

    const onVisibility = () => {
      if (deveReadquirir(document.hidden, sentinelRef.current)) {
        adquirir();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelado = true;
      document.removeEventListener('visibilitychange', onVisibility);
      sentinelRef.current?.release().catch(() => {});
      sentinelRef.current = null;
      setAtivo(false);
    };
  }, [ligado]);

  return { ativo, suportado };
}
