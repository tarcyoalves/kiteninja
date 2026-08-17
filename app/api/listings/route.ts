import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';
import { bool, num, oneOf, str } from '@/lib/validation';
import {
  CATEGORIES_SIZE_CM,
  LISTING_CATEGORIES,
  LISTING_CONDITIONS,
  MAX_LISTING_PHOTOS,
  MAX_PHOTO_CHARS,
  isSafeImageDataUrl,
  parseListingFilters,
} from '@/lib/marketplace';
import type { Listing, ListingCategory, ListingCondition } from '@/types';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;

/** Escapa curinga de LIKE para a busca casar o texto literal digitado. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Converte a linha do banco no formato que a UI consome. */
function mapListing(row: Record<string, unknown>, userId: string): Listing {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    description: String(row.description),
    category: row.category as ListingCategory,
    condition: row.condition as ListingCondition,
    // BIGINT pode chegar como string do driver; Number() cobre os dois casos e
    // centavos cabem com folga no inteiro seguro do JS.
    priceCents: Number(row.price_cents),
    negotiable: Boolean(row.negotiable),
    brand: row.brand ? String(row.brand) : undefined,
    model: row.model ? String(row.model) : undefined,
    yearManufactured: row.year_manufactured != null ? Number(row.year_manufactured) : undefined,
    sizeM2: row.size_m2 != null ? Number(row.size_m2) : undefined,
    sizeCm: row.size_cm != null ? Number(row.size_cm) : undefined,
    city: String(row.city),
    state: String(row.state),
    status: row.status as Listing['status'],
    viewsCount: Number(row.views_count),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    coverPhoto: row.cover_photo ? String(row.cover_photo) : undefined,
    sellerName: String(row.seller_name),
    sellerAvatar: row.seller_avatar ? String(row.seller_avatar) : undefined,
    sellerRiderId: row.seller_rider_id ? String(row.seller_rider_id) : undefined,
    favoritesCount: Number(row.favorites_count),
    isFavorite: Boolean(row.is_favorite),
    isOwner: String(row.user_id) === userId,
  };
}

/**
 * Feed do marketplace com filtros.
 *
 * Os filtros são predicados SEMPRE presentes na query, no formato
 * `(${valor}::tipo IS NULL OR coluna = ${valor}::tipo)`. Nada de SQL montado por
 * concatenação nem placeholder numerado à mão: o texto da query é constante e
 * todo valor do usuário entra como parâmetro pela template tag. Já perdemos
 * tempo com um bug onde um índice de placeholder foi interpolado como literal e
 * o WHERE virou `coluna = 1`.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    const f = parseListingFilters(url.searchParams);

    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

    const busca = f.q ? likePattern(f.q) : null;
    // Prancha vende em cm, kite/wing/foil em m². Sem escolher a coluna certa o
    // filtro de tamanho compararia 9m² com 138cm na mesma escala.
    const usarCm = f.category != null && CATEGORIES_SIZE_CM.includes(f.category);

    const rows = await sql`
      SELECT
        l.id,
        l.user_id,
        l.title,
        l.description,
        l.category,
        l.condition,
        l.price_cents,
        l.negotiable,
        l.brand,
        l.model,
        l.year_manufactured,
        l.size_m2,
        l.size_cm,
        l.city,
        l.state,
        l.status,
        l.views_count,
        l.created_at,
        l.updated_at,
        u.name       AS seller_name,
        u.avatar_url AS seller_avatar,
        u.rider_id   AS seller_rider_id,
        (
          SELECT lp.data_url FROM listing_photos lp
          WHERE lp.listing_id = l.id
          ORDER BY lp.position ASC, lp.created_at ASC
          LIMIT 1
        ) AS cover_photo,
        (SELECT COUNT(*)::int FROM listing_favorites lf WHERE lf.listing_id = l.id)
          AS favorites_count,
        EXISTS (
          SELECT 1 FROM listing_favorites lf
          WHERE lf.listing_id = l.id AND lf.user_id = ${user.id}
        ) AS is_favorite
      FROM listings l
      JOIN users u ON u.id = l.user_id
      WHERE
        -- Visitante vê só anúncio ativo. Em "meus anúncios" o dono também vê
        -- reservado e vendido; 'Removido' fica fora porque, para ele, é apagado.
        (
          CASE WHEN ${f.mine}::boolean
            THEN l.user_id = ${user.id} AND l.status <> 'Removido'
            ELSE l.status = 'Ativo'
          END
        )
        AND (${f.category}::text IS NULL OR l.category = ${f.category}::text)
        AND (${f.condition}::text IS NULL OR l.condition = ${f.condition}::text)
        AND (${f.state}::text IS NULL OR l.state = ${f.state}::text)
        AND (${f.minPriceCents}::bigint IS NULL OR l.price_cents >= ${f.minPriceCents}::bigint)
        AND (${f.maxPriceCents}::bigint IS NULL OR l.price_cents <= ${f.maxPriceCents}::bigint)
        AND (
          ${f.minSize}::numeric IS NULL
          OR (CASE WHEN ${usarCm}::boolean THEN l.size_cm::numeric ELSE l.size_m2 END)
             >= ${f.minSize}::numeric
        )
        AND (
          ${f.maxSize}::numeric IS NULL
          OR (CASE WHEN ${usarCm}::boolean THEN l.size_cm::numeric ELSE l.size_m2 END)
             <= ${f.maxSize}::numeric
        )
        AND (
          ${busca}::text IS NULL
          OR l.title ILIKE ${busca}::text
          OR l.description ILIKE ${busca}::text
          OR COALESCE(l.brand, '') ILIKE ${busca}::text
          OR COALESCE(l.model, '') ILIKE ${busca}::text
        )
        AND (
          NOT ${f.favorites}::boolean
          OR EXISTS (
            SELECT 1 FROM listing_favorites lf
            WHERE lf.listing_id = l.id AND lf.user_id = ${user.id}
          )
        )
      -- ORDER BY não aceita parâmetro, então a ordenação vira CASE: quando o
      -- critério não é o escolhido, a expressão é NULL para todas as linhas,
      -- empata, e o desempate cai no created_at.
      ORDER BY
        CASE WHEN ${f.sort}::text = 'price_asc'  THEN l.price_cents END ASC  NULLS LAST,
        CASE WHEN ${f.sort}::text = 'price_desc' THEN l.price_cents END DESC NULLS LAST,
        l.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const listings = rows.map((row) => mapListing(row as Record<string, unknown>, user.id));

    return {
      listings,
      // O cliente decide se ainda há página seguinte sem um COUNT(*) extra
      // sobre a tabela inteira, que ficaria caro conforme o marketplace cresce.
      hasMore: listings.length === limit,
      limit,
      offset,
    };
  });
}

/** Cria um anúncio, com até 6 fotos já comprimidas no cliente. */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson(request);

    const title = str(body, 'title', { min: 4, max: 120 });
    const description = str(body, 'description', { min: 10, max: 4000 });
    const category = oneOf<ListingCategory>(body, 'category', LISTING_CATEGORIES);
    const condition = oneOf<ListingCondition>(body, 'condition', LISTING_CONDITIONS);

    /**
     * Preço chega em centavos inteiros do cliente. Rejeitar fração aqui é o que
     * garante que nenhum float entre no banco: "R$ 19,99" tem de virar 1999, e
     * 1998.9999 seria sinal de conta feita em ponto flutuante do outro lado.
     */
    const priceRaw = num(body, 'priceCents', { min: 0, max: 100_000_000 });
    if (priceRaw === null || !Number.isInteger(priceRaw)) {
      throw new HttpError(400, 'Preço deve ser informado em centavos inteiros.');
    }
    const priceCents = priceRaw;

    const negotiable = bool(body, 'negotiable', true);
    const brand = str(body, 'brand', { optional: true, max: 80 });
    const model = str(body, 'model', { optional: true, max: 80 });
    const yearManufactured = num(body, 'yearManufactured', {
      optional: true,
      min: 1990,
      max: new Date().getFullYear() + 1,
    });
    const sizeM2 = num(body, 'sizeM2', { optional: true, min: 0.5, max: 25 });
    const sizeCm = num(body, 'sizeCm', { optional: true, min: 50, max: 300 });
    const city = str(body, 'city', { min: 2, max: 80 });
    const state = str(body, 'state', { min: 2, max: 40 });

    const rawPhotos = (body as Record<string, unknown>)?.photos;
    const photos: string[] = Array.isArray(rawPhotos) ? rawPhotos.map((p) => String(p)) : [];

    if (photos.length > MAX_LISTING_PHOTOS) {
      throw new HttpError(400, `Máximo de ${MAX_LISTING_PHOTOS} fotos por anúncio.`);
    }
    for (const photo of photos) {
      if (photo.length > MAX_PHOTO_CHARS) {
        throw new HttpError(400, 'Uma das fotos está grande demais. Tente novamente.');
      }
      // Recusar URL externa evita que o anúncio se transforme em vetor de
      // requisição a terceiros: quem abrisse o feed disparava um GET no host do
      // anunciante, entregando IP e User-Agent da comunidade toda.
      if (!isSafeImageDataUrl(photo)) {
        throw new HttpError(400, 'Formato de imagem não suportado. Envie JPG, PNG ou WEBP.');
      }
    }

    const inserted = await sql`
      INSERT INTO listings (
        user_id, title, description, category, condition, price_cents, negotiable,
        brand, model, year_manufactured, size_m2, size_cm, city, state
      )
      VALUES (
        ${user.id}, ${title}, ${description}, ${category}, ${condition},
        ${priceCents}, ${negotiable}, ${brand || null}, ${model || null},
        ${yearManufactured}, ${sizeM2}, ${sizeCm}, ${city}, ${state}
      )
      RETURNING id
    `;

    const listingId = String((inserted[0] as Record<string, unknown>).id);

    if (photos.length > 0) {
      // unnest WITH ORDINALITY grava todas as fotos em uma ida ao banco,
      // preservando a ordem que o velejador montou na tela.
      await sql`
        INSERT INTO listing_photos (listing_id, data_url, position)
        SELECT ${listingId}, foto, ord - 1
        FROM unnest(${photos}::text[]) WITH ORDINALITY AS t(foto, ord)
      `;
    }

    return { id: listingId };
  });
}
