import { sql } from './db';

export type TipoNotificacao =
  | 'curtida_sessao'
  | 'comentario_sessao'
  | 'resposta_comentario'
  | 'novo_seguidor';

interface CriarNotificacaoParams {
  recipientId: string;
  actorId: string;
  type: TipoNotificacao;
  sessionId?: string;
  commentId?: string;
}

/**
 * Cria uma notificação da central in-app (Fase 6 do plano de rede social,
 * SEM push de propósito) — nunca cria se `recipientId === actorId` (curtir/
 * comentar/responder na própria sessão, ou o caso impossível de seguir a si
 * mesmo): o CHECK do banco (`lib/schema.sql`, `notifications`) é a SEGUNDA
 * camada, esta função é a primeira. Todo INSERT em `notifications` passa por
 * aqui — nunca direto nas rotas — porque é o único lugar que garante isso.
 */
export async function criarNotificacao({
  recipientId,
  actorId,
  type,
  sessionId,
  commentId,
}: CriarNotificacaoParams): Promise<void> {
  if (recipientId === actorId) return;
  await sql`
    INSERT INTO notifications (recipient_id, actor_id, type, session_id, comment_id)
    VALUES (${recipientId}, ${actorId}, ${type}, ${sessionId ?? null}, ${commentId ?? null})
  `;
}
