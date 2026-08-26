import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import type { AppNotification } from '@/types';

/** Central de notificações mostra as últimas 50 — mais que suficiente para o
 * uso normal, e mantém a consulta rápida sem paginação nesta primeira versão. */
const LIMITE_NOTIFICACOES = 50;

/** Corta o texto do comentário/resposta citado na notificação — o resumo
 * cabe numa linha da lista; o comentário inteiro só existe no detalhe da
 * sessão, que é para onde o toque leva. */
const MAX_PREVIEW_TEXTO = 140;

interface NotificacaoRow {
  id: unknown;
  type: unknown;
  actor_id: unknown;
  session_id: unknown;
  comment_id: unknown;
  read_at: unknown;
  created_at: unknown;
  actor_name: unknown;
  actor_avatar_url: unknown;
  spot_name: unknown;
  comment_text: unknown;
}

/**
 * Lista as notificações do velejador logado (nunca de outro — `recipient_id
 * = user.id` sempre, jamais um `userId` vindo do cliente) e a contagem de
 * não lidas separada: uma query própria, rápida, em vez de derivar do array
 * de 50, para não subcontar quando houver mais não lidas acumuladas do que
 * o LIMITE_NOTIFICACOES cobre.
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();

    const [rows, naoLidasRows] = await Promise.all([
      sql`
        SELECT n.id, n.type, n.actor_id, n.session_id, n.comment_id, n.downwind_id, n.invite_id, n.read_at, n.created_at,
               u.name AS actor_name, u.avatar_url AS actor_avatar_url,
               s.spot_name, c.text AS comment_text, d.nome AS downwind_nome
        FROM notifications n
        JOIN users u ON u.id = n.actor_id
        LEFT JOIN sessions_log s ON s.id = n.session_id
        LEFT JOIN session_comments c ON c.id = n.comment_id
        LEFT JOIN downwinds d ON d.id = n.downwind_id
        WHERE n.recipient_id = ${user.id}
        ORDER BY n.created_at DESC
        LIMIT ${LIMITE_NOTIFICACOES}
      `,
      sql`
        SELECT COUNT(*)::int AS cnt FROM notifications
        WHERE recipient_id = ${user.id} AND read_at IS NULL
      `,
    ]);

    const notificacoes: AppNotification[] = (rows as (NotificacaoRow & { downwind_id?: unknown; invite_id?: unknown; downwind_nome?: unknown })[]).map((r) => ({
      id: String(r.id),
      type: r.type as AppNotification['type'],
      actorId: String(r.actor_id),
      actorName: String(r.actor_name),
      actorAvatarUrl: r.actor_avatar_url ? String(r.actor_avatar_url) : undefined,
      sessionId: r.session_id ? String(r.session_id) : undefined,
      spotName: r.spot_name ? String(r.spot_name) : undefined,
      commentId: r.comment_id ? String(r.comment_id) : undefined,
      commentText: r.comment_text ? String(r.comment_text).slice(0, MAX_PREVIEW_TEXTO) : undefined,
      downwindId: r.downwind_id ? String(r.downwind_id) : undefined,
      inviteId: r.invite_id ? String(r.invite_id) : undefined,
      downwindNome: r.downwind_nome ? String(r.downwind_nome) : undefined,
      readAt: r.read_at ? String(r.read_at) : null,
      createdAt: String(r.created_at),
    }));

    const naoLidas = Number((naoLidasRows[0] as Record<string, unknown>).cnt);

    return { notificacoes, naoLidas };
  });
}

/**
 * Marca todas as notificações do usuário logado como lidas — "abrir a
 * central já é ter visto", mesmo espírito de `clearUnreadChat` ao entrar na
 * aba chat. Filtra por `recipient_id = user.id`: só a própria conta, nunca a
 * de outro velejador. O auditor de `lib/authz.test.ts` (MUTACOES_JUSTIFICADAS)
 * ainda exige uma entrada aqui, com prova positiva do WHERE abaixo — mesmo
 * caso de auth/change-password/route.ts, cuja troca de senha também filtra
 * por dono mas não usa literalmente a coluna chamada `user_id`.
 */
export async function POST() {
  return handle(async () => {
    const user = await requireUser();

    await sql`
      UPDATE notifications SET read_at = NOW()
      WHERE recipient_id = ${user.id} AND read_at IS NULL
    `;

    return { ok: true };
  });
}
