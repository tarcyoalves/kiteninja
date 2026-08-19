import 'server-only';

import webpush from 'web-push';
import { sql } from './db';

/**
 * Infraestrutura de Web Push (VAPID).
 *
 * O SOS é o único caso de uso real de notificação push no KiteNinja: é
 * literalmente vida ou morte. Por isso, falhar ao enviar um push NUNCA pode
 * impedir o SOS de ser gravado — todo disparo está em try/catch. Se o push
 * não chegar, o alerta in-app (polling) ainda funciona para quem estiver
 * com o app aberto.
 */

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:contato@kiteninja.app';

// Configura VAPID apenas se as chaves existirem (em dev local podem não estar setadas)
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

export interface PushPayload {
  title: string;
  body: string;
  /** Tag evita agrupar SOS com notificações de vento. */
  tag?: string;
  /** URL para abrir ao clicar na notificação. */
  url?: string;
  /** SOS usa requireInteraction: true para não desaparecer. */
  requireInteraction?: boolean;
}

/**
 * Envia push para TODAS as inscrições de um velejador.
 *
 * Retorna quantos envios foram bem-sucedidos. Endpoints mortos (404/410) são
 * apagados do banco — o browser revogou a permissão ou o usuário desinstalou,
 * e o endpoint nunca volta a funcionar.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<number> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return 0;

  const subs = await sql`
    SELECT id, endpoint, p256dh, auth
    FROM push_subscriptions
    WHERE user_id = ${userId}
  `;

  let enviados = 0;

  for (const row of subs) {
    const sub = row as Record<string, unknown>;
    const pushSub: webpush.PushSubscription = {
      endpoint: String(sub.endpoint),
      keys: {
        p256dh: String(sub.p256dh),
        auth: String(sub.auth),
      },
    };

    try {
      await webpush.sendNotification(
        pushSub,
        JSON.stringify(payload),
        { TTL: 300 } // 5 min — SOS é urgente, não vale se chegar 1h depois
      );

      // Atualiza last_used_at para saber quais inscrições estão vivas
      await sql`
        UPDATE push_subscriptions
        SET last_used_at = NOW(), failure_count = 0
        WHERE id = ${String(sub.id)}
      `;

      enviados++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;

      if (status === 404 || status === 410) {
        // Endpoint morto: browser revogou permissão ou desinstalou o app.
        // Manter tentando é desperdício e pode atrasar pushes legítimos.
        await sql`
          DELETE FROM push_subscriptions WHERE id = ${String(sub.id)}
        `;
      } else {
        // Erro transitório (rede, throttle): incrementa contador.
        // Após muitas falhas, o admin pode limpar endpoints problemáticos.
        await sql`
          UPDATE push_subscriptions
          SET failure_count = failure_count + 1
          WHERE id = ${String(sub.id)}
        `;
      }
    }
  }

  return enviados;
}

/**
 * Envia push para múltiplos velejadores em batch.
 *
 * Envolve cada envio individual em try/catch para que a falha de um
 * dispositivo de um velejador não impeça os demais de receber o alerta.
 * Retorna total de envios bem-sucedidos.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload
): Promise<number> {
  let total = 0;

  for (const userId of userIds) {
    try {
      total += await sendPushToUser(userId, payload);
    } catch {
      // Ignora silenciosamente: push falhando nunca pode derrubar o SOS.
      // O alerta in-app (polling) é o fallback que funciona sem push.
    }
  }

  return total;
}
