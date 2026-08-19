import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { canResolveAlert } from '@/lib/authz';
import { HttpError } from '@/lib/auth';

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new HttpError(400, 'Identificador de alerta inválido.');
    }

    // Check if alert exists and get author
    const alertRow = await sql`
      SELECT id, user_id, status FROM safety_alerts
      WHERE id = ${id} LIMIT 1
    `;

    if (alertRow.length === 0) {
      throw new HttpError(404, 'Alerta não encontrado.');
    }

    const alert = alertRow[0] as Record<string, unknown>;
    const authorId = String(alert.user_id);
    const currentStatus = String(alert.status);

    // Moderador também resolve alerta de terceiro: quem decide isso é
    // canResolveAlert (autor, moderador ou admin). A checagem inline que
    // existia aqui esquecia o papel 'moderator' e devolvia 403 para ele,
    // contrariando o RBAC que lib/authz.test.ts já cobra.
    if (!canResolveAlert({ id: user.id, role: user.role }, authorId)) {
      throw new HttpError(403, 'Você não tem permissão para modificar este alerta.');
    }

    // Only allow transitioning from 'Ativo' to 'Resolvido'
    if (currentStatus !== 'Ativo') {
      throw new HttpError(400, 'Este alerta já foi resolvido.');
    }

    // CRITICAL: Filter by id and ensure only the right record is updated
    await sql`
      UPDATE safety_alerts
      SET status = 'Resolvido'
      WHERE id = ${id} AND status = 'Ativo'
    `;

    return { ok: true, status: 'Resolvido' };
  });
}
