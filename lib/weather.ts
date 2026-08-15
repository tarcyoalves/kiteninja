/**
 * Vento, onda e maré reais da Open-Meteo.
 *
 * São duas APIs distintas — previsão atmosférica e marinha — e nenhuma delas
 * pede chave. Pedimos os nós direto na API (`wind_speed_unit=kn`) para não
 * arredondar duas vezes, e o fuso America/Fortaleza para que o índice da hora
 * corresponda à hora local do velejador na praia.
 *
 * A API marinha não cobre todo ponto do litoral. Quando ela falha ou devolve
 * nulo, a previsão de vento continua valendo e os campos de onda/maré vêm
 * zerados: vento ruim cancela a sessão, falta de dado de onda não.
 */
import type { DayForecast, TideStatus, WindForecastHour } from '@/types';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const TZ = 'America/Fortaleza';

/** Cache em memória por instância serverless. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

type IconName = 'sun' | 'moon' | 'cloud-sun' | 'cloud-moon' | 'cloud' | 'rain';

interface HourlyBlock {
  time: string[];
  temperature_2m: number[];
  surface_pressure: number[];
  weather_code: number[];
  is_day: number[];
  wind_speed_10m: number[];
  wind_direction_10m: number[];
  wind_gusts_10m: number[];
}

interface MarineBlock {
  time: string[];
  wave_height: (number | null)[];
  wave_direction: (number | null)[];
  wave_period: (number | null)[];
  sea_level_height_msl: (number | null)[];
}

export interface SpotWeather {
  currentKnots: number;
  maxKnots: number;
  windDirectionDeg: number;
  windDirectionText: string;
  temperature: number;
  weatherDescription: string;
  weatherIcon: IconName;
  currentTideHeightM: number;
  currentTideTrend: TideStatus;
  nextTideInfo: string;
  waveHeightM: number;
  wavePeriodS: number;
  lastUpdated: string;
  nextUpdate: string;
  daysForecast: DayForecast[];
}

const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

/** Grau meteorológico (de onde o vento vem) para rosa dos ventos de 16 pontos. */
export function degToCompass(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360;
  return COMPASS[Math.round(normalized / 22.5) % 16];
}

/** Códigos WMO agrupados no que muda a decisão de velejar. */
export function describeWeather(code: number): string {
  if (code === 0) return 'Céu limpo';
  if (code <= 2) return 'Parcialmente nublado';
  if (code === 3) return 'Nublado';
  if (code <= 48) return 'Neblina';
  if (code <= 57) return 'Garoa';
  if (code <= 67) return 'Chuva';
  if (code <= 77) return 'Neve';
  if (code <= 82) return 'Pancadas de chuva';
  if (code <= 86) return 'Pancadas de neve';
  return 'Tempestade';
}

export function weatherIcon(code: number, isDay: boolean): IconName {
  if (code >= 51) return 'rain';
  if (code === 3) return 'cloud';
  if (code >= 1) return isDay ? 'cloud-sun' : 'cloud-moon';
  return isDay ? 'sun' : 'moon';
}

const WEEKDAYS = [
  'DOMINGO', 'SEGUNDA-FEIRA', 'TERÇA-FEIRA', 'QUARTA-FEIRA',
  'QUINTA-FEIRA', 'SEXTA-FEIRA', 'SÁBADO',
];
const MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/**
 * Interpreta "2026-08-14T09:00" como horário local, não UTC.
 * `new Date()` nessa string sem offset aplicaria o fuso do servidor — na Vercel,
 * UTC — e deslocaria toda a grade de horas em 3h.
 */
function parseLocal(iso: string): { y: number; m: number; d: number; h: number } {
  return {
    y: Number(iso.slice(0, 4)),
    m: Number(iso.slice(5, 7)),
    d: Number(iso.slice(8, 10)),
    h: Number(iso.slice(11, 13)),
  };
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function labelFor(iso: string, offsetFromToday: number) {
  const { y, m, d } = parseLocal(iso);
  // Domingo=0. Usa UTC para não reintroduzir o fuso do servidor no cálculo.
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const shortDate =
    offsetFromToday === 0
      ? `Hoje, ${d} ${MONTHS_SHORT[m - 1]}`
      : offsetFromToday === 1
        ? `Amanhã, ${d} ${MONTHS_SHORT[m - 1]}`
        : `${d} ${MONTHS_SHORT[m - 1]}`;
  return { dateStr: `${WEEKDAYS[weekday]}, ${dd}/${mm}`, shortDate };
}

function num(v: number | null | undefined, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

async function getJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Timeout ou rede: quem chama decide o que fazer com null.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tendência da maré comparando a altura anterior e a seguinte. Nos extremos da
 * série não há vizinho dos dois lados, então caímos para o vizinho existente.
 */
function tideTrendAt(
  levels: (number | null)[],
  i: number
): 'up' | 'down' | 'peak_high' | 'peak_low' {
  const prev = i > 0 ? levels[i - 1] : null;
  const cur = levels[i];
  const next = i + 1 < levels.length ? levels[i + 1] : null;
  if (typeof cur !== 'number') return 'up';

  const rising = typeof prev === 'number' ? cur > prev : typeof next === 'number' ? next > cur : true;
  const fallingNext = typeof next === 'number' ? next < cur : !rising;

  if (rising && fallingNext) return 'peak_high';
  if (!rising && typeof next === 'number' && next > cur) return 'peak_low';
  return rising ? 'up' : 'down';
}

function statusFromTrend(trend: 'up' | 'down' | 'peak_high' | 'peak_low'): TideStatus {
  if (trend === 'up') return 'subindo';
  if (trend === 'down') return 'descendo';
  return 'estável';
}

/** Próxima maré alta ou baixa a partir de `from`, como texto pronto para a UI. */
function nextTideText(times: string[], levels: (number | null)[], from: number): string {
  for (let i = from + 1; i < levels.length; i++) {
    const t = tideTrendAt(levels, i);
    if (t === 'peak_high' || t === 'peak_low') {
      const hh = times[i].slice(11, 16);
      const kind = t === 'peak_high' ? 'Alta' : 'Baixa';
      return `${kind} às ${hh} (${num(levels[i]).toFixed(1)}m)`;
    }
  }
  return 'Sem dado de maré';
}

/** Índice da hora mais próxima do agora, no fuso da série. */
function currentIndex(times: string[]): number {
  const nowLocal = new Date(Date.now()).toLocaleString('sv-SE', { timeZone: TZ }); // "YYYY-MM-DD HH:mm:ss"
  const target = `${nowLocal.slice(0, 10)}T${nowLocal.slice(11, 13)}:00`;
  const exact = times.indexOf(target);
  if (exact >= 0) return exact;
  // Série pode começar depois do agora (ou terminar antes): fica no limite.
  return times.findIndex((t) => t >= target) >= 0 ? times.findIndex((t) => t >= target) : 0;
}

const cache = new Map<string, { at: number; data: SpotWeather }>();

/**
 * Previsão completa de um ponto. `days` cobre a janela que a UI mostra.
 * Devolve null só se a previsão de vento falhar — sem vento não há tela útil.
 */
export async function getSpotWeather(
  lat: number,
  lng: number,
  days = 5
): Promise<SpotWeather | null> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)},${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const forecastQs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly:
      'temperature_2m,surface_pressure,weather_code,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    wind_speed_unit: 'kn',
    timezone: TZ,
    forecast_days: String(days),
  });
  const marineQs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: 'wave_height,wave_direction,wave_period,sea_level_height_msl',
    timezone: TZ,
    forecast_days: String(days),
  });

  // Em paralelo: a marinha é opcional e não deve somar latência.
  const [fc, mar] = await Promise.all([
    getJson<{ hourly: HourlyBlock }>(`${FORECAST_URL}?${forecastQs}`),
    getJson<{ hourly: MarineBlock }>(`${MARINE_URL}?${marineQs}`),
  ]);

  if (!fc?.hourly?.time?.length) return null;
  const h = fc.hourly;
  const m = mar?.hourly ?? null;

  // Alinha a série marinha pelo timestamp, não pelo índice: as duas APIs podem
  // devolver janelas diferentes.
  const marineIdx = new Map<string, number>();
  if (m?.time) m.time.forEach((t, i) => marineIdx.set(t, i));
  const marineLevels = m?.sea_level_height_msl ?? [];
  const marineTimes = m?.time ?? [];

  const byDay = new Map<string, WindForecastHour[]>();

  for (let i = 0; i < h.time.length; i++) {
    const iso = h.time[i];
    const mi = marineIdx.get(iso);
    const trend = mi === undefined ? 'up' : tideTrendAt(marineLevels, mi);

    const hour: WindForecastHour = {
      hour: `${iso.slice(11, 13)}h`,
      knots: Math.round(num(h.wind_speed_10m[i])),
      gustKnots: Math.round(num(h.wind_gusts_10m[i])),
      directionDeg: Math.round(num(h.wind_direction_10m[i])),
      directionText: degToCompass(num(h.wind_direction_10m[i])),
      conditionIcon: weatherIcon(num(h.weather_code[i]), num(h.is_day[i]) === 1),
      temperature: Math.round(num(h.temperature_2m[i])),
      pressureHpa: Math.round(num(h.surface_pressure[i])),
      waveHeightM: mi === undefined ? 0 : Number(num(m?.wave_height?.[mi]).toFixed(1)),
      wavePeriodS: mi === undefined ? 0 : Number(num(m?.wave_period?.[mi]).toFixed(1)),
      waveDirDeg: mi === undefined ? 0 : Math.round(num(m?.wave_direction?.[mi])),
      tideTrend: trend,
      tideHeightM: mi === undefined ? 0 : Number(num(marineLevels[mi]).toFixed(2)),
    };

    if (trend === 'peak_high' || trend === 'peak_low') {
      hour.tidePeakTime = iso.slice(11, 16);
      hour.tidePeakHeight = `${hour.tideHeightM.toFixed(1)}m`;
    }

    const k = dayKey(iso);
    const list = byDay.get(k);
    if (list) list.push(hour);
    else byDay.set(k, [hour]);
  }

  const dayKeys = [...byDay.keys()].sort();
  const daysForecast: DayForecast[] = dayKeys.map((k, idx) => ({
    ...labelFor(`${k}T00:00`, idx),
    hours: byDay.get(k)!,
  }));

  const now = currentIndex(h.time);
  const marineNow = marineIdx.get(h.time[now]);

  // Rajada máxima do dia de hoje: é isso que dita a escolha da kite.
  const todayHours = daysForecast[0]?.hours ?? [];
  const maxKnots = todayHours.reduce((acc, x) => Math.max(acc, x.gustKnots, x.knots), 0);

  const code = num(h.weather_code[now]);
  const nowTrend = marineNow === undefined ? 'up' : tideTrendAt(marineLevels, marineNow);

  const data: SpotWeather = {
    currentKnots: Math.round(num(h.wind_speed_10m[now])),
    maxKnots,
    windDirectionDeg: Math.round(num(h.wind_direction_10m[now])),
    windDirectionText: degToCompass(num(h.wind_direction_10m[now])),
    temperature: Math.round(num(h.temperature_2m[now])),
    weatherDescription: describeWeather(code),
    weatherIcon: weatherIcon(code, num(h.is_day[now]) === 1),
    currentTideHeightM:
      marineNow === undefined ? 0 : Number(num(marineLevels[marineNow]).toFixed(2)),
    currentTideTrend: statusFromTrend(nowTrend),
    nextTideInfo:
      marineNow === undefined
        ? 'Sem dado de maré'
        : nextTideText(marineTimes, marineLevels, marineNow),
    waveHeightM: marineNow === undefined ? 0 : Number(num(m?.wave_height?.[marineNow]).toFixed(1)),
    wavePeriodS: marineNow === undefined ? 0 : Number(num(m?.wave_period?.[marineNow]).toFixed(1)),
    lastUpdated: new Date().toLocaleTimeString('pt-BR', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
    }),
    nextUpdate: new Date(Date.now() + CACHE_TTL_MS).toLocaleTimeString('pt-BR', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
    }),
    daysForecast,
  };

  cache.set(key, { at: Date.now(), data });
  return data;
}

/** Busca vários pontos em paralelo; um ponto sem dado sai como null. */
export async function getManySpotsWeather(
  spots: { id: string; lat: number; lng: number }[],
  days = 5
): Promise<Map<string, SpotWeather | null>> {
  const results = await Promise.all(spots.map((s) => getSpotWeather(s.lat, s.lng, days)));
  return new Map(spots.map((s, i) => [s.id, results[i]]));
}
