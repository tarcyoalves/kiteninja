import { sql } from '@/lib/db';
import { handle, readOptionalJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { str } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * Registra um token FCM para push nativo Android.
 *
 * O app nativo (Capacitor + @capacitor/push-notifications) obtém o token do
 * Firebase e o envia aqui. O backend guarda o token para poder enviar push via
 * FCM Admin SDK quando necessário.
 *
 * O mesmo usuário pode ter múltiplos dispositivos, cada um com seu token.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readOptionalJson(request);

    const token = str(body, 'token', { max: 500 });
    const deviceName = str(body, 'deviceName', { max: 100, optional: true });

    if (!token) {
      throw new Error('Token FCM é obrigatório.');
    }

    // UPSERT: se o mesmo token vier de novo (app reinstall ou refresh), atualiza
    // em vez de duplicar.
    await sql`
      INSERT INTO fcm_tokens (token, user_id, device_name, platform, last_used_at, failure_count)
      VALUES (${token}, ${user.id}, ${deviceName || null}, 'android', NOW(), 0)
      ON CONFLICT (token) DO UPDATE SET
        user_id = ${user.id},
        device_name = ${deviceName || null},
        last_used_at = NOW(),
        failure_count = 0
    `;

    return { ok: true };
  });
}

/**
 * Remove um token FCM (logout de push, app uninstall, etc).
 */
export async function DELETE(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readOptionalJson(request);

    const token = str(body, 'token', { max: 500 });

    await sql`
      DELETE FROM fcm_tokens
      WHERE token = ${token} AND user_id = ${user.id}
    `;

    return { ok: true };
  });
}
