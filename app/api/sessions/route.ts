import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { bool, isIsoDate, isTime24, num, oneOf, str } from '@/lib/validation';
import { normalizarFotos } from '@/lib/fotosDoVelejo';
import { validarTrilhaReduzida } from '@/lib/trilhaSessao';
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
        s.trilha_reduzida,
        s.lat_inicial,
        s.lng_inicial,
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
          maxGustKnots: r.max_gust_knots !== null ? Number(r.max_gust_knots) : undefined,
          windDirection: r.wind_direction ? String(r.wind_direction) : undefined,
          tideCondition: r.tide_condition ? String(r.tide_condition) : undefined,
          waterCondition: r.water_condition ? String(r.water_condition) : undefined,
          rating: Number(r.rating),
          distanceKm: r.distance_km !== null ? Number(r.distance_km) : undefined,
          maxSpeedKnots: r.max_speed_knots !== null ? Number(r.max_speed_knots) : undefined,
          highestJumpM: r.highest_jump_m !== null ? Number(r.highest_jump_m) : undefined,
          notes: r.notes ? String(r.notes) : undefined,
          photoUrl: r.photo_url ? String(r.photo_url) : undefined,
          isPublic: Boolean(r.is_public),
          likesCount: Number(r.likes_count ?? 0),
          commentsCount: Number(r.comments_count ?? 0),
          createdAt: String(r.created_at),
          // JSONB já chega desserializado (array) do driver — Array.isArray
          // é só a guarda contra um valor NULL da coluna virar `null` solto
          // em vez de "campo ausente" no JSON de resposta. lat_inicial/
          // lng_inicial não são devolvidos aqui: existem para a Fase 3 (feed)
          // enquadrar o mapa sem ler o JSONB inteiro, e essa rota ainda não
          // tem consumidor para eles.
          trilhaReduzida: Array.isArray(r.trilha_reduzida) ? r.trilha_reduzida : undefined,
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
    const startTime = str(body, 'startTime', { max: 8 });
    // Valide antes da query: texto de calendário local (`23/08/2026`) numa
    // coluna DATE depende do DateStyle do Postgres e virava erro interno 500.
    // O contrato é o mesmo dos inputs HTML date/time e não varia por locale.
    if (!isIsoDate(date)) {
      throw new HttpError(400, 'Data inválida. Use o formato AAAA-MM-DD.');
    }
    if (!isTime24(startTime)) {
      throw new HttpError(400, 'Hora inicial inválida. Use o formato HH:MM.');
    }
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
    /*
     * FOTOS. `fotoUrls` é o caminho novo: o cliente sobe cada imagem direto
     * para o Vercel Blob (POST /api/sessions/fotos emite o token) e manda só
     * as URLs, na ordem que montou na tela.
     *
     * `photoUrl` continua aceito para não quebrar um app que ainda não
     * atualizou — o Android é uma casca que carrega a web, mas uma aba aberta
     * há dias tem o bundle antigo em memória. Quando vem, entra como a
     * primeira foto.
     *
     * O teto de 1,5 MB só existe por causa desse caminho legado (data URL). As
     * URLs do Blob têm algumas dezenas de caracteres.
     */
    const photoUrl = str(body, 'photoUrl', { optional: true, max: 1_500_000 });
    const fotos = normalizarFotos(
      Array.isArray((body as Record<string, unknown>)?.fotoUrls)
        ? (body as Record<string, unknown>).fotoUrls
        : photoUrl
          ? [photoUrl]
          : []
    );
    const isPublic = bool(body, 'isPublic', true);

    // Trilha é dado medido pelo GPS, não digitado — nunca confiamos na forma
    // que o cliente mandou (ver comentário de validarTrilhaReduzida). Forma
    // inválida vira `null`: perder a linha no mapa é aceitável, derrubar a
    // requisição inteira e perder o registro do velejo não.
    const trilhaReduzida = validarTrilhaReduzida(
      (body as Record<string, unknown>)?.trilhaReduzida
    );
    // lat/lng do primeiro ponto da trilha JÁ REDUZIDA (não da bruta): é o que
    // vai ser desenhado, então é o enquadramento coerente com o que o feed
    // vai mostrar. `null` quando não há trilha válida — sem ponto, sem como
    // enquadrar nada.
    const latInicial = trilhaReduzida ? trilhaReduzida[0][0] : null;
    const lngInicial = trilhaReduzida ? trilhaReduzida[0][1] : null;

    // Sessão e post automático precisam nascer na MESMA instrução SQL. Antes,
    // a sessão era gravada primeiro e o post numa segunda query: se a segunda
    // falhasse, a API devolvia erro embora o Ride já existisse; tentar novamente
    // duplicava a sessão no Logbook.
    const title = `Velejo no spot ${spotName}`;
    const content = notes
      ? notes
      : `Sessão concluída em ${spotLocation}! ${durationMinutes} minutos de velejo com pipa ${kiteSizeM2}m² e vento de ${avgWindKnots} nós.`;

    const inserted = await sql`
      WITH nova_sessao AS (
        INSERT INTO sessions_log (
          user_id, spot_id, spot_name, spot_location, date, start_time,
          duration_minutes, discipline, kite_size_m2, board_model,
          avg_wind_knots, max_gust_knots, wind_direction, tide_condition,
          water_condition, rating, distance_km, max_speed_knots, highest_jump_m,
          notes, photo_url, is_public, trilha_reduzida, lat_inicial, lng_inicial
        ) VALUES (
          ${user.id}, ${spotId || null}, ${spotName}, ${spotLocation}, ${date}, ${startTime},
          ${durationMinutes}, ${discipline}, ${kiteSizeM2}, ${boardModel || null},
          ${avgWindKnots}, ${maxGustKnots}, ${windDirection || null}, ${tideCondition || null},
          ${waterCondition || null}, ${rating}, ${distanceKm}, ${maxSpeedKnots},
          ${highestJumpM}, ${notes || null}, ${photoUrl || null}, ${isPublic},
          ${trilhaReduzida ? JSON.stringify(trilhaReduzida) : null}::jsonb, ${latInicial}, ${lngInicial}
        )
        RETURNING *
      ), post_automatico AS (
        INSERT INTO posts (user_id, session_id, title, content, spot_name, spot_location)
        SELECT ${user.id}, ns.id, ${title}, ${content}, ${spotName}, ${spotLocation}
        FROM nova_sessao ns
        WHERE ${isPublic} = TRUE
        RETURNING id
      )
      SELECT ns.*
      FROM nova_sessao ns
      LEFT JOIN post_automatico pa ON TRUE
    `;

    const sessionRow = inserted[0] as Record<string, unknown>;
    const sessionId = String(sessionRow.id);

    /*
     * As fotos entram DEPOIS, e a falha aqui não derruba a resposta.
     *
     * A sessão é o dado que importa: distância, trilha, vento. Uma foto que
     * não gravou é uma pena; um velejo que sumiu porque a foto falhou é o
     * defeito recorrente desta base — medir certo e perder na hora de salvar.
     *
     * `ordem` vem do índice na lista, que é a ordem que o velejador montou;
     * ver lib/fotosDoVelejo.ts sobre por que não é a ordem de chegada.
     */
    if (fotos.length > 0) {
      try {
        for (let i = 0; i < fotos.length; i++) {
          await sql`
            INSERT INTO session_photos (session_id, url, ordem)
            VALUES (${sessionId}, ${fotos[i]}, ${i})
            ON CONFLICT (session_id, ordem) DO NOTHING
          `;
        }
      } catch {
        // Silencioso de propósito — ver o comentário acima.
      }
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
      photoUrl: fotos[0] ?? undefined,
      fotoUrls: fotos,
      isPublic,
      createdAt: new Date().toISOString(),
      trilhaReduzida: trilhaReduzida ?? undefined,
    };
  });
}
