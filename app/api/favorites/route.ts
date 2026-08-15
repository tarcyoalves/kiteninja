import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { HttpError } from '@/lib/auth';

export async function GET() {
  return handle(async () => {
    const user = await requireUser();

    const rows = await sql`
      SELECT spot_id FROM favorites
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
    `;

    const favorites = rows.map((row) => String((row as Record<string, unknown>).spot_id));
    return { favorites };
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson(request);

    const spotId = (body as Record<string, unknown>)?.spotId;
    if (!spotId || typeof spotId !== 'string') {
      throw new HttpError(400, 'spotId é obrigatório.');
    }

    // Check if spot exists
    const spotExists = await sql`
      SELECT id FROM spots WHERE id = ${spotId} LIMIT 1
    `;
    if (spotExists.length === 0) {
      throw new HttpError(404, 'Spot não encontrado.');
    }

    // A tabela favorites tem chave composta (user_id, spot_id) e não tem coluna
    // `id`: a existência da linha é o próprio estado. Tentamos remover primeiro
    // e, se nada saiu, inserimos — o toggle fica resolvido no banco.
    const removed = await sql`
      DELETE FROM favorites
      WHERE user_id = ${user.id} AND spot_id = ${spotId}
      RETURNING spot_id
    `;

    if (removed.length > 0) return { isFavorite: false };

    await sql`
      INSERT INTO favorites (user_id, spot_id)
      VALUES (${user.id}, ${spotId})
      ON CONFLICT (user_id, spot_id) DO NOTHING
    `;
    return { isFavorite: true };
  });
}
