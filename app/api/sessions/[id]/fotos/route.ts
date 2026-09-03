import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { podeVerSessao } from '@/lib/social';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * As fotos de UM velejo, buscadas sob demanda pelo card do feed.
 *
 * POR QUE AS FOTOS NÃO VÊM NA LISTAGEM
 *
 * As novas são URLs curtas do Vercel Blob e caberiam. As ANTIGAS não: elas
 * nasceram como data URL dentro de `sessions_log.photo_url` (a imagem inteira
 * em base64, até 1,5 MB) e foram copiadas para `session_photos` sem conversão
 * — ver o comentário da tabela em lib/schema.sql. Uma página de feed com 20
 * linhas dessas daria dezenas de MB numa requisição, no 4G da praia.
 *
 * Um caminho só para os dois formatos é melhor que dois caminhos condicionais:
 * a listagem devolve `totalFotos`, e o card pede as imagens quando elas vão
 * realmente ser vistas — no mesmo portão de `IntersectionObserver` que já
 * decide quando montar o Leaflet.
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
      SELECT user_id, is_public
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

    // A ordem sai do banco, não do acaso: `ordem` guarda a sequência que o
    // velejador montou na tela (ver lib/fotosDoVelejo.ts).
    const fotos = await sql`
      SELECT url FROM session_photos
      WHERE session_id = ${id}
      ORDER BY ordem ASC, created_at ASC
    `;

    return { fotos: fotos.map((f) => String((f as Record<string, unknown>).url)) };
  });
}
