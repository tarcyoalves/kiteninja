import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';
import { num, str } from '@/lib/validation';
import { instanteIso } from '@/lib/datas';
import { fotoAceitaNaEntrada } from '@/lib/fotosNoBlob';

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    // Entre 1 e 100: `?limit=-5` chegava ao banco como LIMIT negativo (erro 500).
    const limit = Math.min(Math.max(Math.trunc(Number(url.searchParams.get('limit'))) || 50, 1), 100);

    // Fetch posts with user info, like counts, comment counts, and whether the current user liked them
    //
    // PRIVACIDADE: o velejo público gera um relato automático (post com
    // session_id). Se a autora depois tornava o velejo privado, o relato —
    // com as anotações, o spot e o vento — continuava no feed de todo mundo.
    // O filtro olha a privacidade ATUAL do velejo; a autora segue vendo o seu.
    const rows = await sql`
      SELECT
        p.id,
        p.user_id,
        p.title,
        p.content,
        p.spot_name,
        p.spot_location,
        p.photo_url,
        p.wind_knots,
        p.wind_kite_used,
        p.wind_condition,
        p.tag,
        p.shares,
        p.created_at,
        u.name AS author_name,
        u.avatar_url AS author_avatar,
        u.rider_id AS author_rider_id,
        u.country_flag AS author_country_flag,
        (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) AS likes_count,
        CASE WHEN EXISTS (
          SELECT 1 FROM post_likes pl
          WHERE pl.post_id = p.id AND pl.user_id = ${user.id}
        ) THEN true ELSE false END AS is_liked,
        (
          SELECT COALESCE(json_agg(json_build_object(
            'id', pc.id,
            'userName', cu.name,
            'userAvatar', cu.avatar_url,
            'text', pc.text,
            'time', pc.created_at
          ) ORDER BY pc.created_at ASC), '[]'::json)
          FROM post_comments pc
          JOIN users cu ON cu.id = pc.user_id
          WHERE pc.post_id = p.id
        ) AS comments
      FROM posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN sessions_log s ON s.id = p.session_id
      WHERE p.session_id IS NULL OR s.is_public = TRUE OR p.user_id = ${user.id}
      ORDER BY p.created_at DESC
      LIMIT ${limit}
    `;

    const posts = rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        authorName: String(r.author_name),
        authorAvatar: r.author_avatar ? String(r.author_avatar) : undefined,
        authorRiderId: String(r.author_rider_id),
        authorCountryFlag: String(r.author_country_flag),
        title: String(r.title),
        content: String(r.content),
        spotName: r.spot_name ? String(r.spot_name) : undefined,
        spotLocation: r.spot_location ? String(r.spot_location) : undefined,
        // ISO, não String(Date): o driver devolve Date e o toString dele aparecia
        // na tela em inglês, com fuso por extenso. Ver lib/datas.ts.
        timestamp: instanteIso(r.created_at),
        photoUrl: r.photo_url ? String(r.photo_url) : undefined,
        windReport: r.wind_knots !== null ? {
          knots: Number(r.wind_knots),
          kiteUsed: r.wind_kite_used ? String(r.wind_kite_used) : undefined,
          condition: r.wind_condition ? String(r.wind_condition) : undefined,
        } : undefined,
        likes: Number(r.likes_count),
        isLiked: Boolean(r.is_liked),
        comments: (r.comments as Array<Record<string, unknown>>).map((c) => ({
          id: String(c.id),
          userName: String(c.userName),
          userAvatar: c.userAvatar ? String(c.userAvatar) : undefined,
          text: String(c.text),
          time: String(c.time),
        })),
        shares: Number(r.shares),
        tag: r.tag ? String(r.tag) : undefined,
      };
    });

    return { posts };
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson(request);

    const title = str(body, 'title', { max: 200 });
    const content = str(body, 'content', { max: 5000 });
    const spotName = str(body, 'spotName', { optional: true, max: 200 });
    const spotLocation = str(body, 'spotLocation', { optional: true, max: 200 });
    const photoUrl = str(body, 'photoUrl', { optional: true, max: 1_500_000 });
    /*
     * Foto do relato: URL do Vercel Blob (caminho novo, ver lib/fotosNoBlob.ts)
     * ou data:image/ (aba/cliente antigo — aceito por compatibilidade, pode ser
     * fechado depois). Antes disto QUALQUER texto virava `photo_url`, inclusive
     * `javascript:` e URL de rastreador, que o feed de todo mundo carregaria.
     */
    if (photoUrl && !fotoAceitaNaEntrada(photoUrl, 1_500_000)) {
      throw new HttpError(400, 'Formato de imagem não suportado. Envie JPG, PNG ou WEBP.');
    }
    const windKnots = num(body, 'windKnots', { optional: true, min: 0, max: 80 });
    const windKiteUsed = str(body, 'windKiteUsed', { optional: true, max: 100 });
    const windCondition = str(body, 'windCondition', { optional: true, max: 100 });
    const tag = str(body, 'tag', { optional: true, max: 50 });

    const inserted = await sql`
      INSERT INTO posts (
        user_id, title, content, spot_name, spot_location, photo_url,
        wind_knots, wind_kite_used, wind_condition, tag
      )
      VALUES (
        ${user.id}, ${title}, ${content}, ${spotName || null}, ${spotLocation || null},
        ${photoUrl || null}, ${windKnots || null}, ${windKiteUsed || null},
        ${windCondition || null}, ${tag || null}
      )
      RETURNING id
    `;

    return { id: String((inserted[0] as Record<string, unknown>).id) };
  });
}
