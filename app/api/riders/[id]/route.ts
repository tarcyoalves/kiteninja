import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';
import { podeVerSessao, relacaoComRider } from '@/lib/social';
import type { RiderProfile, SessionFeedItem } from '@/types';

const UUID = /^[0-9a-f-]{36}$/i;

/** Mesmo teto fixo da Fase 3 do feed (PAGE_SIZE=15), um pouco mais generoso
 * porque o perfil não pagina — quem quiser ver mais volta ao feed/logbook do
 * próprio dono. Keyset aqui seria complexidade sem uso real: o perfil é uma
 * vitrine recente, não uma lista que o velejador rola até o fim. */
const LIMITE_VELEJOS = 20;

interface RiderRow {
  id: unknown;
  name: unknown;
  avatar_url: unknown;
  rider_id: unknown;
  country_flag: unknown;
  nationality: unknown;
  rider_level: unknown;
  home_spot: unknown;
  bio: unknown;
  disciplines: unknown;
  seguidores: unknown;
  seguindo: unknown;
  eu_sigo: unknown;
  me_segue: unknown;
}

interface SessaoRow {
  id: unknown;
  spot_name: unknown;
  spot_location: unknown;
  created_at: unknown;
  duration_minutes: unknown;
  discipline: unknown;
  board_model: unknown;
  avg_wind_knots: unknown;
  max_gust_knots: unknown;
  distance_km: unknown;
  max_speed_knots: unknown;
  highest_jump_m: unknown;
  is_public: unknown;
  trilha_reduzida: unknown;
  curtidas: unknown;
  eu_curti: unknown;
  comentarios: unknown;
}

/**
 * Perfil público de um velejador (Fase 4 do plano de rede social, seção 4.1):
 * quem ele é + os velejos dele que EU posso ver — fecha o ciclo achar → seguir
 * → ver o velejo no feed, junto com a busca (Fase 2) e o feed (Fase 3).
 *
 * `requireUser()`: mesma disciplina de `riders/search` — o app é fechado por
 * convite, então um perfil sem sessão abriria dado de rider para fora.
 *
 * SELECT explícito, NUNCA `SELECT *`: e-mail, hash de senha, IP/user-agent e
 * contato de emergência não são perfil público (ver lib/authz.test.ts, que
 * audita esta rota contra vazamento de e-mail — mesma disciplina de
 * riders/search/route.ts).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de velejador inválido.');

    const rows = (await sql`
      SELECT
        u.id, u.name, u.avatar_url, u.rider_id, u.country_flag, u.nationality,
        u.rider_level, u.home_spot, u.bio, u.disciplines,
        COALESCE((
          SELECT COUNT(*)::int FROM user_follows f WHERE f.following_id = u.id
        ), 0) AS seguidores,
        COALESCE((
          SELECT COUNT(*)::int FROM user_follows f WHERE f.follower_id = u.id
        ), 0) AS seguindo,
        EXISTS (
          SELECT 1 FROM user_follows f WHERE f.follower_id = ${user.id} AND f.following_id = u.id
        ) AS eu_sigo,
        EXISTS (
          SELECT 1 FROM user_follows f WHERE f.follower_id = u.id AND f.following_id = ${user.id}
        ) AS me_segue
      FROM users u
      WHERE u.id = ${id} AND u.is_active = TRUE
      LIMIT 1
    `) as RiderRow[];

    // Conta inativa (desativada pelo admin) devolve 404 — a mesma resposta de
    // "não existe", para não confirmar a um velejador que um id específico
    // pertence a uma conta desativada.
    const r = rows[0];
    if (!r) throw new HttpError(404, 'Velejador não encontrado.');

    const rider: RiderProfile = {
      id: String(r.id),
      name: String(r.name),
      avatarUrl: r.avatar_url ? String(r.avatar_url) : undefined,
      riderId: String(r.rider_id),
      countryFlag: String(r.country_flag),
      nationality: String(r.nationality),
      riderLevel: String(r.rider_level) as RiderProfile['riderLevel'],
      homeSpot: r.home_spot ? String(r.home_spot) : undefined,
      bio: r.bio ? String(r.bio) : undefined,
      disciplines: Array.isArray(r.disciplines) ? (r.disciplines as RiderProfile['disciplines']) : [],
      seguidores: Number(r.seguidores),
      seguindo: Number(r.seguindo),
      relacao: relacaoComRider(Boolean(r.eu_sigo), Boolean(r.me_segue)),
    };

    // Velejos do perfil: MESMA regra de podeVerSessao da Fase 3 (lib/social.ts)
    // — a própria sessão do dono do perfil sempre entra (se EU for o dono),
    // de terceiro só a pública. A condição SQL já filtra por isso; o filtro
    // em JS logo abaixo (mesmo padrão de app/api/feed/route.ts) é rede de
    // segurança caso SQL e regra pura um dia divirjam.
    //
    // Sem paginação por keyset aqui de propósito (ver LIMITE_VELEJOS acima):
    // é um teto fixo das mais recentes, não uma lista rolável — a Fase 3 já
    // tem o feed com keyset para "rolar sem fim"; o perfil é uma vitrine.
    const sessaoRows = (await sql`
      SELECT
        s.id, s.spot_name, s.spot_location, s.created_at, s.duration_minutes,
        s.discipline, s.board_model, s.avg_wind_knots, s.max_gust_knots,
        s.distance_km, s.max_speed_knots, s.highest_jump_m, s.is_public, s.trilha_reduzida,
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
      WHERE s.user_id = ${id}
        AND (s.user_id = ${user.id} OR s.is_public = TRUE)
      ORDER BY s.created_at DESC
      LIMIT ${LIMITE_VELEJOS}
    `) as SessaoRow[];

    const velejos: SessionFeedItem[] = sessaoRows
      .filter((s) => podeVerSessao({ autorId: id, isPublic: Boolean(s.is_public) }, user.id))
      .map((s) => ({
        id: String(s.id),
        spotName: String(s.spot_name),
        spotLocation: String(s.spot_location),
        createdAt: String(s.created_at),
        durationMinutes: Number(s.duration_minutes),
        discipline: s.discipline as SessionFeedItem['discipline'],
        boardModel: s.board_model ? String(s.board_model) : undefined,
        avgWindKnots: Number(s.avg_wind_knots),
        maxGustKnots: s.max_gust_knots !== null ? Number(s.max_gust_knots) : undefined,
        distanceKm: s.distance_km !== null ? Number(s.distance_km) : undefined,
        maxSpeedKnots: s.max_speed_knots !== null ? Number(s.max_speed_knots) : undefined,
        highestJumpM: s.highest_jump_m !== null ? Number(s.highest_jump_m) : undefined,
        trilhaReduzida: Array.isArray(s.trilha_reduzida)
          ? (s.trilha_reduzida as SessionFeedItem['trilhaReduzida'])
          : undefined,
        // Autor é sempre o dono do perfil — sem JOIN em users, os mesmos
        // campos já vieram na consulta do rider acima (evita repetir o JOIN
        // que o feed precisa fazer porque lá o autor varia por linha).
        authorId: rider.id,
        authorName: rider.name,
        authorAvatarUrl: rider.avatarUrl,
        authorRiderId: rider.riderId,
        authorCountryFlag: rider.countryFlag,
        curtidas: Number(s.curtidas),
        euCurti: Boolean(s.eu_curti),
        comentarios: Number(s.comentarios),
      }));

    return { rider, velejos };
  });
}
