import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { ehUuid, buscarParticipacao, buscarStatusDownwind } from '@/lib/downwindDb';

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
      SELECT id, downwind_id, invitee_id, role, status, expires_at
      FROM downwind_user_invites
      WHERE id = ${id}
      LIMIT 1
    `;

    if (rows.length === 0) {
      throw new HttpError(404, 'Convite não encontrado.');
    }

    const invite = rows[0] as Record<string, unknown>;
    const inviteeId = invite.invitee_id ? String(invite.invitee_id) : null;
    const downwindId = String(invite.downwind_id);
    const papel = String(invite.role);
    const expiresAt = new Date(String(invite.expires_at));
    const statusAtual = String(invite.status);

    // Convites de link (invitee_id === null) devem ser aceitos exclusivamente via token
    if (!inviteeId) {
      throw new HttpError(400, 'Convites por link devem ser acessados através do link de convite.');
    }

    if (inviteeId !== user.id) {
      throw new HttpError(403, 'Este convite foi enviado para outro velejador.');
    }

    if (statusAtual !== 'pendente') {
      throw new HttpError(409, `Este convite já foi ${statusAtual}.`);
    }

    if (expiresAt.getTime() < Date.now()) {
      await sql`UPDATE downwind_user_invites SET status = 'expirado' WHERE id = ${id} AND status = 'pendente'`;
      throw new HttpError(410, 'Este convite expirou.');
    }

    const dwStatus = await buscarStatusDownwind(downwindId);
    if (dwStatus === null) throw new HttpError(404, 'Downwind não encontrado.');
    if (dwStatus === 'encerrado' || dwStatus === 'cancelado') {
      throw new HttpError(409, 'Este downwind já terminou.');
    }

    const jaParticipa = await buscarParticipacao(downwindId, user.id);
    if (jaParticipa && jaParticipa.estado !== 'desistiu' && jaParticipa.estado !== 'encerrado') {
      await sql`
        UPDATE downwind_user_invites
        SET status = 'aceito', responded_at = NOW()
        WHERE id = ${id} AND status = 'pendente'
      `;
      return { ok: true, downwindId, message: 'Você já participa deste downwind.' };
    }

    await sql`
      INSERT INTO downwind_participantes (
        downwind_id, user_id, papel, eh_organizador, estado
      )
      VALUES (
        ${downwindId}, ${user.id}, ${papel}, FALSE, 'confirmado'
      )
      ON CONFLICT (downwind_id, user_id) DO UPDATE SET
        papel = EXCLUDED.papel,
        estado = 'confirmado',
        apoio_user_id = NULL
    `;

    const updated = await sql`
      UPDATE downwind_user_invites
      SET status = 'aceito', responded_at = NOW()
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

    return { ok: true, downwindId };
  });
}