import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { podeVerSessao } from '@/lib/social';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * A foto de UM velejo, buscada sob demanda pelo card do feed.
 *
 * POR QUE A FOTO NÃO VEM NA LISTAGEM
 *
 * `sessions_log.photo_url` guarda a imagem inteira como data URL — o logbook
 * aceita até 1,5 MB por sessão. Uma página do feed traz 20 linhas: mandar as
 * imagens junto daria dezenas de MB numa requisição só, no 4G de uma praia,
 * que é exatamente onde este app é usado.
 *
 * Então a listagem devolve apenas `temFoto: boolean`, e o card pede a imagem
 * quando ela vai realmente ser vista — no mesmo portão de
 * `IntersectionObserver` que já decide quando montar o Leaflet.
 *
 * O EFEITO COLATERAL FELIZ: a foto do velejo era gravada desde sempre e nunca
 * aparecia em lugar nenhum do feed — `app/api/feed/route.ts` não selecionava a
 * coluna. Mais um caso de dado registrado direito que não chegava a lugar
 * nenhum.
 *
 * PRIVACIDADE: mesma regra da listagem (`podeVerSessao`). Sessão marcada como
 * privada só devolve foto para o próprio autor; qualquer outro recebe 404,
 * indistinguível de "não existe".
 */
export async function GET(_request: Request, ctx: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new HttpError(404, 'Velejo não encontrado.');
    }

    const linhas = await sql`
      SELECT user_id, is_public, photo_url
      FROM sessions_log
      WHERE id = ${id}
      LIMIT 1
    `;
    if (linhas.length === 0) throw new HttpError(404, 'Velejo não encontrado.');
    const s = linhas[0] as Record<string, unknown>;

    const liberado = podeVerSessao(
      { autorId: String(s.user_id), isPublic: Boolean(s.is_public) },
      user.id
    );
    if (!liberado) throw new HttpError(404, 'Velejo não encontrado.');

    return { fotoUrl: s.photo_url ? String(s.photo_url) : null };
  });
}
