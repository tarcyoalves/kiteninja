import { sql } from '@/lib/db';
import { handle, readOptionalJson } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { oneOf, str } from '@/lib/validation';
import { canResolveSos } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readOptionalJson(request);
    const { id } = await context.params;
    const sosId = id;

    const status = oneOf(body, 'status', ['resolvido', 'cancelado', 'falso_alarme'] as const);
    const resolutionNote = str(body, 'resolutionNote', { optional: true, max: 1000 });

    const alerts = await sql`
      SELECT user_id FROM sos_alerts WHERE id = ${sosId}
    `;

    if (alerts.length === 0) {
      throw new HttpError(404, 'SOS não encontrado.');
    }

    const sosUserId = String((alerts[0] as Record<string, unknown>).user_id);

    if (!canResolveSos(user, sosUserId)) {
      throw new HttpError(403, 'Acesso negado para resolver este SOS.');
    }

    await sql`
      UPDATE sos_alerts
      SET status = ${status},
          resolved_at = NOW(),
          resolved_by = ${user.id},
          resolution_note = ${resolutionNote || null}
      WHERE id = ${sosId}
    `;

    await sql`
      INSERT INTO audit_logs (actor_id, action, target_type, target_id)
      VALUES (${user.id}, 'sos.resolved', 'sos_alert', ${sosId})
    `;

    return { ok: true };
  });
}
