import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { HttpError } from '@/lib/auth';
import { str } from '@/lib/validation';
import { instanteIso } from '@/lib/datas';

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    // O app é fechado por convite, e esta leitura era a única de conteúdo de
    // usuário sem sessão: qualquer um com o id de um post lia os comentários
    // (nome e foto de quem comentou). Achado na varredura de 12/11/2026.
    await requireUser();
    const { id } = await ctx.params;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new HttpError(400, 'Identificador de post inválido.');
    }

    // Check post exists
    const postExists = await sql`
      SELECT id FROM posts WHERE id = ${id} LIMIT 1
    `;
    if (postExists.length === 0) {
      throw new HttpError(404, 'Post não encontrado.');
    }

    const rows = await sql`
      SELECT
        pc.id,
        pc.user_id,
        pc.text,
        pc.created_at,
        u.name AS author_name,
        u.avatar_url AS author_avatar
      FROM post_comments pc
      JOIN users u ON u.id = pc.user_id
      WHERE pc.post_id = ${id}
      ORDER BY pc.created_at ASC
    `;

    const comments = rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        userName: String(r.author_name),
        userAvatar: r.author_avatar ? String(r.author_avatar) : undefined,
        text: String(r.text),
        time: instanteIso(r.created_at),
      };
    });

    return { comments };
  });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = await readJson(request);

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new HttpError(400, 'Identificador de post inválido.');
    }

    // Check post exists
    const postExists = await sql`
      SELECT id FROM posts WHERE id = ${id} LIMIT 1
    `;
    if (postExists.length === 0) {
      throw new HttpError(404, 'Post não encontrado.');
    }

    const text = str(body, 'text', { min: 1, max: 1000 });

    const inserted = await sql`
      INSERT INTO post_comments (post_id, user_id, text)
      VALUES (${id}, ${user.id}, ${text})
      RETURNING id
    `;

    return { id: String((inserted[0] as Record<string, unknown>).id) };
  });
}
