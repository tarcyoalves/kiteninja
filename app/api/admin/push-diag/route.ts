import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { diagnosticarPush } from '@/lib/push';

/**
 * "O push está de fato configurado em produção?"
 *
 * As duas falhas de push deste projeto foram silenciosas: a chave VAPID no
 * formato errado (o iOS recusava a inscrição sem erro visível — 9 usuários,
 * zero inscrições no banco) e o FCM sem credencial (`getFirebaseMessaging`
 * devolve `null` e o envio vira no-op). Nos dois casos a interface parecia
 * funcionar. Esta rota responde a pergunta com a verdade, em vez de exigir
 * uma nova rodada de adivinhação a cada suspeita.
 *
 * Só admin (`requireAdmin`), e não devolve NENHUM valor de segredo — apenas
 * se existe, se faz parse, e o `project_id`/`client_email` da service account,
 * que não são secretos e confirmam que a credencial é do projeto certo.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    await requireAdmin();

    const diag = await diagnosticarPush();

    // Contagem real de inscrições: configuração correta com banco vazio ainda
    // significa "ninguém recebe nada", que é o que de fato importa saber.
    const [web] = await sql`SELECT COUNT(*)::int AS n FROM push_subscriptions`;
    const [fcm] = await sql`
      SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'fcm_tokens'
    `;
    const tabelaFcmExiste = Number((fcm as Record<string, unknown>).n) > 0;
    const tokensFcm = tabelaFcmExiste
      ? Number(((await sql`SELECT COUNT(*)::int AS n FROM fcm_tokens`)[0] as Record<string, unknown>).n)
      : null;

    return {
      ...diag,
      inscricoes: {
        webPush: Number((web as Record<string, unknown>).n),
        fcmTokens: tokensFcm,
      },
    };
  });
}
