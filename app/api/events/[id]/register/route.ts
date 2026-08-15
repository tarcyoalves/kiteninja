import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { HttpError } from '@/lib/auth';

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new HttpError(400, 'Identificador de evento inválido.');
    }

    // Check if event exists
    const eventExists = await sql`
      SELECT id FROM events WHERE id = ${id} LIMIT 1
    `;
    if (eventExists.length === 0) {
      throw new HttpError(404, 'Evento não encontrado.');
    }

    // Chave composta (event_id, user_id), sem coluna `id`: a linha é o estado.
    // Remover-e-se-nada-saiu-inserir deixa o toggle atômico no banco.
    const removed = await sql`
      DELETE FROM event_registrations
      WHERE event_id = ${id} AND user_id = ${user.id}
      RETURNING event_id
    `;

    if (removed.length > 0) {
      const count = await sql`
        SELECT COUNT(*)::int AS cnt FROM event_registrations WHERE event_id = ${id}
      `;
      return {
        isRegistered: false,
        participantsCount: Number((count[0] as Record<string, unknown>).cnt),
      };
    }

    await sql`
      INSERT INTO event_registrations (event_id, user_id)
      VALUES (${id}, ${user.id})
      ON CONFLICT (event_id, user_id) DO NOTHING
    `;

    const count = await sql`
      SELECT COUNT(*)::int AS cnt FROM event_registrations WHERE event_id = ${id}
    `;
    return {
      isRegistered: true,
      participantsCount: Number((count[0] as Record<string, unknown>).cnt),
    };
  });
}
