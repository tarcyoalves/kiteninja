import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';
import { canDeletePost } from '@/lib/authz';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Apaga um post do feed: o próprio autor apaga o seu, moderador/admin apaga
 * de terceiro (`lib/authz.ts`, `canDeletePost`).
 *
 * `canDeletePost` existia desde o início do RBAC mas nunca teve chamador —
 * era código morto, e na prática NÃO HAVIA como apagar um post: nem o autor
 * de um relato publicado por engano, nem a moderação diante de conteúdo
 * abusivo. O helper e o teste davam a impressão de que a regra existia.
 *
 * O filtro SQL é só `id` (nunca `user_id`, de propósito): moderação precisa
 * apagar post de OUTRO velejador, então quem decide é `canDeletePost` em
 * código, não uma cláusula de dono no WHERE — mesmo desenho de
 * app/api/sessions/[id]/comments/[commentId]/route.ts, e a razão está
 * registrada em lib/authz.test.ts (MUTACOES_JUSTIFICADAS).
 *
 * `post_likes` e `post_comments` somem junto por ON DELETE CASCADE
 * (lib/schema.sql) — não é preciso apagá-los aqui.
 */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de post inválido.');

    const rows = await sql`SELECT user_id FROM posts WHERE id = ${id} LIMIT 1`;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, 'Post não encontrado.');

    if (!canDeletePost(user, String(row.user_id))) {
      throw new HttpError(403, 'Sem permissão para apagar este post.');
    }

    await sql`DELETE FROM posts WHERE id = ${id} RETURNING id`;

    return { ok: true };
  });
}
