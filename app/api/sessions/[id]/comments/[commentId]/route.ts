import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';
import { canDeleteComment } from '@/lib/authz';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Apaga um comentário: o próprio autor apaga o seu, moderador/admin apaga
 * de terceiro (`lib/authz.ts`, `canDeleteComment` — código morto até esta
 * fase, agora finalmente usado).
 *
 * Não chama `exigirSessaoVisivel`: apagar um comentário que você já tem
 * permissão de apagar não depende de poder VER a sessão de novo — mesmo
 * raciocínio do DELETE de session_likes/user_follows (apagar a própria
 * opinião nunca vaza mais do que já foi exposto).
 *
 * O filtro SQL é `id + session_id` (nunca `user_id`, de propósito): um
 * moderador precisa conseguir apagar o comentário de OUTRO velejador, então
 * quem decide "pode apagar" é `canDeleteComment` em código, não uma cláusula
 * de dono no WHERE — ver lib/authz.test.ts para a prova positiva (autor
 * apaga o próprio, moderador/admin apagam de terceiro, estranho sem
 * privilégio recebe 403).
 */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string; commentId: string }> }
) {
  return handle(async () => {
    const user = await requireUser();
    const { id, commentId } = await ctx.params;

    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de sessão inválido.');
    if (!UUID.test(commentId)) throw new HttpError(400, 'Identificador de comentário inválido.');

    const rows = await sql`
      SELECT user_id FROM session_comments WHERE id = ${commentId} AND session_id = ${id} LIMIT 1
    `;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, 'Comentário não encontrado.');

    if (!canDeleteComment(user, String(row.user_id))) {
      throw new HttpError(403, 'Sem permissão para apagar este comentário.');
    }

    await sql`DELETE FROM session_comments WHERE id = ${commentId} AND session_id = ${id} RETURNING id`;

    return { ok: true };
  });
}
