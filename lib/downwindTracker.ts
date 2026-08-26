'use client';

/**
 * Adapter para o plugin nativo Capacitor `DownwindTracker`
 * (android/app/src/main/java/br/com/kiteninja/app/tracking/DownwindTrackerPlugin.java).
 *
 * Este arquivo é a ÚNICA porta de entrada do app web para o Foreground
 * Service Android de rastreamento de downwind (RastreioDownwindService).
 * Sem ele o plugin nativo existe e compila, mas nenhuma linha de JS/TS jamais
 * o invoca — exatamente o estado encontrado antes desta mudança.
 *
 * Duas responsabilidades deliberadamente separadas:
 *
 * 1. `decidirTracking()` — função pura, sem I/O, que decide SE o rastreamento
 *    nativo deveria estar ligado dado o estado observável do app (usuário,
 *    downwind ativo, papel, estado de participação, plataforma). É o que os
 *    testes cobrem sem precisar mockar Capacitor nem window.
 * 2. `DownwindTrackerAdapter` — a casca fina que fala com o plugin de fato
 *    (via `registerPlugin`), só chamada quando `decidirTracking()` já
 *    concluiu que faz sentido.
 *
 * NÃO duplica o beacon web (lib/useDownwindBeacon.ts): os dois convivem de
 * propósito. O beacon web cobre o app aberto (PWA/WebView em primeiro ou
 * segundo plano vivo); o serviço nativo cobre o app fechado/removido dos
 * recentes, que o beacon web não alcança de nenhuma forma. Rodar os dois ao
 * mesmo tempo é redundância aceitável (o servidor só grava a posição mais
 * recente), não duplicação de efeito colateral.
 */

import { registerPlugin, Capacitor } from '@capacitor/core';
import type { DownwindPapel, DownwindParticipanteEstado, DownwindStatus } from '../context/DownwindContext';

export interface TrackingStatus {
  isServiceRunning: boolean;
  isTrackingConfigured: boolean;
  downwindId: string | null;
  startedAt: number;
  lastLocationAt: number;
  lastSendAttemptAt: number;
  lastSuccessfulSendAt: number;
  lastHttpStatus: number;
  lastError: string | null;
  pendingCount: number;
  consecutiveFailures: number;
  droppedCount: number;
  lastStopReason: string | null;
  batteryOptimizationIgnored: boolean;
  networkAvailable: boolean;
}

export interface DownwindTrackerPlugin {
  startTracking(options: { downwindId: string; authToken: string; baseUrl: string }): Promise<{
    success: boolean;
    downwindId: string;
    alreadyRunning?: boolean;
  }>;
  stopTracking(): Promise<{ success: boolean }>;
  isTracking(): Promise<{ isTracking: boolean; downwindId: string | null }>;
  getTrackingStatus(): Promise<TrackingStatus>;
  openBatteryOptimizationSettings(): Promise<{ success: boolean }>;
  setAuthToken(options: { token: string }): Promise<{ success: boolean }>;
}

/**
 * `registerPlugin` sem implementação de `web` é intencional: em PWA/browser
 * (`Capacitor.isNativePlatform()` false) o plugin nunca deveria ser chamado —
 * ver `deveRastrearNativamente()` abaixo, que já filtra por plataforma antes
 * de qualquer chamada chegar aqui. Se algum código novo pular esse gate e
 * chamar um método em web, o Capacitor rejeita a Promise com um erro claro em
 * vez de silenciosamente não fazer nada.
 */
export const DownwindTracker = registerPlugin<DownwindTrackerPlugin>('DownwindTracker');

/**
 * Só true dentro do app nativo Android/iOS empacotado pelo Capacitor. Em
 * qualquer navegador (PWA instalado ou aba normal) é false — é o mesmo teste
 * usado por lib/usePushNotifications.ts (`useIsNativeApp`), repetido aqui
 * para não criar uma dependência cruzada entre os dois adapters por um
 * booleano.
 */
export function estaNoAppNativo(): boolean {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform();
}

/**
 * Estado mínimo de que a decisão de rastreamento nativo precisa. Um
 * subconjunto deliberado de DownwindAtivo + dados de autenticação — não o
 * objeto inteiro — para que os testes não precisem construir um
 * `DownwindAtivo` completo a cada caso e para que a assinatura deixe claro
 * exatamente quais campos importam para a decisão.
 */
export interface EstadoParaDecisaoTracking {
  isAuthenticated: boolean;
  papel: DownwindPapel | null;
  downwindStatus: DownwindStatus | null;
  participanteEstado: DownwindParticipanteEstado | null;
  /** `estaNoAppNativo()` — extraído como parâmetro para a função continuar pura. */
  appNativo: boolean;
}

/**
 * Decide, de forma pura, se o rastreamento nativo (Foreground Service via
 * plugin DownwindTracker) deveria estar ligado agora.
 *
 * Regras (replicam a intenção do pedido original):
 * - Só dentro do app nativo (PWA não tem Foreground Service; não adianta
 *   nem tentar — evita um startTracking() fadado a rejeitar).
 * - Usuário autenticado (sem sessão não há a quem atribuir o token de
 *   rastreio nem sentido em ligar o GPS).
 * - Papel velejador — apoio em terra não navega, não deveria acender o GPS
 *   dele para reportar posição de travessia (mesmo filtro do backend em
 *   app/api/downwind/[id]/tracking-token/route.ts).
 * - Downwind em `em_andamento` — outros status (aberto/encerrado/cancelado)
 *   não emitem token de rastreio (o backend rejeitaria com 409).
 * - Participante em `confirmado` ou `navegando` — os únicos dois estados que
 *   o backend aceita para emitir token; `encerrado`/`desistiu` não.
 *
 * Extraída como função pura (mesmo padrão de `deveReadquirir` em
 * lib/useWakeLock.ts) para ser testável sem jsdom, sem mock de Capacitor e
 * sem depender de efeitos de rede.
 */
export function decidirTracking(estado: EstadoParaDecisaoTracking): boolean {
  if (!estado.appNativo) return false;
  if (!estado.isAuthenticated) return false;
  if (estado.papel !== 'velejador') return false;
  if (estado.downwindStatus !== 'em_andamento') return false;
  if (estado.participanteEstado !== 'confirmado' && estado.participanteEstado !== 'navegando') return false;
  return true;
}

/** Erros esperados de permissão do sistema — não são falha de programação. */
export class PermissaoLocalizacaoNegadaError extends Error {
  constructor() {
    super('Permissão de localização negada. O rastreamento em segundo plano não pode ser iniciado.');
    this.name = 'PermissaoLocalizacaoNegadaError';
  }
}

/**
 * Detecta se a rejeição do plugin nativo veio de permissão negada, para que
 * quem chama possa diferenciar "usuário disse não" (esperado, mostra aviso
 * calmo) de "erro inesperado" (log/alerta). O plugin nativo
 * (DownwindTrackerPlugin.java) rejeita com a string literal "Permissão de
 * localização negada" em `onLocationPermissionResult` — casar por
 * `includes('permiss')` tolera pequenas variações de mensagem sem exigir um
 * código de erro estruturado que o Capacitor `reject(message)` não carrega.
 */
function ehErroDePermissao(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /permiss/i.test(msg);
}

export interface IniciarTrackingParams {
  downwindId: string;
  /** URL base da própria API (origin do app), enviada ao serviço nativo para montar o endpoint de posições. */
  baseUrl: string;
  /**
   * Busca (POST) um novo token de rastreio escopado a este downwind.
   * Injetado em vez de fazer `fetch` direto aqui para manter o adapter
   * testável sem mockar a rede — quem chama (DownwindContext) já tem essa
   * chamada disponível via `api<T>()`.
   */
  obterToken: () => Promise<{ token: string }>;
}

export interface IniciarTrackingResultado {
  ok: boolean;
  /** true quando o motivo do erro foi permissão negada — trate honestamente na UI, não como falha genérica. */
  permissaoNegada?: boolean;
  error?: string;
}

/**
 * Solicita um token de rastreio ao backend e inicia o Foreground Service
 * nativo. Ponto único de entrada para "comece a rastrear via plugin nativo" —
 * DownwindContext chama isto, nunca o plugin diretamente, para que a busca do
 * token e o startTracking fiquem sempre pareados.
 *
 * Erros de permissão são devolvidos como resultado (não lançados) para a UI
 * poder mostrar um aviso honesto ("a travessia está sendo reportada só
 * enquanto o app estiver aberto") em vez de um erro genérico — o mesmo
 * espírito de `useWakeLock` expor `suportado` em vez de falhar silenciosamente.
 */
export async function iniciarTrackingNativo(
  params: IniciarTrackingParams
): Promise<IniciarTrackingResultado> {
  try {
    const { token } = await params.obterToken();
    await DownwindTracker.startTracking({
      downwindId: params.downwindId,
      authToken: token,
      baseUrl: params.baseUrl,
    });
    return { ok: true };
  } catch (err) {
    if (ehErroDePermissao(err)) {
      return { ok: false, permissaoNegada: true, error: 'Permissão de localização negada.' };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Falha ao iniciar rastreamento em segundo plano.',
    };
  }
}

/**
 * Para o Foreground Service nativo. Best-effort: se o plugin rejeitar (ex.:
 * serviço já parado), não propaga — parar um rastreamento que já não está
 * rodando não é um erro que a UI precise mostrar.
 */
export async function pararTrackingNativo(): Promise<void> {
  try {
    await DownwindTracker.stopTracking();
  } catch {
    // Best-effort — ver comentário acima.
  }
}

/**
 * Consulta a telemetria operacional do serviço nativo no Android.
 * Devolve null se estiver em PWA/web ou se o plugin falhar.
 */
export async function obterStatusTrackingNativo(): Promise<TrackingStatus | null> {
  if (!estaNoAppNativo()) return null;
  try {
    return await DownwindTracker.getTrackingStatus();
  } catch {
    return null;
  }
}

/**
 * Solicita ao Android abrir a página de configurações de bateria do app
 * para permitir que o usuário configure o modo "Sem restrições".
 */
export async function abrirConfiguracoesBateria(): Promise<boolean> {
  if (!estaNoAppNativo()) return false;
  try {
    const res = await DownwindTracker.openBatteryOptimizationSettings();
    return res.success;
  } catch {
    return false;
  }
}