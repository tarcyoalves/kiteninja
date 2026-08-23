import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';
import { exigirSessaoVisivel } from '@/lib/sessaoAcesso';
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
      SELECT sc.id, sc.user_id, sc.text, sc.created_at,
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
    }));

    return { comentarios };
  });
}

/**
 * Comentar. Mesma checagem de visibilidade do GET: nunca deixa alguém
 * comentar numa sessão privada de terceiro só porque adivinhou o id.
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

    await exigirSessaoVisivel(id, user.id);

    const body = await readJson(request);
    // Mesmo limite do CHECK de session_comments.text (lib/schema.sql).
    const text = str(body, 'text', { min: 1, max: 1000 });

    const inserted = await sql`
      INSERT INTO session_comments (session_id, user_id, text)
      VALUES (${id}, ${user.id}, ${text})
      RETURNING id, created_at
    `;
    const row = inserted[0] as Record<string, unknown>;

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
    };

    return { comentario };
  });
}
