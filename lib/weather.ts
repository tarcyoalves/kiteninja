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
import type {
  DayForecast,
  TideStatus,
  WindForecastHour,
  SailingScore,
  WindSafety,
} from '@/types';
import { calcularSailingScore } from './sailingScore';
import { calibrarNivelMareHarmonica, encontrarEstacaoMaregraficaMaisProxima } from './tideHarmonics';

/**
 * Radar de vento único: GFS (NOAA Seamless - Estados Unidos). Excelente
 * detecção de gradientes térmicos e vento sinótico, e o mais rápido/estável
 * dos modelos globais gratuitos da Open-Meteo — por isso é a única fonte.
 */
const FORECAST_MODELS = 'gfs_seamless';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const TZ = 'America/Fortaleza';

/**
 * Janela de validade da previsão.
 *
 * Vale para os dois níveis de cache: o Data Cache do Next (compartilhado entre
 * instâncias, em segundos) e o `Map` em memória desta instância (em ms). O
 * modelo GFS publica de hora em hora, então 10 min mantém a tela atual sem
 * bombardear a Open-Meteo.
 */
const CACHE_TTL_SEGUNDOS = 10 * 60;
const CACHE_TTL_MS = CACHE_TTL_SEGUNDOS * 1000;
const FETCH_TIMEOUT_MS = 8000;

type IconName = 'sun' | 'moon' | 'cloud-sun' | 'cloud-moon' | 'cloud' | 'rain';

interface HourlyBlock {
  time: string[];
  temperature_2m?: number[];
  surface_pressure?: number[];
  pressure_msl?: number[];
  weather_code?: number[];
  is_day?: number[];
  wind_speed_10m?: number[];
  wind_direction_10m?: number[];
  wind_gusts_10m?: number[];
  // Campos retornados com sufixo quando `models=gfs_seamless` é passado explicitamente
  temperature_2m_gfs_seamless?: number[];
  surface_pressure_gfs_seamless?: number[];
  pressure_msl_gfs_seamless?: number[];
  weather_code_gfs_seamless?: number[];
  is_day_gfs_seamless?: number[];
  wind_speed_10m_gfs_seamless?: number[];
  wind_direction_10m_gfs_seamless?: number[];
  wind_gusts_10m_gfs_seamless?: number[];
  [key: string]: unknown;
}

interface MarineBlock {
  time: string[];
  wave_height: (number | null)[];
  wave_direction: (number | null)[];
  wave_period: (number | null)[];
  wind_wave_height?: (number | null)[];
  wind_wave_direction?: (number | null)[];
  wind_wave_period?: (number | null)[];
  swell_wave_height?: (number | null)[];
  swell_wave_direction?: (number | null)[];
  swell_wave_period?: (number | null)[];
  sea_level_height_msl: (number | null)[];
}

export interface SpotWeather {
  currentKnots: number;
  avgKnots: number;
  maxKnots: number;
  gustKnots: number;
  windDirectionDeg: number;
  windDirectionText: string;
  windSafety?: WindSafety;
  temperature: number;
  weatherDescription: string;
  weatherIcon: IconName;
  /** `null` = API marinha não cobriu o spot. Ver `opt()` sobre o porquê. */
  currentTideHeightM: number | null;
  currentTideTrend: TideStatus | null;
  nextTideInfo: string;
  nextTideHeightM: number | null;
  nextTideTime: string | null;
  tideStationName?: string;
  waveHeightM: number | null;
  wavePeriodS: number | null;
  waveDirDeg?: number | null;
  swellHeightM?: number | null;
  swellPeriodS?: number | null;
  swellDirDeg?: number | null;
  windWaveHeightM?: number | null;
  windWavePeriodS?: number | null;
  windWaveDirDeg?: number | null;
  sailingScore?: SailingScore;
  lastUpdated: string;
  lastUpdatedFull: string;
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

/**
 * Igual a `num`, mas preserva a ausência de dado como `null` em vez de virar 0.
 * Usado nos campos de onda e maré: 0 ali é leitura válida, então confundir os
 * dois casos mostra previsão inventada quando a API marinha falha.
 */
function opt(v: number | null | undefined, decimais: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Number(v.toFixed(decimais));
}

/**
 * Busca com cache compartilhado entre instâncias.
 *
 * O `Map` no fim deste arquivo só vive dentro de uma instância serverless. Em
 * produção há muitas instâncias simultâneas, então N usuários no mesmo spot
 * viravam N chamadas à Open-Meteo mesmo com o cache "quente" — que é exatamente
 * o problema de escala apontado nas auditorias.
 *
 * `next: { revalidate }` põe a resposta no Data Cache do Next, que é
 * compartilhado entre todas as instâncias do deploy. Assim o mesmo spot gera
 * uma chamada externa a cada `CACHE_TTL_SEGUNDOS`, independente de quantos
 * usuários pedirem. Não exige Redis nem credencial nova.
 *
 * Com `semCache` (refresh explícito do usuário) volta a `no-store`: as duas
 * opções são mutuamente exclusivas no fetch do Next.
 */
async function getJson<T>(url: string, retries = 1, semCache = false): Promise<T | null> {
  const politicaDeCache: RequestInit = semCache
    ? { cache: 'no-store' }
    : ({ next: { revalidate: CACHE_TTL_SEGUNDOS } } as RequestInit);
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal, ...politicaDeCache });
      if (res.ok) {
        return (await res.json()) as T;
      }
    } catch {
      // Timeout ou rede
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return null;
}

/**
 * Resolve a coordenada marinha correspondente em mar aberto (offshore).
 *
 * Pontos de praia/costa muitas vezes caem em células continentais na grade
 * da API marinha (ex.: elevação de 62m em Barra de Pernambuquinho), distorcendo
 * a fase da maré e os cálculos de onda. Deslocar alguns km para o mar aberto
 * garante resolução em célula puramente oceânica com elevação ~0m.
 */
export function getMarineCoordinates(lat: number, lng: number): { lat: number; lng: number } {
  // Litoral do Nordeste (RN, CE, PI, MA): oceano fica ao norte/nordeste
  if (lat > -8.0 && lat < 0 && lng > -45.0 && lng < -34.0) {
    return {
      lat: Number((lat + 0.08).toFixed(4)),
      lng: Number((lng + 0.02).toFixed(4)),
    };
  }

  // Litoral Sudeste/Sul (RJ, SP, SC, RS): oceano fica ao sul/sudeste
  if (lat <= -20.0 && lng > -48.0 && lng < -40.0) {
    return {
      lat: Number((lat - 0.08).toFixed(4)),
      lng: Number((lng + 0.02).toFixed(4)),
    };
  }

  // Padrão de deslocamento leve mar adentro
  return { lat, lng };
}

/**
 * Converte anomalia bruta da Open-Meteo Marine (MSL, Nível Médio = 0m) para
 * o Datum Náutico / Zero Hidrográfico (Zero da Carta Náutica / DHN / Windfinder).
 *
 * Em cartas náuticas e no Windfinder, a maré 0.0m representa a maré astronômica
 * mais baixa (Lowest Astronomical Tide). A maré seca fica em torno de 0.4m ~ 0.9m
 * e a maré cheia atinge 2.6m ~ 3.4m no Nordeste brasileiro.
 */
export function toChartDatum(
  rawMsl: number | null | undefined,
  lat: number,
  lng: number
): number | null {
  if (typeof rawMsl !== 'number' || !Number.isFinite(rawMsl)) return null;

  // Litoral Equatorial / Nordeste (RN, CE, PI, MA, PB, PE)
  if (lat > -10.0 && lat < 0 && lng > -45.0 && lng < -34.0) {
    const nautico = rawMsl * 1.25 + 1.85;
    return Math.max(0.1, Number(nautico.toFixed(2)));
  }
  // Macro-maré Norte (PA, AP, Maranhão ocidental)
  if (lat >= -2.0 && lng <= -45.0) {
    const nautico = rawMsl * 1.4 + 2.5;
    return Math.max(0.1, Number(nautico.toFixed(2)));
  }
  // Litoral Leste / Bahia / Sergipe / Alagoas
  if (lat <= -9.0 && lat > -18.0 && lng > -42.0) {
    const nautico = rawMsl * 1.2 + 1.5;
    return Math.max(0.1, Number(nautico.toFixed(2)));
  }
  // Litoral Sudeste / Sul (ES, RJ, SP, PR, SC, RS)
  if (lat <= -18.0) {
    const nautico = rawMsl * 1.1 + 1.1;
    return Math.max(0.1, Number(nautico.toFixed(2)));
  }

  // Padrão náutico geral
  const nautico = rawMsl * 1.2 + 1.6;
  return Math.max(0.1, Number(nautico.toFixed(2)));
}

/**
 * Tendência da maré comparando a altura anterior e a seguinte. Nos extremos da
 * série não há vizinho dos dois lados, então caímos para o vizinho existente.
 *
 * Devolve `null` quando não há altura medida nesta hora: antes retornava 'up',
 * e a tela exibia "enchendo" sem nenhuma medição por trás.
 */
export function tideTrendAt(
  levels: (number | null)[],
  i: number
): 'up' | 'down' | 'peak_high' | 'peak_low' | null {
  const prev = i > 0 ? levels[i - 1] : null;
  const cur = levels[i];
  const next = i + 1 < levels.length ? levels[i + 1] : null;
  if (typeof cur !== 'number') return null;

  const rising = typeof prev === 'number' ? cur > prev : typeof next === 'number' ? next > cur : true;
  const fallingNext = typeof next === 'number' ? next < cur : !rising;

  if (rising && fallingNext) return 'peak_high';
  if (!rising && typeof next === 'number' && next > cur) return 'peak_low';
  return rising ? 'up' : 'down';
}

/**
 * Interpolação parabólica (3 pontos) para estimar o minuto exato e a altura
 * real do pico de preamar ou baixa-mar entre amostras horárias discretas.
 */
export function interpolateTidePeak(
  times: string[],
  levels: (number | null)[],
  i: number
): { peakTime: string; peakHeight: string; peakHeightM: number } {
  const cur = levels[i];
  if (typeof cur !== 'number' || !times[i]) {
    return { peakTime: '--:--', peakHeight: '0.0m', peakHeightM: 0 };
  }

  const prev = i > 0 && typeof levels[i - 1] === 'number' ? levels[i - 1]! : cur;
  const next = i + 1 < levels.length && typeof levels[i + 1] === 'number' ? levels[i + 1]! : cur;

  const y0 = prev;
  const y1 = cur;
  const y2 = next;

  const denom = y0 - 2 * y1 + y2;
  let deltaHours = 0;
  let peakHeightM = y1;

  // Se os 3 pontos formam uma curvatura não nula
  if (Math.abs(denom) > 1e-5) {
    deltaHours = (y0 - y2) / (2 * denom);
    // Limita o deslocamento a [-0.5, +0.5] horas para não vazar do intervalo da amostra
    deltaHours = Math.max(-0.5, Math.min(0.5, deltaHours));
    peakHeightM = y1 - ((y0 - y2) * (y0 - y2)) / (8 * denom);
  }

  const baseIso = times[i];
  const baseHour = Number(baseIso.slice(11, 13));
  const totalMinutes = Math.round(baseHour * 60 + deltaHours * 60);
  const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  const finalHour = Math.floor(normalizedMinutes / 60);
  const finalMin = normalizedMinutes % 60;

  const hh = String(finalHour).padStart(2, '0');
  const mm = String(finalMin).padStart(2, '0');

  return {
    peakTime: `${hh}:${mm}`,
    peakHeight: `${peakHeightM.toFixed(1)}m`,
    peakHeightM: Number(peakHeightM.toFixed(2)),
  };
}

export function statusFromTrend(trend: 'up' | 'down' | 'peak_high' | 'peak_low'): TideStatus {
  if (trend === 'up') return 'subindo';
  if (trend === 'down') return 'descendo';
  return 'estável';
}

export function nextTideDetails(
  times: string[],
  levels: (number | null)[],
  from: number
): { text: string; peakHeightM: number | null; peakTime: string | null } {
  for (let i = from + 1; i < levels.length; i++) {
    const t = tideTrendAt(levels, i);
    if (t === 'peak_high' || t === 'peak_low') {
      const { peakTime, peakHeight, peakHeightM } = interpolateTidePeak(times, levels, i);
      const kind = t === 'peak_high' ? 'Alta' : 'Baixa';
      return {
        text: `${kind} às ${peakTime} (${peakHeight})`,
        peakHeightM,
        peakTime,
      };
    }
  }
  return { text: 'Sem dado de maré', peakHeightM: null, peakTime: null };
}

/** Próxima maré alta ou baixa a partir de `from`, com minutos interpolados e altura precisa. */
export function nextTideText(times: string[], levels: (number | null)[], from: number): string {
  return nextTideDetails(times, levels, from).text;
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
  days = 7,
  forceRefresh = false
): Promise<SpotWeather | null> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)},${days}`;
  const hit = cache.get(key);
  if (!forceRefresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const marineCoords = getMarineCoordinates(lat, lng);

  const forecastQs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly:
      'temperature_2m,pressure_msl,surface_pressure,weather_code,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    wind_speed_unit: 'kn',
    timezone: TZ,
    forecast_days: String(days),
    models: FORECAST_MODELS,
  });
  const marineQs = new URLSearchParams({
    latitude: String(marineCoords.lat),
    longitude: String(marineCoords.lng),
    hourly:
      'wave_height,wave_direction,wave_period,wind_wave_height,wind_wave_direction,wind_wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_level_height_msl',
    timezone: TZ,
    forecast_days: String(days),
  });

  // Em paralelo: a marinha é opcional e não deve somar latência.
  const [fc, mar] = await Promise.all([
    getJson<{ hourly: HourlyBlock }>(`${FORECAST_URL}?${forecastQs}`, 1, forceRefresh),
    getJson<{ hourly: MarineBlock }>(`${MARINE_URL}?${marineQs}`, 1, forceRefresh),
  ]);

  // Fallback: se rede falhar completamente, aproveita cache anterior (stale-while-revalidate)
  if (!fc?.hourly?.time?.length) {
    if (hit?.data) return hit.data;
    return null;
  }
  const h = fc.hourly;
  const m = mar?.hourly ?? null;

  const estacaoMare = encontrarEstacaoMaregraficaMaisProxima(lat, lng);
  const marineLevels = (m?.sea_level_height_msl ?? []).map(
    (lvl) => calibrarNivelMareHarmonica(lvl, lat, lng).nivelNauticoM
  );
  const marineIdx = new Map<string, number>();
  if (m?.time) {
    for (let i = 0; i < m.time.length; i++) marineIdx.set(m.time[i], i);
  }
  const marineTimes = m?.time ?? [];

  // Arrays com fallback para suportar respostas com sufixo (_gfs_seamless) ou sem sufixo
  const temps = h.temperature_2m_gfs_seamless ?? h.temperature_2m ?? [];
  const pressures = h.pressure_msl_gfs_seamless ?? h.pressure_msl ?? h.surface_pressure_gfs_seamless ?? h.surface_pressure ?? [];
  const codes = h.weather_code_gfs_seamless ?? h.weather_code ?? [];
  const isDays = h.is_day_gfs_seamless ?? h.is_day ?? [];
  const gfsWinds = h.wind_speed_10m_gfs_seamless ?? h.wind_speed_10m ?? [];
  const dirs = h.wind_direction_10m_gfs_seamless ?? h.wind_direction_10m ?? [];
  const gusts = h.wind_gusts_10m_gfs_seamless ?? h.wind_gusts_10m ?? [];

  const byDay = new Map<string, WindForecastHour[]>();

  for (let i = 0; i < h.time.length; i++) {
    const iso = h.time[i];
    const mi = marineIdx.get(iso);
    const trend = mi === undefined ? null : tideTrendAt(marineLevels, mi);

    const gfsKts = num(gfsWinds[i]);

    const dirDeg = Math.round(num(dirs[i]));
    let safety: WindSafety = 'Side-Onshore';
    if (dirDeg >= 60 && dirDeg <= 135) safety = 'Side-Onshore';
    else if (dirDeg > 135 && dirDeg <= 170) safety = 'Side-Shore';
    else if (dirDeg > 170 && dirDeg <= 230) safety = 'Side-Offshore';
    else if (dirDeg > 230 && dirDeg <= 310) safety = 'Offshore';
    else safety = 'Onshore';

    const knotsHour = Math.round(gfsKts);
    const gustHour = Math.round(num(gusts[i]));

    // Para onda na praia, a vaga costeira (wind_wave_height) reflete com precisão as condições locais
    const coastalWaveHeight = opt(m?.wind_wave_height?.[mi ?? -1], 1) ?? opt(m?.wave_height?.[mi ?? -1], 1);

    const scoreHour = calcularSailingScore({
      knots: knotsHour,
      gustKnots: gustHour,
      windSafety: safety,
      waveHeightM: coastalWaveHeight,
    });

    const hour: WindForecastHour = {
      hour: `${iso.slice(11, 13)}h`,
      knots: knotsHour,
      gustKnots: gustHour,
      directionDeg: dirDeg,
      directionText: degToCompass(dirDeg),
      conditionIcon: weatherIcon(num(codes[i]), num(isDays[i]) === 1),
      temperature: Math.round(num(temps[i])),
      pressureHpa: Math.round(num(pressures[i])),
      waveHeightM: coastalWaveHeight,
      wavePeriodS: opt(m?.wave_period?.[mi ?? -1], 1),
      waveDirDeg: opt(m?.wave_direction?.[mi ?? -1], 0),
      swellHeightM: opt(m?.swell_wave_height?.[mi ?? -1], 1),
      swellPeriodS: opt(m?.swell_wave_period?.[mi ?? -1], 1),
      swellDirDeg: opt(m?.swell_wave_direction?.[mi ?? -1], 0),
      windWaveHeightM: opt(m?.wind_wave_height?.[mi ?? -1], 1),
      windWavePeriodS: opt(m?.wind_wave_period?.[mi ?? -1], 1),
      windWaveDirDeg: opt(m?.wind_wave_direction?.[mi ?? -1], 0),
      tideTrend: trend,
      tideHeightM: opt(marineLevels[mi ?? -1], 2),
      sailingScore: scoreHour,
    };

    if (mi !== undefined && (trend === 'peak_high' || trend === 'peak_low')) {
      const { peakTime, peakHeight } = interpolateTidePeak(marineTimes, marineLevels, mi);
      hour.tidePeakTime = peakTime;
      hour.tidePeakHeight = peakHeight;
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
  const nowNext = Math.min(h.time.length - 1, now + 1);
  const marineNow = marineIdx.get(h.time[now]);

  // Rajada máxima do dia de hoje: é isso que dita a escolha da kite.
  const todayHours = daysForecast[0]?.hours ?? [];
  const maxKnots = todayHours.reduce((acc, x) => Math.max(acc, x.gustKnots, x.knots), 0);

  const code = num(codes[now]);
  const nowTrend = marineNow === undefined ? null : tideTrendAt(marineLevels, marineNow);

  // Interpolação minuto a minuto em tempo real entre a hora atual e a próxima
  const nowDt = new Date();
  const minuteFraction = nowDt.getMinutes() / 60;

  const nowGfs = num(gfsWinds[now]) * (1 - minuteFraction) + num(gfsWinds[nowNext]) * minuteFraction;
  const currentKnots = Math.round(nowGfs);
  const nowGust = Math.round(num(gusts[now]) * (1 - minuteFraction) + num(gusts[nowNext]) * minuteFraction);
  const gustKnots = Math.max(nowGust, currentKnots);
  const avgKnots = Math.max(8, Math.round(currentKnots * 0.92));

  const nowDirDeg = Math.round(num(dirs[now]));
  let currentSafety: WindSafety = 'Side-Onshore';
  if (nowDirDeg >= 60 && nowDirDeg <= 135) currentSafety = 'Side-Onshore';
  else if (nowDirDeg > 135 && nowDirDeg <= 170) currentSafety = 'Side-Shore';
  else if (nowDirDeg > 170 && nowDirDeg <= 230) currentSafety = 'Side-Offshore';
  else if (nowDirDeg > 230 && nowDirDeg <= 310) currentSafety = 'Offshore';
  else currentSafety = 'Onshore';

  const currentSailingScore = calcularSailingScore({
    knots: currentKnots,
    gustKnots,
    windSafety: currentSafety,
    waveHeightM: opt(m?.wave_height?.[marineNow ?? -1], 1),
  });

  const tideDetail =
    marineNow === undefined ? null : nextTideDetails(marineTimes, marineLevels, marineNow);

  const dateFormatted = nowDt.toLocaleDateString('pt-BR', { timeZone: TZ });
  const timeFormatted = nowDt.toLocaleTimeString('pt-BR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
  const lastUpdatedFull = `${dateFormatted} às ${timeFormatted} - (-3 UTC)`;

  const data: SpotWeather = {
    currentKnots,
    avgKnots,
    maxKnots,
    gustKnots,
    windDirectionDeg: nowDirDeg,
    windDirectionText: degToCompass(nowDirDeg),
    windSafety: currentSafety,
    temperature: Math.round(num(temps[now])),
    weatherDescription: describeWeather(code),
    weatherIcon: weatherIcon(code, num(isDays[now]) === 1),
    currentTideHeightM: opt(marineLevels[marineNow ?? -1], 2),
    currentTideTrend: nowTrend === null ? null : statusFromTrend(nowTrend),
    nextTideInfo: tideDetail?.text ?? 'Sem dado de maré',
    nextTideHeightM: tideDetail?.peakHeightM ?? null,
    nextTideTime: tideDetail?.peakTime ?? null,
    tideStationName: estacaoMare.nome,
    waveHeightM: opt(m?.wave_height?.[marineNow ?? -1], 1),
    wavePeriodS: opt(m?.wave_period?.[marineNow ?? -1], 1),
    waveDirDeg: opt(m?.wave_direction?.[marineNow ?? -1], 0),
    swellHeightM: opt(m?.swell_wave_height?.[marineNow ?? -1], 1),
    swellPeriodS: opt(m?.swell_wave_period?.[marineNow ?? -1], 1),
    swellDirDeg: opt(m?.swell_wave_direction?.[marineNow ?? -1], 0),
    windWaveHeightM: opt(m?.wind_wave_height?.[marineNow ?? -1], 1),
    windWavePeriodS: opt(m?.wind_wave_period?.[marineNow ?? -1], 1),
    windWaveDirDeg: opt(m?.wind_wave_direction?.[marineNow ?? -1], 0),
    sailingScore: currentSailingScore,
    lastUpdated: timeFormatted,
    lastUpdatedFull,
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

/** Busca vários pontos com coordenadas exatas e controle de concorrência. */
export async function getManySpotsWeather(
  spots: { id: string; lat: number; lng: number }[],
  days = 7,
  forceRefresh = false
): Promise<Map<string, SpotWeather | null>> {
  const BATCH_SIZE = 4;
  const out = new Map<string, SpotWeather | null>();

  for (let i = 0; i < spots.length; i += BATCH_SIZE) {
    const batch = spots.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (s) => {
        const weather = await getSpotWeather(s.lat, s.lng, days, forceRefresh);
        return [s.id, weather] as const;
      })
    );
    for (const [id, weather] of batchResults) {
      out.set(id, weather);
    }
  }

  return out;
}
