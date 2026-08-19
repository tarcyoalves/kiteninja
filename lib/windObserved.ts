/**
 * Vento MEDIDO (não previsão) da estação do Kite Clube Tremembé, via a API
 * pública do Wind Monitor (LH Provedor). API sem chave, sem login, CORS
 * aberto de propósito (`Access-Control-Allow-Origin: *`) — usamos com
 * User-Agent identificado e no mesmo ritmo em que o site atualiza (a cada
 * ~3 min), sem martelar o servidor deles.
 *
 * Camada separada da previsão de modelo (lib/weather.ts): aqui é leitura de
 * uma estação real num ponto físico, não um consenso de modelos atmosféricos
 * para qualquer coordenada. Rotule na UI como "medido" — misturar os dois
 * sem dizer qual é qual engana o velejador sobre a precisão de cada um.
 */
import 'server-only';

const BASE_URL = 'https://wind-monitor.lhprovedor.com.br';
const USER_AGENT = 'KiteNinja/1.0 (+https://kiteninja.vercel.app)';
const FETCH_TIMEOUT_MS = 5000;

/** Cache TTL casado com a cadência real da estação (amostra a cada 3 min). */
const CACHE_TTL_MS = 3 * 60 * 1000;

/** id do monitor "Kite Clube Tremembé" — descoberto via /api/wind-monitors/by-name/{slug}. */
export const MONITOR_TREMEMBE_ID = 'b7b8f7aa-1b02-11f1-9301-cc28aa1b4cbd';

export interface ObservedWind {
  /** Nós. */
  avgSpeed: number;
  maxSpeed: number;
  /** Quando a estação registrou essa leitura, não quando buscamos aqui. */
  lastRecordedAt: string;
}

interface CacheEntry {
  data: ObservedWind | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

async function fetchJson(path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Fonte externa fora do nosso controle: falhar aqui nunca pode derrubar
    // a tela do spot, que já tem a previsão de modelo como base.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Última leitura da estação, com cache curto para não pollar mais rápido que a fonte atualiza. */
export async function getObservedWind(monitorId: string): Promise<ObservedWind | null> {
  const cached = cache.get(monitorId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const raw = await fetchJson(`/api/wind-monitors/${monitorId}/speed-details`);
  const data = parseSpeedDetails(raw);

  cache.set(monitorId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export function parseSpeedDetails(raw: unknown): ObservedWind | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const avg = r._avg as Record<string, unknown> | undefined;
  const max = r._max as Record<string, unknown> | undefined;
  const avgSpeed = Number(avg?.speed);
  const maxSpeed = Number(max?.speed);
  const lastRecordedAt = r.lastRecordedAt;

  if (!Number.isFinite(avgSpeed) || !Number.isFinite(maxSpeed) || typeof lastRecordedAt !== 'string') {
    return null;
  }
  return { avgSpeed, maxSpeed, lastRecordedAt };
}
