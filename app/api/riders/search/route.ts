import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { relacaoComRider } from '@/lib/social';
import type { RiderSearchResult } from '@/types';

/** Abaixo disso não vale a pena tocar o banco: "j" ou "" traria a base toda. */
const MIN_CHARS = 2;
const LIMIT = 20;

/**
 * Escapa os curingas do ILIKE (`%` e `_`) para o texto digitado casar só o
 * literal — sem isso, alguém buscando "50%" (ex.: apelido) varreria a tabela
 * inteira, e "_" casaria qualquer caractere. Mesmo helper de
 * app/api/listings/route.ts, duplicado aqui porque é local a esta rota (uma
 * consulta de marketplace, outra de rider — nada em comum além do padrão).
 */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

interface RiderRow {
  id: unknown;
  name: unknown;
  avatar_url: unknown;
  rider_id: unknown;
  country_flag: unknown;
  rider_level: unknown;
  home_spot: unknown;
  eu_sigo: unknown;
  me_segue: unknown;
}

/**
 * Busca velejadores por nome ou rider_id para a tela de "buscar e adicionar
 * velejadores" (seção 4.5 do plano). Exige sessão: o app é fechado por
 * convite, uma busca sem login abriria a base inteira de nomes para fora.
 *
 * NUNCA seleciona email/password_hash/last_ip/last_user_agent — uma busca
 * aberta é onde esse vazamento aconteceria primeiro (ver lib/authz.test.ts,
 * que audita rotas por isso, e o teste espelho aqui embaixo).
 */
export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') ?? '').trim();

    if (q.length < MIN_CHARS) {
      return { riders: [] as RiderSearchResult[] };
    }

    const termo = likePattern(q);

    const rows = (await sql`
      SELECT
        u.id, u.name, u.avatar_url, u.rider_id, u.country_flag, u.rider_level, u.home_spot,
        EXISTS (
          SELECT 1 FROM user_follows f
          WHERE f.follower_id = ${user.id} AND f.following_id = u.id
        ) AS eu_sigo,
        EXISTS (
          SELECT 1 FROM user_follows f
          WHERE f.follower_id = u.id AND f.following_id = ${user.id}
        ) AS me_segue
      FROM users u
      WHERE u.is_active = TRUE
        AND u.id <> ${user.id}
        AND (u.name ILIKE ${termo} OR u.rider_id ILIKE ${termo})
      ORDER BY u.name ASC
      LIMIT ${LIMIT}
    `) as RiderRow[];

    const riders: RiderSearchResult[] = rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      avatarUrl: r.avatar_url ? String(r.avatar_url) : undefined,
      riderId: String(r.rider_id),
      countryFlag: String(r.country_flag),
      riderLevel: String(r.rider_level) as RiderSearchResult['riderLevel'],
      homeSpot: r.home_spot ? String(r.home_spot) : undefined,
      relacao: relacaoComRider(Boolean(r.eu_sigo), Boolean(r.me_segue)),
    }));

    return { riders };
  });
}
