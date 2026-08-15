import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { HttpError } from '@/lib/auth';
import { num, str } from '@/lib/validation';

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);

    // Fetch posts with user info, like counts, comment counts, and whether the current user liked them
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
        timestamp: String(r.created_at),
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
    const photoUrl = str(body, 'photoUrl', { optional: true, max: 500 });
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
