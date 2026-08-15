import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { getSessionUser } from '@/lib/auth';
import { getManySpotsWeather } from '@/lib/weather';

/**
 * Lista os spots com vento, onda e maré reais da Open-Meteo.
 *
 * O banco guarda só o que não muda (coordenada, fundo, perigos, webcam); tudo
 * que é condição vem da API a cada requisição, com cache de 10 min no módulo de
 * clima. Se a Open-Meteo estiver fora, o spot volta com os campos de condição
 * zerados e `isLiveObservation: false` — a UI mostra o local sem inventar vento.
 */
export async function GET() {
  return handle(async () => {
    const user = await getSessionUser();

    const rows = await sql`
      SELECT id, name, location, state, country, country_flag, lat, lng,
             wind_safety, water_condition, bottom_type, difficulty,
             ideal_wind_directions, hazards, amenities,
             webcam_url, webcam_live_stream, cover_image
      FROM spots
      ORDER BY name ASC
    `;

    const base = rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
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
        webcamUrl: r.webcam_url ? String(r.webcam_url) : undefined,
        webcamLiveStream: Boolean(r.webcam_live_stream),
        coverImage: String(r.cover_image),
      };
    });

    // Uma chamada por coordenada, todas em paralelo e servidas do cache quando
    // dois spots repetem o mesmo par lat/lng arredondado.
    const weather = await getManySpotsWeather(base, 5);

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
        maxKnots: w?.maxKnots ?? 0,
        windDirectionDeg: w?.windDirectionDeg ?? 0,
        windDirectionText: w?.windDirectionText ?? '',
        temperature: w?.temperature ?? 0,
        weatherDescription: w?.weatherDescription ?? 'Sem dados',
        weatherIcon: w?.weatherIcon ?? ('sun' as const),
        isLiveObservation: w !== null,
        lastUpdated: w?.lastUpdated ?? '--:--',
        nextUpdate: w?.nextUpdate ?? '--:--',
        currentTideHeightM: w?.currentTideHeightM ?? 0,
        currentTideTrend: w?.currentTideTrend ?? ('estável' as const),
        nextTideInfo: w?.nextTideInfo ?? 'Sem dado de maré',
        waveHeightM: w?.waveHeightM ?? 0,
        wavePeriodS: w?.wavePeriodS ?? 0,
        daysForecast: w?.daysForecast ?? [],
      };
    });

    return { spots };
  });
}
