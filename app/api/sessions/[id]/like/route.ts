import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';
import { exigirSessaoVisivel } from '@/lib/sessaoAcesso';

const UUID = /^[0-9a-f-]{36}$/i;

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
