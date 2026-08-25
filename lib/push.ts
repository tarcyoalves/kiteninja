import 'server-only';

import webpush from 'web-push';
import { sql } from './db';

/**
 * Infraestrutura de Push - suporta Web Push (VAPID) e Nativo (FCM).
 *
 * O SOS é o único caso de uso real de notificação push no KiteNinja: é
 * literalmente vida ou morte. Por isso, falhar ao enviar um push NUNCA pode
 * impedir o SOS de ser gravado — todo disparo está em try/catch. Se o push
 * não chegar, o alerta in-app (polling) ainda funciona para quem estiver
 * com o app aberto.
 */

// --- Web Push (VAPID) ---
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:contato@kiteninja.app';

// Configura VAPID apenas se as chaves existirem (em dev local podem não estar setadas)
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// --- Push Nativo (FCM) ---
// firebase-admin 14.x só expõe a API modular (sem o namespace `admin.*` das
// versões antigas — `admin.apps`, `admin.credential.cert` e `admin.messaging()`
// não existem mais). Guarda a instância de Messaging já resolvida.
type FirebaseMessaging = import('firebase-admin/messaging').Messaging;
let firebaseMessaging: FirebaseMessaging | null = null;
let firebaseInitTried = false;

/**
 * Lazy-load do Firebase Admin SDK. Só inicializa se as credenciais existirem.
 *
 * Duas formas de fornecer a credencial, nesta ordem de prioridade:
 *   1. GOOGLE_APPLICATION_CREDENTIALS_JSON — conteúdo JSON completo da
 *      service account, injetado direto como variável de ambiente. É a forma
 *      recomendada em Vercel (sem sistema de arquivos persistente).
 *   2. GOOGLE_APPLICATION_CREDENTIALS — caminho para um arquivo JSON no disco.
 *      Útil em ambientes com filesystem persistente (ex: rodando localmente).
 *
 * Sem nenhuma das duas, FCM fica desabilitado e sendFcmToUser vira no-op.
 */
async function getFirebaseMessaging(): Promise<FirebaseMessaging | null> {
  if (firebaseMessaging) return firebaseMessaging;
  if (firebaseInitTried) return null; // já tentou e falhou/faltou credencial — não repete a cada chamada
  firebaseInitTried = true;

  const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!credJson && !credPath) {
    console.warn(
      '[push] Nenhuma credencial do Firebase Admin definida ' +
        '(GOOGLE_APPLICATION_CREDENTIALS_JSON ou GOOGLE_APPLICATION_CREDENTIALS); FCM desabilitado.'
    );
    return null;
  }

  try {
    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    const { getMessaging } = await import('firebase-admin/messaging');

    let app = getApps()[0];
    if (!app) {
      if (credJson) {
        // Variável de ambiente com o JSON inteiro da service account.
        const serviceAccount = JSON.parse(credJson);
        app = initializeApp({ credential: cert(serviceAccount) });
      } else {
        // Caminho de arquivo JSON no disco.
        const { default: serviceAccount } = await import(credPath as string, { with: { type: 'json' } });
        app = initializeApp({ credential: cert(serviceAccount) });
      }
    }

    firebaseMessaging = getMessaging(app);
    return firebaseMessaging;
  } catch (err) {
    console.error('[push] Falha ao inicializar Firebase Admin:', err);
    return null;
  }
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
 * Envia push via FCM (Firebase Cloud Messaging) para todos os dispositivos
 * registrados do usuário.
 *
 * Retorna quantos envios foram bem-sucedidos. Tokens inválidos (NotFound)
 * são removidos do banco.
 */
export async function sendFcmToUser(
  userId: string,
  payload: PushPayload
): Promise<number> {
  const messaging = await getFirebaseMessaging();
  if (!messaging) return 0;

  const tokens = await sql`
    SELECT id, token
    FROM fcm_tokens
    WHERE user_id = ${userId}
  `;

  if (tokens.length === 0) return 0;

  let enviados = 0;
  const tokenList = tokens.map(t => String((t as Record<string, unknown>).token));

  // FCM permite até 500 tokens por batch. Se exceder, chunk em grupos de 500.
  const CHUNK = 500;
  for (let i = 0; i < tokenList.length; i += CHUNK) {
    const chunk = tokenList.slice(i, i + CHUNK);

    const message: import('firebase-admin/messaging').MulticastMessage = {
      tokens: chunk,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      // `data` (não `webpush.fcmOptions.link`) é o que chega ao app Android:
      // fcmOptions.link só é honrado pelo Service Worker de Web Push. Sem
      // isto, o app nativo recebe o clique em pushNotificationActionPerformed
      // sem saber para onde navegar (ver lib/usePushNotifications.ts).
      data: {
        url: payload.url || '/',
        tag: payload.tag || 'kiteninja',
      },
      webpush: {
        notification: {
          tag: payload.tag || 'kiteninja',
          requireInteraction: payload.requireInteraction || false,
        },
        fcmOptions: {
          link: payload.url || '/',
        },
      },
      android: {
        // AndroidConfig.priority só aceita 'high' | 'normal' (não existe
        // 'default' na API do firebase-admin) — 'normal' é o equivalente.
        priority: payload.requireInteraction ? 'high' as const : 'normal' as const,
        notification: {
          tag: payload.tag || 'kiteninja',
          channelId: 'kiteninja_alerts',
        },
      },
    };

    try {
      const response = await messaging.sendEachForMulticast(message);

      // Processa resultados individuais para atualizar failure_count ou remover tokens mortos.
      const results = response.responses;
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const tokenId = String((tokens[i + j] as Record<string, unknown>).id);

        if (result.success) {
          // Atualiza last_used_at para saber quais tokens estão vivos.
          await sql`
            UPDATE fcm_tokens
            SET last_used_at = NOW(), failure_count = 0
            WHERE id = ${tokenId}
          `;
          enviados++;
        } else {
          const err = result.error;
          // NotFound = token expirou ou foi invalidado. Unregistered = app desinstalado.
          if (err?.code === 'messaging/not-found' || err?.code === 'messaging/registration-token-not-registered') {
            await sql`DELETE FROM fcm_tokens WHERE id = ${tokenId}`;
          } else {
            // Erro transitório: incrementa failure_count.
            await sql`
              UPDATE fcm_tokens
              SET failure_count = failure_count + 1
              WHERE id = ${tokenId}
            `;
          }
        }
      }
    } catch (err) {
      // Erro de batch inteiro (ex: credenciais inválidas). Não atualiza nada.
      console.error('[push] Erro ao enviar FCM batch:', err);
    }
  }

  return enviados;
}

/**
 * Envia push para TODAS as inscrições de um velejador (Web Push + FCM).
 *
 * Envia tanto via Web Push (VAPID) quanto via FCM (push nativo Android).
 * Os dois canais são independentes: se um falhar, o outro ainda pode chegar.
 *
 * Retorna quantos envios foram bem-sucedidos (soma de ambos os canais).
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<number> {
  // Executa Web Push e FCM em paralelo. Cada um é completamente independente
  // (se um falhar, o outro continua funcionando).
  const [webCount, fcmCount] = await Promise.all([
    sendWebPushToUser(userId, payload),
    sendFcmToUser(userId, payload),
  ]);

  return webCount + fcmCount;
}

/**
 * Envia push via Web Push (VAPID) para todas as inscrições de um velejador.
 *
 * Retorna quantos envios foram bem-sucedidos. Endpoints mortos (404/410) são
 * apagados do banco — o browser revogou a permissão ou o usuário desinstalou,
 * e o endpoint nunca volta a funcionar.
 */
async function sendWebPushToUser(
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
 * Retorna total de envios bem-sucedidos (soma de Web Push + FCM).
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
