import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';
import { num, oneOf, str } from '@/lib/validation';
import { exigirSessaoVisivel } from '@/lib/sessaoAcesso';
import type { Discipline, SessionDetail } from '@/types';

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

interface SessaoDetalheRow {
  id: unknown;
  user_id: unknown;
  spot_name: unknown;
  spot_location: unknown;
  date: unknown;
  start_time: unknown;
  duration_minutes: unknown;
  discipline: unknown;
  kite_size_m2: unknown;
  board_model: unknown;
  avg_wind_knots: unknown;
  max_gust_knots: unknown;
  wind_direction: unknown;
  tide_condition: unknown;
  water_condition: unknown;
  rating: unknown;
  distance_km: unknown;
  max_speed_knots: unknown;
  highest_jump_m: unknown;
  notes: unknown;
  photo_url: unknown;
  foto_urls: unknown;
  is_public: unknown;
  trilha_reduzida: unknown;
  created_at: unknown;
  author_name: unknown;
  author_avatar_url: unknown;
  author_rider_id: unknown;
  author_country_flag: unknown;
  curtidas: unknown;
  eu_curti: unknown;
  comentarios: unknown;
}

/**
 * Detalhe completo de UMA sessão (Fase 5 do plano de rede social — tela de
 * detalhe com mapa full-bleed + estatísticas + comentários).
 *
 * DIFERENTE do DELETE/PATCH abaixo (só o dono): aqui a regra é a mesma do
 * feed, dono OU seguidor com sessão pública — por isso `exigirSessaoVisivel`
 * em vez de `WHERE user_id = ${user.id}`. Não confundir os dois padrões
 * dentro do mesmo arquivo.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de sessão inválido.');

    await exigirSessaoVisivel(id, user.id);

    // Só as 4 colunas de autor que o resto do app já usa (feed, comentários)
    // — nunca email/password_hash/last_ip/last_user_agent/emergency_contact_*.
    const rows = (await sql`
      SELECT
        s.id, s.user_id, s.spot_name, s.spot_location, s.date, s.start_time,
        s.duration_minutes, s.discipline, s.kite_size_m2, s.board_model,
        s.avg_wind_knots, s.max_gust_knots, s.wind_direction, s.tide_condition,
        s.water_condition, s.rating, s.distance_km, s.max_speed_knots,
        s.highest_jump_m, s.notes, s.photo_url, s.is_public, s.trilha_reduzida,
        s.created_at,
        -- Mesma leitura da listagem: todas as fotos, com a capa legada como
        -- rede de segurança. Ver o comentario em app/api/sessions/route.ts.
        COALESCE((
          SELECT array_agg(sp.url ORDER BY sp.ordem ASC, sp.created_at ASC)
          FROM session_photos sp WHERE sp.session_id = s.id
        ), CASE WHEN s.photo_url IS NULL THEN NULL ELSE ARRAY[s.photo_url] END) AS foto_urls,
        u.name AS author_name, u.avatar_url AS author_avatar_url,
        u.rider_id AS author_rider_id, u.country_flag AS author_country_flag,
        COALESCE((
          SELECT COUNT(*)::int FROM session_likes sl WHERE sl.session_id = s.id
        ), 0) AS curtidas,
        EXISTS (
          SELECT 1 FROM session_likes sl2
          WHERE sl2.session_id = s.id AND sl2.user_id = ${user.id}
        ) AS eu_curti,
        COALESCE((
          SELECT COUNT(*)::int FROM session_comments sc WHERE sc.session_id = s.id
        ), 0) AS comentarios
      FROM sessions_log s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ${id}
      LIMIT 1
    `) as SessaoDetalheRow[];

    const r = rows[0];
    if (!r) throw new HttpError(404, 'Sessão não encontrada.');

    const sessao: SessionDetail = {
      id: String(r.id),
      spotName: String(r.spot_name),
      spotLocation: String(r.spot_location),
      date: String(r.date),
      startTime: String(r.start_time),
      createdAt: String(r.created_at),
      durationMinutes: Number(r.duration_minutes),
      discipline: r.discipline as SessionDetail['discipline'],
      kiteSizeM2: Number(r.kite_size_m2),
      boardModel: r.board_model ? String(r.board_model) : undefined,
      avgWindKnots: Number(r.avg_wind_knots),
      maxGustKnots: r.max_gust_knots !== null ? Number(r.max_gust_knots) : undefined,
      windDirection: r.wind_direction ? String(r.wind_direction) : '',
      tideCondition: (r.tide_condition ? String(r.tide_condition) : '') as SessionDetail['tideCondition'],
      waterCondition: r.water_condition ? String(r.water_condition) : '',
      rating: Number(r.rating),
      distanceKm: r.distance_km !== null ? Number(r.distance_km) : undefined,
      maxSpeedKnots: r.max_speed_knots !== null ? Number(r.max_speed_knots) : undefined,
      highestJumpM: r.highest_jump_m !== null ? Number(r.highest_jump_m) : undefined,
      notes: r.notes ? String(r.notes) : undefined,
      fotoUrls: Array.isArray(r.foto_urls) ? (r.foto_urls as unknown[]).map(String) : [],
      photoUrl: Array.isArray(r.foto_urls) && r.foto_urls[0]
        ? String(r.foto_urls[0])
        : r.photo_url
          ? String(r.photo_url)
          : undefined,
      isPublic: Boolean(r.is_public),
      trilhaReduzida: Array.isArray(r.trilha_reduzida)
        ? (r.trilha_reduzida as SessionDetail['trilhaReduzida'])
        : undefined,
      authorId: String(r.user_id),
      authorName: String(r.author_name),
      authorAvatarUrl: r.author_avatar_url ? String(r.author_avatar_url) : undefined,
      authorRiderId: String(r.author_rider_id),
      authorCountryFlag: String(r.author_country_flag),
      curtidas: Number(r.curtidas),
      euCurti: Boolean(r.eu_curti),
      comentarios: Number(r.comentarios),
    };

    return { sessao };
  });
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
