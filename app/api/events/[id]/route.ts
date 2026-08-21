import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { canModerate } from '@/lib/authz';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Apaga um evento. Pedido do dono (docs de sessão) — não existia nenhum jeito
 * de remover um evento criado por engano ou um teste que sobrou.
 *
 * Quem pode: moderação (`canModerate`) sempre. Quando o evento é um Downwind,
 * também o próprio organizador que o criou (`downwinds.criado_por`) — os
 * demais tipos de evento (`events.organizer` é texto livre, sem `user_id`
 * associado) não têm como provar autoria, então só moderação apaga esses.
 *
 * BLOQUEIO DE SEGURANÇA: nunca apaga um downwind `em_andamento` — isso
 * arrancaria o mapa ao vivo (e o próprio takeover, ver
 * context/DownwindContext.tsx) de baixo de gente possivelmente na água, sem
 * aviso e sem passar pelas regras de encerramento de lib/downwind.ts.
 * Encerrar ou cancelar a travessia primeiro é obrigatório.
 */
export async function DELETE(request: Request, ctx: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    const rows = await sql`
      SELECT
        e.id,
        d.id     AS downwind_id,
        d.status AS downwind_status,
        d.criado_por AS downwind_criado_por
      FROM events e
      LEFT JOIN downwinds d ON d.event_id = e.id
      WHERE e.id = ${id}
      LIMIT 1
    `;
    if (rows.length === 0) throw new HttpError(404, 'Evento não encontrado.');
    const r = rows[0] as Record<string, unknown>;

    const downwindId = r.downwind_id ? String(r.downwind_id) : null;
    const downwindStatus = r.downwind_status ? String(r.downwind_status) : null;
    const downwindCriadoPor = r.downwind_criado_por ? String(r.downwind_criado_por) : null;

    const souOrganizadorDoDownwind = downwindCriadoPor !== null && downwindCriadoPor === user.id;
    if (!canModerate(user.role) && !souOrganizadorDoDownwind) {
      throw new HttpError(403, 'Sem permissão para apagar este evento.');
    }

    if (downwindStatus === 'em_andamento') {
      throw new HttpError(
        409,
        'Este downwind está em andamento — encerre ou cancele a travessia antes de apagar o evento.'
      );
    }

    // Downwind primeiro: CASCADE em downwind_id já limpa participantes,
    // posições e convites (ver lib/schema.sql). O evento sai por último.
    if (downwindId) {
      await sql`DELETE FROM downwinds WHERE id = ${downwindId}`;
    }
    await sql`DELETE FROM events WHERE id = ${id}`;

    return { ok: true };
  });
}
