import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { HttpError, requireAdmin } from '@/lib/auth';

/** Revoga um convite ainda não usado. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await ctx.params;

    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new HttpError(400, 'Identificador inválido.');
    }

    const rows = await sql`
      UPDATE invites SET revoked_at = NOW()
      WHERE id = ${id} AND used_at IS NULL AND revoked_at IS NULL
      RETURNING id
    `;

    if (rows.length === 0) {
      throw new HttpError(404, 'Convite não encontrado, já usado ou já revogado.');
    }
    return { ok: true };
  });
}
