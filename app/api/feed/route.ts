import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { podeVerSessao } from '@/lib/social';
import type { SessionFeedItem } from '@/types';

/**
 * Feed de velejos (Fase 3 do plano de rede social) — sessões de quem eu sigo
 * mais as minhas, mais recentes primeiro.
 *
 * Regra de visibilidade replicada aqui em SQL, mas com a MESMA forma de
 * `lib/social.ts` (`podeVerSessao`): minha sessão sempre entra (pública ou
 * não); a de quem eu sigo só entra se `is_public = TRUE`. O feed NÃO é "toda
 * sessão pública do app" — só quem eu sigo, mesmo que pública, é ruído do
 * primeiro dia (ver seção 4.4 do plano). Um filtro final em JS com a própria
 * `podeVerSessao` funciona de rede de segurança: se um dia a condição SQL e a
 * regra pura divergirem por um bug, o filtro em JS barra o vazamento antes de
 * sair na resposta, em vez de confiar cegamente que o SQL acertou.
 */
const PAGE_SIZE = 15;

interface FeedRow {
  id: unknown;
  user_id: unknown;
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
  author_name: unknown;
  author_avatar_url: unknown;
  author_rider_id: unknown;
  author_country_flag: unknown;
  curtidas: unknown;
  eu_curti: unknown;
  comentarios: unknown;
}

/** Cursor precisa ser uma data válida ou ausente — qualquer outra coisa (um
 * bug de cliente, um valor colado à mão na URL) vira "sem cursor", não erro
 * 400: melhor devolver a primeira página do que quebrar o scroll infinito. */
function parseCursor(raw: string | null): string | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    const cursor = parseCursor(url.searchParams.get('cursor'));

    // Paginação KEYSET (created_at < cursor), nunca OFFSET — ver seção 3
    // (Fluidez) do plano: OFFSET fica mais lento a cada página que o
    // velejador rola, keyset é sempre o mesmo custo. Busca PAGE_SIZE + 1 para
    // saber se existe próxima página sem um segundo COUNT(*) só para isso.
    const rows = (await sql`
      SELECT
        s.id, s.user_id, s.spot_name, s.spot_location, s.created_at,
        s.duration_minutes, s.discipline, s.board_model,
        s.avg_wind_knots, s.max_gust_knots, s.distance_km, s.max_speed_knots,
        s.highest_jump_m, s.is_public, s.trilha_reduzida,
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
      WHERE (
        s.user_id = ${user.id}
        OR (
          s.is_public = TRUE
          AND EXISTS (
            SELECT 1 FROM user_follows f
            WHERE f.follower_id = ${user.id} AND f.following_id = s.user_id
          )
        )
      )
      AND (${cursor}::timestamptz IS NULL OR s.created_at < ${cursor}::timestamptz)
      ORDER BY s.created_at DESC
      LIMIT ${PAGE_SIZE + 1}
    `) as FeedRow[];

    const temProximaPagina = rows.length > PAGE_SIZE;
    const pagina = rows.slice(0, PAGE_SIZE);

    const sessoes: SessionFeedItem[] = pagina
      .filter((r) => podeVerSessao({ autorId: String(r.user_id), isPublic: Boolean(r.is_public) }, user.id))
      .map((r) => ({
        id: String(r.id),
        spotName: String(r.spot_name),
        spotLocation: String(r.spot_location),
        createdAt: String(r.created_at),
        durationMinutes: Number(r.duration_minutes),
        discipline: r.discipline as SessionFeedItem['discipline'],
        boardModel: r.board_model ? String(r.board_model) : undefined,
        avgWindKnots: Number(r.avg_wind_knots),
        maxGustKnots: r.max_gust_knots !== null ? Number(r.max_gust_knots) : undefined,
        distanceKm: r.distance_km !== null ? Number(r.distance_km) : undefined,
        maxSpeedKnots: r.max_speed_knots !== null ? Number(r.max_speed_knots) : undefined,
        highestJumpM: r.highest_jump_m !== null ? Number(r.highest_jump_m) : undefined,
        trilhaReduzida: Array.isArray(r.trilha_reduzida) ? (r.trilha_reduzida as SessionFeedItem['trilhaReduzida']) : undefined,
        authorId: String(r.user_id),
        authorName: String(r.author_name),
        authorAvatarUrl: r.author_avatar_url ? String(r.author_avatar_url) : undefined,
        authorRiderId: String(r.author_rider_id),
        authorCountryFlag: String(r.author_country_flag),
        curtidas: Number(r.curtidas),
        euCurti: Boolean(r.eu_curti),
        comentarios: Number(r.comentarios),
      }));

    // Próximo cursor é o created_at do ÚLTIMO item desta página (não do
    // último buscado, que pode ter sido descartado no slice) — null quando
    // não sobrou próxima página, sinal para o cliente parar de pedir mais.
    const ultimo = pagina[pagina.length - 1];
    const proximoCursor = temProximaPagina && ultimo ? String(ultimo.created_at) : null;

    return { sessoes, proximoCursor };
  });
}
