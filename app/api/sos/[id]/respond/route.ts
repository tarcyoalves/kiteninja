import { sql } from '@/lib/db';
import { handle, readOptionalJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { num, oneOf } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readOptionalJson(request);
    const { id } = await context.params;
    const sosId = id;

    const state = oneOf(body, 'state', ['a_caminho', 'no_local', 'nao_posso'] as const);
    const lat = num(body, 'lat', { optional: true });
    const lng = num(body, 'lng', { optional: true });

    await sql`
      INSERT INTO sos_responders (sos_id, user_id, state, lat, lng, responded_at)
      VALUES (${sosId}, ${user.id}, ${state}, ${lat ?? null}, ${lng ?? null}, NOW())
      ON CONFLICT (sos_id, user_id) DO UPDATE
        SET state = EXCLUDED.state,
            lat = EXCLUDED.lat,
            lng = EXCLUDED.lng,
            responded_at = NOW()
        WHERE sos_responders.user_id = ${user.id}
    `;

    if (state === 'a_caminho') {
      // Se for o primeiro socorrista a caminho, paramos a escalada
      await sql`
        UPDATE sos_alerts 
        SET status = 'em_atendimento' 
        WHERE id = ${sosId} AND status = 'ativo'
      `;
    }

    return { ok: true };
  });
}
