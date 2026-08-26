import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { ehUuid } from '@/lib/downwindDb';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!ehUuid(id)) throw new HttpError(404, 'Convite não encontrado.');

    const rows = await sql`
      SELECT id, invitee_id, status
      FROM downwind_user_invites
      WHERE id = ${id}
      LIMIT 1
    `;

    if (rows.length === 0) {
      throw new HttpError(404, 'Convite não encontrado.');
    }

    const invite = rows[0] as Record<string, unknown>;
    const inviteeId = invite.invitee_id ? String(invite.invitee_id) : null;
    const statusAtual = String(invite.status);

    if (!inviteeId) {
      throw new HttpError(400, 'Convites por link não podem ser recusados por esta rota.');
    }

    if (inviteeId !== user.id) {
      throw new HttpError(403, 'Este convite foi enviado para outro velejador.');
    }

    if (statusAtual !== 'pendente') {
      throw new HttpError(409, `Este convite já foi ${statusAtual}.`);
    }

    const updated = await sql`
      UPDATE downwind_user_invites
      SET status = 'recusado', responded_at = NOW()
      WHERE id = ${id} AND status = 'pendente'
      RETURNING id
    `;

    if (updated.length === 0) {
      throw new HttpError(409, 'Este convite não está mais pendente.');
    }

    await sql`
      UPDATE notifications
      SET read_at = NOW()
      WHERE invite_id = ${id} AND recipient_id = ${user.id} AND read_at IS NULL
    `;

    return { ok: true };
  });
}