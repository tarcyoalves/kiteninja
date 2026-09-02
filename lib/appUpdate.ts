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

/**
 * Parâmetro que a atualização coloca na URL para furar o cache do WebView.
 * Exportado porque o carregamento seguinte precisa lê-lo para saber se a
 * atualização funcionou — ver `resultadoDaAtualizacao`.
 */
export const PARAM_ATUALIZACAO = '__app_update';

export interface ContextoAtualizacao {
  /** Alguém está na água com rastreio ligado. */
  temDownwindAtivo: boolean;
  /** Há um SOS em andamento — a tela mais importante do app. */
  temSosAtivo: boolean;
  /** Formulário ou modal aberto: recarregar apagaria o que a pessoa digitou. */
  temModalAberto: boolean;
  /** A tela está à frente do usuário neste instante. */
  appVisivel: boolean;
}

/**
 * Pode recarregar sozinho, sem perguntar nada?
 *
 * POR QUE ISTO EXISTE
 *
 * O aviso de nova versão só avisava. Quem ignorasse o popup — ou fechasse no
 * X, que grava a dispensa em localStorage — ficava na versão antiga por tempo
 * indefinido. Numa correção de segurança (um SOS que não escala, um downwind
 * que não registra), "o usuário decide quando atualizar" é o mesmo que "não
 * atualiza".
 *
 * A regra é o oposto de agressiva: **só atualiza sozinho quando não há nada a
 * perder.** Recarregar a página no meio de um velejo ou de um socorro seria
 * muito pior que ficar uma versão atrás.
 *
 * O momento escolhido é a volta do segundo plano, com o app ESCONDIDO: a
 * pessoa não está olhando, nada está aberto, e ela encontra a versão nova já
 * carregada quando voltar. Recarregar com a tela à frente dela faria o app
 * "piscar" sem motivo aparente.
 */
export function podeAtualizarSozinho(ctx: ContextoAtualizacao): boolean {
  // Rastreio ligado: recarregar mata o watchPosition e a trilha em memória.
  if (ctx.temDownwindAtivo) return false;
  // Socorro em andamento: nada justifica mexer nesta tela.
  if (ctx.temSosAtivo) return false;
  // Formulário aberto: o recarregamento apagaria o que foi digitado.
  if (ctx.temModalAberto) return false;
  // Só com o app fora da frente — recarregar na cara do usuário assusta.
  return !ctx.appVisivel;
}

/**
 * A atualização anterior funcionou?
 *
 * Sem esta checagem não havia como saber. O fluxo antigo recarregava e
 * torcia: se o WebView servisse a versão antiga assim mesmo, o aviso voltava
 * em 60 s, a pessoa tocava de novo, e isso se repetia sem que nada dissesse
 * que a atualização não estava pegando.
 */
export function resultadoDaAtualizacao(
  urlBusca: string,
  commitDoBundle: string | null | undefined
): 'nao-tentou' | 'funcionou' | 'falhou' {
  const pedido = normalizarCommit(new URLSearchParams(urlBusca).get(PARAM_ATUALIZACAO));
  if (!pedido) return 'nao-tentou';

  const bundle = normalizarCommit(commitDoBundle);
  if (!bundle) return 'falhou';

  // Mesma tolerância de SHA curto/longo de `detectarNovoCommit`.
  const bate = bundle === pedido || bundle.startsWith(pedido) || pedido.startsWith(bundle);
  return bate ? 'funcionou' : 'falhou';
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
    /*
     * NÃO limpa `commitDisponivel` aqui.
     *
     * Antes, o estado era zerado logo antes do `replace`. Se a navegação não
     * acontecesse — WebView engasgado, aba suspensa no meio — o aviso sumia e
     * o app continuava velho, sem nenhum sinal de que a atualização falhou.
     * Deixando o estado de pé, o recarregamento (que descarta tudo de qualquer
     * forma) é o único jeito de ele sumir: se o app não recarregou, o aviso
     * continua lá, que é a verdade.
     */
    const url = new URL(window.location.href);
    if (commit) url.searchParams.set(PARAM_ATUALIZACAO, commit.slice(0, 12));
    window.location.replace(url.toString());
  }
}

/**
 * Tira o `__app_update` da barra de endereço depois que ele cumpriu o papel.
 *
 * O parâmetro existe só para furar o cache do WebView naquele carregamento.
 * Deixá-lo na URL o faz viajar em todo link que a pessoa compartilhar — e o
 * app compartilha links (o convite de downwind é `/?dw_invite=…`).
 *
 * `replaceState` troca a URL sem recarregar nada.
 */
export function limparParametroDeAtualizacao(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(PARAM_ATUALIZACAO)) return;
  url.searchParams.delete(PARAM_ATUALIZACAO);
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}
