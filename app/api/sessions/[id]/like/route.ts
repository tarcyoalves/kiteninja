import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';
import { podeVerSessao } from '@/lib/social';

const UUID = /^[0-9a-f-]{36}$/i;

interface SessaoRow {
  user_id: unknown;
  is_public: unknown;
}

/**
 * Confere que a sessão existe E que quem está tentando curtir pode vê-la
 * (`lib/social.ts`, `podeVerSessao`) antes de deixar o INSERT acontecer.
 *
 * Sem isto, um velejador que descobrisse (ou adivinhasse) o UUID de uma
 * sessão PRIVADA de um estranho conseguiria curtir mesmo sem ter acesso a
 * ela — a única barreira hoje é "não sei o id", que não é barreira nenhuma.
 *
 * 404 genérico nos dois casos (não existe / existe mas é privada de
 * terceiro): mesmo princípio de MSG_DOWNWIND_NAO_ENCONTRADO em
 * lib/downwindAcesso.ts — se a mensagem fosse diferente, dava para usar a
 * curtida como oráculo de "essa sessão existe?" testando ids ao acaso.
 */
async function exigirSessaoVisivel(id: string, viewerId: string): Promise<void> {
  const rows = (await sql`
    SELECT user_id, is_public FROM sessions_log WHERE id = ${id} LIMIT 1
  `) as SessaoRow[];
  const row = rows[0];
  const visivel =
    row !== undefined &&
    podeVerSessao({ autorId: String(row.user_id), isPublic: Boolean(row.is_public) }, viewerId);
  if (!visivel) throw new HttpError(404, 'Sessão não encontrada.');
}

async function contarCurtidas(id: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS cnt FROM session_likes WHERE session_id = ${id}
  `;
  return Number((rows[0] as Record<string, unknown>).cnt);
}

/**
 * Curtir a sessão. `ON CONFLICT DO NOTHING` porque a PK composta de
 * `session_likes` (lib/schema.sql) já barra a duplicata no banco — o toque
 * duplo (dedo rápido, retry de rede) só precisa não virar erro 500.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de sessão inválido.');

    await exigirSessaoVisivel(id, user.id);

    await sql`
      INSERT INTO session_likes (session_id, user_id)
      VALUES (${id}, ${user.id})
      ON CONFLICT (session_id, user_id) DO NOTHING
    `;

    return { count: await contarCurtidas(id) };
  });
}

/**
 * Descurtir. Filtra por `user_id = ${user.id}` (lib/authz.test.ts exige isso
 * em toda mutação de dado de usuário): só apaga a PRÓPRIA curtida, nunca a de
 * outro velejador. Remover uma curtida que nunca existiu é no-op, mesmo
 * espírito do DELETE de user_follows em riders/[id]/follow — não precisa
 * checar visibilidade de novo aqui: apagar a própria opinião sobre uma
 * sessão nunca vaza nada que o POST já não tivesse exposto.
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de sessão inválido.');

    await sql`
      DELETE FROM session_likes WHERE session_id = ${id} AND user_id = ${user.id}
    `;

    return { count: await contarCurtidas(id) };
  });
}
