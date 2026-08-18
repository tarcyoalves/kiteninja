import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';
import { num, oneOf, str } from '@/lib/validation';
import type { Discipline } from '@/types';

const DISCIPLINES = [
  'Kitesurf Twintip',
  'Kitesurf Strapless Wave',
  'Hydrofoil',
  'Wingfoil',
  'Big Air',
] as const;

const UUID = /^[0-9a-f-]{36}$/i;

/** Distingue "campo não enviado" de "campo enviado vazio". */
function sent(body: unknown, field: string): boolean {
  return (
    body !== null &&
    typeof body === 'object' &&
    Object.prototype.hasOwnProperty.call(body, field) &&
    (body as Record<string, unknown>)[field] !== undefined
  );
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de sessão inválido.');

    // O filtro por user_id é o que impede apagar a sessão de outro velejador.
    const rows = await sql`
      DELETE FROM sessions_log
      WHERE id = ${id} AND user_id = ${user.id}
      RETURNING id
    `;

    if (rows.length === 0) {
      throw new HttpError(404, 'Sessão não encontrada ou sem permissão para excluir.');
    }

    // Chegou aqui: a sessão era do usuário, logo o post derivado também é.
    await sql`DELETE FROM posts WHERE session_id = ${id} AND user_id = ${user.id}`;

    return { ok: true };
  });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = await readJson(request);

    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de sessão inválido.');

    const owned = await sql`
      SELECT id FROM sessions_log WHERE id = ${id} AND user_id = ${user.id} LIMIT 1
    `;
    if (owned.length === 0) {
      throw new HttpError(404, 'Sessão não encontrada ou sem permissão para editar.');
    }

    // Campos ausentes viram null e o COALESCE preserva o valor atual da coluna.
    // Isso evita SQL montado por concatenação e mantém tudo parametrizado.
    const spotName = sent(body, 'spotName') ? str(body, 'spotName', { max: 200 }) : null;
    const spotLocation = sent(body, 'spotLocation') ? str(body, 'spotLocation', { max: 200 }) : null;
    const date = sent(body, 'date') ? str(body, 'date', { max: 10 }) : null;
    const startTime = sent(body, 'startTime') ? str(body, 'startTime', { max: 10 }) : null;
    const durationMinutes = sent(body, 'durationMinutes')
      ? num(body, 'durationMinutes', { min: 1, max: 1440 })
      : null;
    const discipline = sent(body, 'discipline')
      ? oneOf<Discipline>(body, 'discipline', DISCIPLINES as readonly Discipline[])
      : null;
    const kiteSizeM2 = sent(body, 'kiteSizeM2') ? num(body, 'kiteSizeM2', { min: 1, max: 25 }) : null;
    const boardModel = sent(body, 'boardModel')
      ? str(body, 'boardModel', { optional: true, max: 200 })
      : null;
    const avgWindKnots = sent(body, 'avgWindKnots')
      ? num(body, 'avgWindKnots', { min: 0, max: 80 })
      : null;
    const maxGustKnots = sent(body, 'maxGustKnots')
      ? num(body, 'maxGustKnots', { min: 0, max: 80 })
      : null;
    const windDirection = sent(body, 'windDirection')
      ? str(body, 'windDirection', { optional: true, max: 100 })
      : null;
    const tideCondition = sent(body, 'tideCondition')
      ? str(body, 'tideCondition', { optional: true, max: 100 })
      : null;
    const waterCondition = sent(body, 'waterCondition')
      ? str(body, 'waterCondition', { optional: true, max: 100 })
      : null;
    const rating = sent(body, 'rating') ? num(body, 'rating', { min: 1, max: 5 }) : null;
    const distanceKm = sent(body, 'distanceKm') ? num(body, 'distanceKm', { min: 0, max: 500 }) : null;
    const maxSpeedKnots = sent(body, 'maxSpeedKnots')
      ? num(body, 'maxSpeedKnots', { min: 0, max: 100 })
      : null;
    const highestJumpM = sent(body, 'highestJumpM')
      ? num(body, 'highestJumpM', { min: 0, max: 30 })
      : null;
    const notes = sent(body, 'notes') ? str(body, 'notes', { optional: true, max: 2000 }) : null;
    // Foto agora pode ser uma data URL base64 (upload comprimido no cliente),
    // que passa de 500 caracteres facilmente — 2MB de string cobre isso com folga.
    const photoUrl = sent(body, 'photoUrl') ? str(body, 'photoUrl', { optional: true, max: 1_500_000 }) : null;
    const isPublic = sent(body, 'isPublic')
      ? (body as Record<string, unknown>).isPublic === true
      : null;

    await sql`
      UPDATE sessions_log SET
        spot_name        = COALESCE(${spotName}, spot_name),
        spot_location    = COALESCE(${spotLocation}, spot_location),
        date             = COALESCE(${date}::date, date),
        start_time       = COALESCE(${startTime}, start_time),
        duration_minutes = COALESCE(${durationMinutes}, duration_minutes),
        discipline       = COALESCE(${discipline}, discipline),
        kite_size_m2     = COALESCE(${kiteSizeM2}, kite_size_m2),
        board_model      = COALESCE(${boardModel}, board_model),
        avg_wind_knots   = COALESCE(${avgWindKnots}, avg_wind_knots),
        max_gust_knots   = COALESCE(${maxGustKnots}, max_gust_knots),
        wind_direction   = COALESCE(${windDirection}, wind_direction),
        tide_condition   = COALESCE(${tideCondition}, tide_condition),
        water_condition  = COALESCE(${waterCondition}, water_condition),
        rating           = COALESCE(${rating}, rating),
        distance_km      = COALESCE(${distanceKm}, distance_km),
        max_speed_knots  = COALESCE(${maxSpeedKnots}, max_speed_knots),
        highest_jump_m   = COALESCE(${highestJumpM}, highest_jump_m),
        notes            = COALESCE(${notes}, notes),
        photo_url        = COALESCE(${photoUrl}, photo_url),
        is_public        = COALESCE(${isPublic}, is_public)
      WHERE id = ${id} AND user_id = ${user.id}
    `;

    // Reflete no post derivado, se houver. Só os campos enviados mudam.
    await sql`
      UPDATE posts SET
        spot_name     = COALESCE(${spotName}, spot_name),
        spot_location = COALESCE(${spotLocation}, spot_location),
        wind_knots    = COALESCE(${avgWindKnots}, wind_knots),
        content       = COALESCE(${notes}, content)
      WHERE session_id = ${id} AND user_id = ${user.id}
    `;

    const updated = await sql`
      SELECT id, spot_name, date, duration_minutes, rating, is_public
      FROM sessions_log WHERE id = ${id} AND user_id = ${user.id}
    `;

    return { ok: true, session: updated[0] ?? null };
  });
}
