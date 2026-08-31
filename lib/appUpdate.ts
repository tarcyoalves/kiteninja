'use client';

import { useSyncExternalStore } from 'react';

const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;
const DISMISSED_COMMIT_KEY = 'kiteninja_update_dismissed_commit';

let commitDisponivel: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getCommitSnapshot() {
  return commitDisponivel;
}

function getServerCommitSnapshot() {
  return null;
}

function getAvailableSnapshot() {
  return commitDisponivel !== null;
}

function getServerAvailableSnapshot() {
  return false;
}

function normalizarCommit(commit: string | null | undefined): string | null {
  const valor = commit?.trim().toLowerCase();
  return valor && COMMIT_PATTERN.test(valor) ? valor : null;
}

/**
 * Retorna o deploy novo somente quando os dois lados possuem SHAs Git válidos.
 * `buildTime` e eventos do Service Worker não identificam versão do aplicativo:
 * podem mudar por cold start ou por uma atualização isolada do worker.
 */
export function detectarNovoCommit(
  commitDoBundle: string | null | undefined,
  commitDoDeploy: string | null | undefined,
): string | null {
  const bundle = normalizarCommit(commitDoBundle);
  const deploy = normalizarCommit(commitDoDeploy);
  if (!bundle || !deploy) return null;

  // Aceita SHA curto e completo como a mesma revisão.
  if (bundle === deploy || bundle.startsWith(deploy) || deploy.startsWith(bundle)) {
    return null;
  }

  return deploy;
}

/** Fonte única para banner, badge do sino e central de notificações. */
export function useAppUpdateAvailable() {
  return useSyncExternalStore(subscribe, getAvailableSnapshot, getServerAvailableSnapshot);
}

export function useAppUpdateCommit() {
  return useSyncExternalStore(subscribe, getCommitSnapshot, getServerCommitSnapshot);
}

export function markAppUpdateAvailable(commit: string) {
  const novoCommit = normalizarCommit(commit);
  if (!novoCommit || commitDisponivel === novoCommit) return;

  try {
    if (localStorage.getItem(DISMISSED_COMMIT_KEY) === novoCommit) return;
  } catch {
    // Storage pode ser bloqueado em modo privado; o alerta continua funcional.
  }

  commitDisponivel = novoCommit;
  listeners.forEach((listener) => listener());
}

export function dismissAppUpdate(commit: string | null) {
  const valor = normalizarCommit(commit);
  if (valor) {
    try {
      localStorage.setItem(DISMISSED_COMMIT_KEY, valor);
    } catch {
      // A dispensa vale ao menos para esta execução via clear abaixo.
    }
  }
  clearAppUpdateAvailable();
}

export function clearAppUpdateAvailable() {
  if (commitDisponivel === null) return;
  commitDisponivel = null;
  listeners.forEach((listener) => listener());
}

/** Atualiza SW/caches e recarrega; compartilhado pelo banner e pela central. */
export async function applyAppUpdate() {
  const commit = commitDisponivel;

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
        await registration.update().catch(() => {});
      }
    }

    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } finally {
    clearAppUpdateAvailable();

    // `reload()` no WebView pode revalidar o mesmo documento antigo. Uma URL
    // única por SHA força o Next/Vercel a entregar o HTML e os chunks do deploy
    // atual; o parâmetro é inofensivo para as rotas do aplicativo.
    const url = new URL(window.location.href);
    if (commit) url.searchParams.set('__app_update', commit.slice(0, 12));
    window.location.replace(url.toString());
  }
}
