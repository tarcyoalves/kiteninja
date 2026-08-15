import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Alterna a curtida do usuário no post.
 *
 * A tabela post_likes tem chave primária composta (post_id, user_id) e nenhuma
 * coluna `id` — a existência da linha é o próprio estado da curtida.
 *
 * O toggle é resolvido pelo banco: tentamos remover e, se nada foi removido,
 * inserimos. Assim dois toques rápidos não criam curtida duplicada nem contagem
 * negativa; o pior caso é o segundo toque desfazer o primeiro, que é justamente
 * o comportamento esperado de um toggle.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de post inválido.');

    const post = await sql`SELECT id FROM posts WHERE id = ${id} LIMIT 1`;
    if (post.length === 0) throw new HttpError(404, 'Post não encontrado.');

    const removed = await sql`
      DELETE FROM post_likes
      WHERE post_id = ${id} AND user_id = ${user.id}
      RETURNING post_id
    `;

    let isLiked: boolean;

    if (removed.length > 0) {
      isLiked = false;
    } else {
      // ON CONFLICT cobre o caso de outra requisição ter inserido no mesmo
      // instante: com ou sem linha retornada, o estado final é "curtido".
      await sql`
        INSERT INTO post_likes (post_id, user_id)
        VALUES (${id}, ${user.id})
        ON CONFLICT (post_id, user_id) DO NOTHING
      `;
      isLiked = true;
    }

    const countRows = await sql`
      SELECT COUNT(*)::int AS cnt FROM post_likes WHERE post_id = ${id}
    `;

    return {
      isLiked,
      count: Number((countRows[0] as Record<string, unknown>).cnt),
    };
  });
}
