import { sql } from './db';
import { sendPushToUsers } from './push';
import {
  MAX_DESTINATARIOS,
  montarAvisoInicio,
  podeAvisarDeNovo,
  type TipoInicio,
} from './avisoVelejo';

export type TipoNotificacao =
  | 'curtida_sessao'
  | 'comentario_sessao'
  | 'resposta_comentario'
  | 'novo_seguidor'
  | TipoInicio;

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

/**
 * Avisa quem segue o velejador de que ele acabou de entrar na água.
 *
 * DESENHO: uma query só faz a seleção E o INSERT. Os destinatários nunca
 * passam pelo JavaScript como lista de parâmetros — nada de montar array e
 * confiar na serialização do driver (a lição de `sql`DEFAULT``, ver
 * docs/INVESTIGACAO-RASTREIO-BACKGROUND.md). O `RETURNING` devolve exatamente
 * quem recebeu, e é essa lista que vai para o push.
 *
 * Três filtros, cada um por um motivo diferente:
 * - `u.is_active` — conta suspensa não recebe push.
 * - `u.notificar_amigo_velejando` — a preferência do DESTINATÁRIO, não a de
 *   quem entrou na água. Quem decide se quer ser avisado é quem é avisado.
 * - `follower_id <> actorId` — defesa em profundidade. O próprio
 *   `user_follows` tem CHECK que recusa auto-seguir (confirmado em
 *   scripts/verify-sql.ts), então esta linha não consegue existir hoje. Fica
 *   porque o custo é zero e a consequência de faltar seria desproporcional:
 *   uma única linha assim violaria o CHECK de `notifications` e derrubaria o
 *   INSERT INTEIRO, levando junto todos os avisos legítimos do mesmo lote.
 *
 * NUNCA lança: quem chamou está no meio de "iniciar velejo/downwind", e uma
 * falha de aviso não pode impedir alguém de entrar na água.
 */
export async function avisarSeguidoresDeInicio({
  actorId,
  tipo,
  spotNome,
}: {
  actorId: string;
  tipo: TipoInicio;
  spotNome?: string | null;
}): Promise<{ avisados: number; motivo?: 'repetido' | 'sem_seguidores' | 'erro' }> {
  try {
    // Anti-repetição por (ator, tipo): ver JANELA_ANTI_REPETICAO_MS.
    const ultimo = await sql`
      SELECT created_at
      FROM notifications
      WHERE actor_id = ${actorId} AND type = ${tipo}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const ultimoEm = ultimo.length
      ? new Date(String((ultimo[0] as Record<string, unknown>).created_at))
      : null;
    if (!podeAvisarDeNovo(ultimoEm)) return { avisados: 0, motivo: 'repetido' };

    const inseridos = await sql`
      INSERT INTO notifications (recipient_id, actor_id, type)
      SELECT f.follower_id, ${actorId}, ${tipo}
      FROM user_follows f
      JOIN users u ON u.id = f.follower_id
      WHERE f.following_id = ${actorId}
        AND u.is_active = TRUE
        AND u.notificar_amigo_velejando = TRUE
        AND f.follower_id <> ${actorId}
      LIMIT ${MAX_DESTINATARIOS}
      RETURNING recipient_id
    `;
    if (inseridos.length === 0) return { avisados: 0, motivo: 'sem_seguidores' };

    const destinatarios = inseridos.map((r) =>
      String((r as Record<string, unknown>).recipient_id)
    );

    const nome = await nomeDoUsuario(actorId);
    const texto = montarAvisoInicio(nome, tipo, spotNome);

    // Fire-and-forget: o push é lento (um envio por destinatário) e quem
    // chamou está tocando "Iniciar" para ir para a água. A notificação
    // in-app já está gravada — o push é o extra, não o contrato.
    void sendPushToUsers(destinatarios, {
      title: texto.title,
      body: texto.body,
      tag: `inicio:${actorId}:${tipo}`,
      url: '/',
    }).catch(() => {
      // sendPushToUsers já engole erro por destinatário; este catch cobre
      // só uma falha antes do laço começar.
    });

    return { avisados: destinatarios.length };
  } catch (err) {
    console.error('[notificacoes] falha ao avisar seguidores de início:', err);
    return { avisados: 0, motivo: 'erro' };
  }
}

/** Nome de exibição para o texto do push; cai num genérico se sumir. */
async function nomeDoUsuario(userId: string): Promise<string> {
  const rows = await sql`SELECT name FROM users WHERE id = ${userId} LIMIT 1`;
  return rows.length ? String((rows[0] as Record<string, unknown>).name) : '';
}
