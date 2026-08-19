import { sql } from '@/lib/db';
import { handle, readOptionalJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { str } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readOptionalJson(request);

    const endpoint = str(body, 'endpoint', { max: 2000 });
    const p256dh = str(body, 'p256dh', { max: 100 });
    const auth = str(body, 'auth', { max: 100 });
    const userAgent = request.headers.get('user-agent') || 'Unknown';

    await sql`
      INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent, last_used_at, failure_count)
      VALUES (${endpoint}, ${user.id}, ${p256dh}, ${auth}, ${userAgent}, NOW(), 0)
      ON CONFLICT (endpoint) DO UPDATE SET 
        user_id = ${user.id},
        p256dh = ${p256dh},
        auth = ${auth},
        user_agent = ${userAgent},
        last_used_at = NOW(),
        failure_count = 0
    `;

    return { ok: true };
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readOptionalJson(request);

    const endpoint = str(body, 'endpoint', { max: 2000 });

    await sql`
      DELETE FROM push_subscriptions 
      WHERE endpoint = ${endpoint} AND user_id = ${user.id}
    `;

    return { ok: true };
  });
}
