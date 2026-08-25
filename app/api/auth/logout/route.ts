import { handle, readOptionalJson } from '@/lib/api';
import { destroySession, getSessionUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { str } from '@/lib/validation';

export async function POST(request: Request) {
  return handle(async () => {
    const body = await readOptionalJson(request);
    const fcmToken = str(body, 'fcmToken', { max: 500, optional: true });

    // Remove somente o aparelho que está saindo. A consulta acontece antes de
    // destroySession(), enquanto ainda conseguimos provar a conta pelo cookie.
    // Logout continua público/idempotente: sessão ausente simplesmente pula.
    if (fcmToken) {
      const user = await getSessionUser();
      if (user) {
        await sql`
          DELETE FROM fcm_tokens
          WHERE token = ${fcmToken} AND user_id = ${user.id}
        `;
      }
    }

    await destroySession();
    return { ok: true };
  });
}
