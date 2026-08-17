import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Alterna o favorito do usuário no anúncio.
 *
 * A tabela listing_favorites tem chave primária composta (listing_id, user_id) e
 * nenhuma coluna `id` — a existência da linha é o próprio estado do favorito.
 *
 * O toggle é resolvido pelo banco: tentamos remover e, se nada foi removido,
 * inserimos. Dois toques rápidos não criam favorito duplicado nem contagem
 * negativa; o pior caso é o segundo toque desfazer o primeiro, que é exatamente
 * o comportamento esperado de um toggle.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de anúncio inválido.');

    // Anúncio removido não pode receber favorito novo, mas o usuário precisa
    // conseguir desfavoritar um que saiu do ar depois — daí a verificação só de
    // existência aqui, com o status checado abaixo apenas na inserção.
    const listing = await sql`SELECT id, status FROM listings WHERE id = ${id} LIMIT 1`;
    if (listing.length === 0) throw new HttpError(404, 'Anúncio não encontrado.');

    const removed = await sql`
      DELETE FROM listing_favorites
      WHERE listing_id = ${id} AND user_id = ${user.id}
      RETURNING listing_id
    `;

    let isFavorite: boolean;

    if (removed.length > 0) {
      isFavorite = false;
    } else {
      const status = String((listing[0] as Record<string, unknown>).status);
      if (status === 'Removido') {
        throw new HttpError(409, 'Este anúncio não está mais disponível.');
      }

      // ON CONFLICT cobre o caso de outra requisição ter inserido no mesmo
      // instante: com ou sem linha retornada, o estado final é "favoritado".
      await sql`
        INSERT INTO listing_favorites (listing_id, user_id)
        VALUES (${id}, ${user.id})
        ON CONFLICT (listing_id, user_id) DO NOTHING
      `;
      isFavorite = true;
    }

    const countRows = await sql`
      SELECT COUNT(*)::int AS cnt FROM listing_favorites WHERE listing_id = ${id}
    `;

    return {
      isFavorite,
      favoritesCount: Number((countRows[0] as Record<string, unknown>).cnt),
    };
  });
}
