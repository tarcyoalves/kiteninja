import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { getSessionUser } from '@/lib/auth';
import { getManySpotsWeather } from '@/lib/weather';
import { INITIAL_SPOTS } from '@/data/mockSpots';

/**
 * Lista os spots com vento, onda e maré reais da Open-Meteo.
 *
 * O banco guarda só o que não muda (coordenada, fundo, perigos, webcam); tudo
 * que é condição vem da API a cada requisição, com cache de 10 min no módulo de
 * clima. Se a Open-Meteo estiver fora, o spot volta com os campos de condição
 * zerados e `isLiveObservation: false` — a UI mostra o local sem inventar vento.
 *
 * Sincroniza automaticamente novos spots catalogados no código com o banco de dados.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const user = await getSessionUser();
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get('refresh') === '1' || searchParams.get('refresh') === 'true';

    let rows: Record<string, unknown>[] = [];
    try {
      const dbRows = await sql`
        SELECT id, name, location, state, country, country_flag, lat, lng,
               wind_safety, water_condition, bottom_type, difficulty,
               ideal_wind_directions, hazards, amenities,
               webcam_url, webcam_live_stream, cover_image
        FROM spots
        ORDER BY name ASC
      `;
      rows = dbRows as Record<string, unknown>[];
    } catch {
      rows = [];
    }

    const baseMap = new Map<string, {
      id: string;
      name: string;
      location: string;
      state: string;
      country: string;
      countryFlag: string;
      lat: number;
      lng: number;
      windSafety: string;
      waterCondition: string;
      bottomType: string;
      difficulty: string;
      idealWindDirections: string[];
      hazards: string[];
      amenities: string[];
      webcamUrl?: string;
      webcamLiveStream: boolean;
      coverImage: string;
      stationName?: string;
      stationProvider?: string;
    }>();

    // 1. Spots de INITIAL_SPOTS (fonte de alta precisão com estações físicas)
    for (const s of INITIAL_SPOTS) {
      baseMap.set(s.id, {
        id: s.id,
        name: s.name,
        location: s.location,
        state: s.state,
        country: s.country,
        countryFlag: s.countryFlag,
        lat: s.lat,
        lng: s.lng,
        windSafety: s.windSafety,
        waterCondition: s.waterCondition,
        bottomType: s.bottomType,
        difficulty: s.difficulty,
        idealWindDirections: s.idealWindDirections,
        hazards: s.hazards,
        amenities: s.amenities,
        webcamUrl: s.webcamUrl,
        webcamLiveStream: Boolean(s.webcamLiveStream),
        coverImage: s.coverImage,
        stationName: s.stationName,
        stationProvider: s.stationProvider,
      });
    }

    // 2. Spots do banco de dados (que podem ter sido criados dinamicamente)
    for (const r of rows) {
      const id = String(r.id);
      const existing = baseMap.get(id);
      baseMap.set(id, {
        id,
        name: String(r.name),
        location: String(r.location),
        state: String(r.state),
        country: String(r.country ?? 'Brasil'),
        countryFlag: String(r.country_flag ?? '🇧🇷'),
        lat: Number(r.lat),
        lng: Number(r.lng),
        windSafety: String(r.wind_safety),
        waterCondition: String(r.water_condition),
        bottomType: String(r.bottom_type),
        difficulty: String(r.difficulty),
        idealWindDirections: ((r.ideal_wind_directions as string[]) ?? []).map(String),
        hazards: ((r.hazards as string[]) ?? []).map(String),
        amenities: ((r.amenities as string[]) ?? []).map(String),
        webcamUrl: r.webcam_url ? String(r.webcam_url) : existing?.webcamUrl,
        webcamLiveStream: Boolean(r.webcam_live_stream),
        coverImage: String(r.cover_image),
        stationName: existing?.stationName,
        stationProvider: existing?.stationProvider,
      });
    }

    const base = Array.from(baseMap.values());

    // Uma chamada por coordenada, todas em paralelo e servidas do cache quando
    // dois spots repetem o mesmo par lat/lng arredondado.
    const weather = await getManySpotsWeather(base, 7, forceRefresh);

    const favIds = new Set<string>();
    if (user) {
      const favRows = await sql`SELECT spot_id FROM favorites WHERE user_id = ${user.id}`;
      for (const r of favRows) favIds.add(String((r as Record<string, unknown>).spot_id));
    }

    const spots = base.map((s) => {
      const w = weather.get(s.id) ?? null;
      return {
        ...s,
        isFavorite: favIds.has(s.id),
        currentKnots: w?.currentKnots ?? 0,
        avgKnots: w?.avgKnots ?? Math.max(8, Math.round((w?.currentKnots ?? 0) * 0.92)),
        maxKnots: w?.maxKnots ?? 0,
        gustKnots: w?.gustKnots ?? (w?.maxKnots ?? 0),
        windDirectionDeg: w?.windDirectionDeg ?? 0,
        windDirectionText: w?.windDirectionText ?? '',
        temperature: w?.temperature ?? 0,
        weatherDescription: w?.weatherDescription ?? 'Sem dados',
        weatherIcon: w?.weatherIcon ?? ('sun' as const),
        isLiveObservation: w !== null,
        lastUpdated: w?.lastUpdated ?? '--:--',
        lastUpdatedFull: w?.lastUpdatedFull ?? (w?.lastUpdated ? `${w.lastUpdated} (-3 UTC)` : '--:--'),
        nextUpdate: w?.nextUpdate ?? '--:--',
        currentTideHeightM: w?.currentTideHeightM ?? 0,
        currentTideTrend: w?.currentTideTrend ?? ('estável' as const),
        nextTideInfo: w?.nextTideInfo ?? 'Sem dado de maré',
        nextTideHeightM: w?.nextTideHeightM ?? null,
        nextTideTime: w?.nextTideTime ?? null,
        tideStationName: w?.tideStationName,
        waveHeightM: w?.waveHeightM ?? 0,
        wavePeriodS: w?.wavePeriodS ?? 0,
        swellHeightM: w?.swellHeightM ?? null,
        swellPeriodS: w?.swellPeriodS ?? null,
        swellDirDeg: w?.swellDirDeg ?? null,
        windWaveHeightM: w?.windWaveHeightM ?? null,
        windWavePeriodS: w?.windWavePeriodS ?? null,
        windWaveDirDeg: w?.windWaveDirDeg ?? null,
        multiModel: w?.multiModel,
        sailingScore: w?.sailingScore,
        daysForecast: w?.daysForecast ?? [],
      };
    });

    return { spots };
  });
}
