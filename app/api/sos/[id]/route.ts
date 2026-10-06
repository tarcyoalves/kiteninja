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

    /*
     * SÓ ENCERRA O QUE AINDA ESTÁ ABERTO.
     *
     * O UPDATE era `WHERE id`: um SOS já 'resolvido' por um moderador, tocado
     * depois pelo autor como "falso alarme", trocava de status e tinha
     * `resolved_by` sobrescrito — o registro de quem de fato encerrou o
     * socorro se perdia. Medido em lib/sosFluxo.test.ts (06/10/2026, T13).
     *
     * Já encerrado responde 200 sem mudar nada, e não 409, de propósito:
     * `cancelMySos` (KiteDataContext) só limpa o painel de SOS da tela quando
     * o pedido dá certo. Com 409, quem tocasse "cancelar" num SOS que outra
     * pessoa acabou de encerrar ficaria com o painel preso até o próximo
     * polling. Para o autor, o resultado é o mesmo: o SOS está encerrado.
     */
    const encerrado = await sql`
      UPDATE sos_alerts
      SET status = ${status},
          resolved_at = NOW(),
          resolved_by = ${user.id},
          resolution_note = ${resolutionNote || null}
      WHERE id = ${sosId}
        AND status IN ('ativo', 'em_atendimento')
      RETURNING id
    `;
    if (encerrado.length === 0) {
      return { ok: true, jaEncerrado: true };
    }

    await sql`
      INSERT INTO audit_logs (actor_id, action, target_type, target_id)
      VALUES (${user.id}, 'sos.resolved', 'sos_alert', ${sosId})
    `;

    return { ok: true };
  });
}
