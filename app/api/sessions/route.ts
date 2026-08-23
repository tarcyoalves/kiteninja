import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { bool, num, oneOf, str } from '@/lib/validation';
import type { Discipline } from '@/types';

const DISCIPLINES = [
  'Kitesurf Twintip',
  'Kitesurf Strapless Wave',
  'Hydrofoil',
  'Wingfoil',
  'Big Air',
] as const;

function toCamel(str: string): string {
  return str
    .replace(/_([a-z])/g, (_m, letter) => letter.toUpperCase());
}

function rowToCamel<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[toCamel(k)] = v;
  }
  return out;
}

export async function GET() {
  return handle(async () => {
    const user = await requireUser();

    // post_likes e post_comments têm chave composta, sem coluna `id` — a
    // contagem certa é por subquery. Um JOIN duplo (likes x comentários)
    // multiplicaria as linhas e infacionaria as duas contagens juntas.
    const rows = await sql`
      SELECT
        s.id,
        s.user_id,
        s.spot_id,
        s.spot_name,
        s.spot_location,
        s.date,
        s.start_time,
        s.duration_minutes,
        s.discipline,
        s.kite_size_m2,
        s.board_model,
        s.avg_wind_knots,
        s.max_gust_knots,
        s.wind_direction,
        s.tide_condition,
        s.water_condition,
        s.rating,
        s.distance_km,
        s.max_speed_knots,
        s.highest_jump_m,
        s.notes,
        s.photo_url,
        s.is_public,
        s.created_at,
        COALESCE((
          SELECT COUNT(*)::int FROM post_likes pl
          JOIN posts p ON p.id = pl.post_id
          WHERE p.session_id = s.id
        ), 0) AS likes_count,
        COALESCE((
          SELECT COUNT(*)::int FROM post_comments pc
          JOIN posts p ON p.id = pc.post_id
          WHERE p.session_id = s.id
        ), 0) AS comments_count
      FROM sessions_log s
      WHERE s.user_id = ${user.id}
      ORDER BY s.date DESC
      LIMIT 500
    `;

    const sessions = rows.map((row) => {
      const r = row as Record<string, unknown>;
      const session = rowToCamel(r);
      return {
        ...session,
        userId: String(r.user_id),
          spotId: r.spot_id ? String(r.spot_id) : null,
          spotName: String(r.spot_name),
          spotLocation: String(r.spot_location),
          date: String(r.date),
          startTime: String(r.start_time),
          durationMinutes: Number(r.duration_minutes),
          discipline: r.discipline as Discipline,
          kiteSizeM2: Number(r.kite_size_m2),
          boardModel: r.board_model ? String(r.board_model) : undefined,
          avgWindKnots: Number(r.avg_wind_knots),
          maxGustKnots: r.max_gust_knots ? Number(r.max_gust_knots) : undefined,
          windDirection: r.wind_direction ? String(r.wind_direction) : undefined,
          tideCondition: r.tide_condition ? String(r.tide_condition) : undefined,
          waterCondition: r.water_condition ? String(r.water_condition) : undefined,
          rating: Number(r.rating),
          distanceKm: r.distance_km ? Number(r.distance_km) : undefined,
          maxSpeedKnots: r.max_speed_knots ? Number(r.max_speed_knots) : undefined,
          highestJumpM: r.highest_jump_m ? Number(r.highest_jump_m) : undefined,
          notes: r.notes ? String(r.notes) : undefined,
          photoUrl: r.photo_url ? String(r.photo_url) : undefined,
          isPublic: Boolean(r.is_public),
          likesCount: Number(r.likes_count ?? 0),
          commentsCount: Number(r.comments_count ?? 0),
          createdAt: String(r.created_at),
        };
      });

    return { sessions };
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson(request);

    const spotId = (body as Record<string, unknown>)?.spotId
      ? String((body as Record<string, unknown>)?.spotId)
      : null;
    const spotName = str(body, 'spotName', { max: 200 });
    const spotLocation = str(body, 'spotLocation', { max: 200 });
    const date = str(body, 'date', { max: 10 });
    const startTime = str(body, 'startTime', { max: 10 });
    const durationMinutes = num(body, 'durationMinutes', { min: 1, max: 1440 });
    const discipline = oneOf<Discipline>(body, 'discipline', DISCIPLINES as unknown as readonly Discipline[]);
    const kiteSizeM2 = num(body, 'kiteSizeM2', { min: 1, max: 25 });
    const boardModel = str(body, 'boardModel', { optional: true, max: 200 });
    const avgWindKnots = num(body, 'avgWindKnots', { min: 0, max: 80 });
    const maxGustKnots = num(body, 'maxGustKnots', { optional: true, min: 0, max: 80 });
    const windDirection = str(body, 'windDirection', { optional: true, max: 100 });
    const tideCondition = str(body, 'tideCondition', { optional: true, max: 100 });
    const waterCondition = str(body, 'waterCondition', { optional: true, max: 100 });
    const rating = num(body, 'rating', { min: 1, max: 5, optional: false }) ?? 5;
    const distanceKm = num(body, 'distanceKm', { optional: true, min: 0, max: 500 });
    const maxSpeedKnots = num(body, 'maxSpeedKnots', { optional: true, min: 0, max: 100 });
    const highestJumpM = num(body, 'highestJumpM', { optional: true, min: 0, max: 30 });
    const notes = str(body, 'notes', { optional: true, max: 2000 });
    // Foto agora pode ser uma data URL base64 (upload comprimido no cliente),
    // que passa de 500 caracteres facilmente — 2MB de string cobre isso com folga.
    const photoUrl = str(body, 'photoUrl', { optional: true, max: 1_500_000 });
    const isPublic = bool(body, 'isPublic', true);

    const inserted = await sql`
      INSERT INTO sessions_log (
        user_id, spot_id, spot_name, spot_location, date, start_time,
        duration_minutes, discipline, kite_size_m2, board_model,
        avg_wind_knots, max_gust_knots, wind_direction, tide_condition,
        water_condition, rating, distance_km, max_speed_knots, highest_jump_m,
        notes, photo_url, is_public
      ) VALUES (
        ${user.id}, ${spotId || null}, ${spotName}, ${spotLocation}, ${date}, ${startTime},
        ${durationMinutes}, ${discipline}, ${kiteSizeM2}, ${boardModel || null},
        ${avgWindKnots}, ${maxGustKnots || null}, ${windDirection || null}, ${tideCondition || null},
        ${waterCondition || null}, ${rating}, ${distanceKm || null}, ${maxSpeedKnots || null},
        ${highestJumpM || null}, ${notes || null}, ${photoUrl || null}, ${isPublic}
      )
      RETURNING *
    `;

    const sessionRow = inserted[0] as Record<string, unknown>;
    const sessionId = String(sessionRow.id);

    // If public, create an auto-post in the feed
    if (isPublic) {
      const title = `Velejo no spot ${spotName}`;
      const content = notes
        ? notes
        : `Sessão concluída em ${spotLocation}! ${durationMinutes} minutos de velejo com pipa ${kiteSizeM2}m² e vento de ${avgWindKnots} nós.`;

      await sql`
        INSERT INTO posts (user_id, session_id, title, content, spot_name, spot_location)
        VALUES (${user.id}, ${sessionId}, ${title}, ${content}, ${spotName}, ${spotLocation})
      `;
    }

    return {
      id: sessionId,
      userId: user.id,
      spotId,
      spotName,
      spotLocation,
      date,
      startTime,
      durationMinutes,
      discipline,
      kiteSizeM2,
      boardModel: boardModel ?? undefined,
      avgWindKnots,
      maxGustKnots: maxGustKnots ?? undefined,
      windDirection: windDirection ?? undefined,
      tideCondition: tideCondition ?? undefined,
      waterCondition: waterCondition ?? undefined,
      rating,
      distanceKm: distanceKm ?? undefined,
      maxSpeedKnots: maxSpeedKnots ?? undefined,
      highestJumpM: highestJumpM ?? undefined,
      notes: notes ?? undefined,
      photoUrl: photoUrl ?? undefined,
      isPublic,
      createdAt: new Date().toISOString(),
    };
  });
}
