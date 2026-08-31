import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';
import { canDeleteComment } from '@/lib/authz';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Apaga um comentário de post: o próprio autor apaga o seu, moderador/admin
 * apaga de terceiro (`lib/authz.ts`, `canDeleteComment`).
 *
 * Gêmea de app/api/sessions/[id]/comments/[commentId]/route.ts — mesma
 * regra, outra tabela (`post_comments` em vez de `session_comments`). O feed
 * tinha comentários desde sempre e nenhuma forma de remover um, nem pelo
 * autor nem pela moderação.
 *
 * O filtro é `id + post_id` (nunca `user_id`): moderação apaga comentário de
 * terceiro, então quem autoriza é `canDeleteComment` em código, não uma
 * cláusula de dono no WHERE.
 */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string; commentId: string }> }
) {
  return handle(async () => {
    const user = await requireUser();
    const { id, commentId } = await ctx.params;

    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de post inválido.');
    if (!UUID.test(commentId)) throw new HttpError(400, 'Identificador de comentário inválido.');

    const rows = await sql`
      SELECT user_id FROM post_comments WHERE id = ${commentId} AND post_id = ${id} LIMIT 1
    `;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, 'Comentário não encontrado.');

    if (!canDeleteComment(user, String(row.user_id))) {
      throw new HttpError(403, 'Sem permissão para apagar este comentário.');
    }

    await sql`DELETE FROM post_comments WHERE id = ${commentId} AND post_id = ${id} RETURNING id`;

    return { ok: true };
  });
}
