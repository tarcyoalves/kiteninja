import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';
import { exigirSessaoVisivel } from '@/lib/sessaoAcesso';
import { criarNotificacao } from '@/lib/notificacoes';
import { podeResponderComentario } from '@/lib/social';
import { str } from '@/lib/validation';
import type { SessionComment } from '@/types';

const UUID = /^[0-9a-f-]{36}$/i;

interface ComentarioRow {
  id: unknown;
  user_id: unknown;
  text: unknown;
  created_at: unknown;
  author_name: unknown;
  author_avatar_url: unknown;
  parent_comment_id: unknown;
}

/**
 * Comentários de UMA sessão. Só quem pode VER a sessão (`exigirSessaoVisivel`,
 * dono ou seguidor com sessão pública) pode ler os comentários dela — sem
 * isso, um velejador que adivinhasse o UUID de uma sessão privada de terceiro
 * conseguiria ler as opiniões alheias sobre ela mesmo sem acesso ao velejo.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de sessão inválido.');

    await exigirSessaoVisivel(id, user.id);

    const rows = (await sql`
      SELECT sc.id, sc.user_id, sc.text, sc.created_at, sc.parent_comment_id,
             u.name AS author_name, u.avatar_url AS author_avatar_url
      FROM session_comments sc
      JOIN users u ON u.id = sc.user_id
      WHERE sc.session_id = ${id}
      ORDER BY sc.created_at ASC
    `) as ComentarioRow[];

    const comentarios: SessionComment[] = rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      userName: String(r.author_name),
      userAvatarUrl: r.author_avatar_url ? String(r.author_avatar_url) : undefined,
      text: String(r.text),
      createdAt: String(r.created_at),
      parentCommentId: r.parent_comment_id ? String(r.parent_comment_id) : null,
    }));

    return { comentarios };
  });
}

/**
 * Comentar (ou responder um comentário de primeiro nível — Fase 6, estilo
 * Facebook: só 1 nível). Mesma checagem de visibilidade do GET: nunca deixa
 * alguém comentar numa sessão privada de terceiro só porque adivinhou o id.
 *
 * Devolve o comentário já no formato `SessionComment` completo (nome vem de
 * `user`, de `requireUser()`; avatar exige uma segunda consulta pequena —
 * ver comentário abaixo) para o cliente inserir otimisticamente na lista sem
 * esperar um novo GET.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de sessão inválido.');

    const { autorId: autorSessaoId } = await exigirSessaoVisivel(id, user.id);

    const body = await readJson(request);
    // Mesmo limite do CHECK de session_comments.text (lib/schema.sql).
    const text = str(body, 'text', { min: 1, max: 1000 });

    // `parentCommentId` é opcional: presente = está respondendo um comentário
    // já existente. Precisa pertencer à MESMA sessão da URL — sem isso, dava
    // para "responder" um comentário de uma sessão totalmente diferente,
    // vazando (via a notificação criada) que ele existe numa sessão que quem
    // responde talvez nem devesse saber que existe.
    const rawParentId = (body as Record<string, unknown> | null)?.parentCommentId;
    let parentCommentId: string | null = null;
    let autorComentarioPaiId: string | null = null;
    if (rawParentId !== undefined && rawParentId !== null && rawParentId !== '') {
      if (typeof rawParentId !== 'string' || !UUID.test(rawParentId)) {
        throw new HttpError(400, 'Comentário de referência inválido.');
      }
      const parentRows = await sql`
        SELECT parent_comment_id, user_id, session_id
        FROM session_comments WHERE id = ${rawParentId} LIMIT 1
      `;
      const parentRow = parentRows[0] as Record<string, unknown> | undefined;
      if (!parentRow || String(parentRow.session_id) !== id) {
        throw new HttpError(400, 'Comentário de referência inválido.');
      }
      const parentDoParaComentario = parentRow.parent_comment_id
        ? String(parentRow.parent_comment_id)
        : null;
      if (!podeResponderComentario({ parentCommentId: parentDoParaComentario })) {
        throw new HttpError(400, 'Só é possível responder a um comentário de primeiro nível.');
      }
      parentCommentId = rawParentId;
      autorComentarioPaiId = String(parentRow.user_id);
    }

    const inserted = await sql`
      INSERT INTO session_comments (session_id, user_id, text, parent_comment_id)
      VALUES (${id}, ${user.id}, ${text}, ${parentCommentId})
      RETURNING id, created_at
    `;
    const row = inserted[0] as Record<string, unknown>;

    // Notificação, depois do comentário/resposta gravado com sucesso:
    // resposta avisa o autor do comentário-pai; comentário raiz avisa o
    // autor da sessão. `criarNotificacao` já ignora sozinha o caso de
    // notificar a própria pessoa (comentar/responder a si mesmo).
    if (parentCommentId && autorComentarioPaiId) {
      await criarNotificacao({
        recipientId: autorComentarioPaiId,
        actorId: user.id,
        type: 'resposta_comentario',
        commentId: parentCommentId,
      });
    } else if (!parentCommentId) {
      await criarNotificacao({
        recipientId: autorSessaoId,
        actorId: user.id,
        type: 'comentario_sessao',
        sessionId: id,
      });
    }

    // `requireUser()` não carrega avatar_url (SessionUser não guarda esse
    // campo — ver lib/auth.ts) — uma segunda consulta minúscula pela PRÓPRIA
    // conta é mais barata que devolver o comentário criado sem avatar (o que
    // faria o autor ver o próprio avatar sumir da lista até o próximo GET).
    const avatarRows = await sql`SELECT avatar_url FROM users WHERE id = ${user.id} LIMIT 1`;
    const authorAvatarUrl = (avatarRows[0] as Record<string, unknown> | undefined)?.avatar_url;

    const comentario: SessionComment = {
      id: String(row.id),
      userId: user.id,
      userName: user.name,
      userAvatarUrl: authorAvatarUrl ? String(authorAvatarUrl) : undefined,
      text,
      createdAt: String(row.created_at),
      parentCommentId,
    };

    return { comentario };
  });
}
