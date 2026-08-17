import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';
import { num, oneOf, str } from '@/lib/validation';
import {
  LISTING_CATEGORIES,
  LISTING_CONDITIONS,
  MAX_LISTING_PHOTOS,
  MAX_PHOTO_CHARS,
  isSafeImageDataUrl,
} from '@/lib/marketplace';
import type { Listing, ListingCategory, ListingCondition, ListingStatus } from '@/types';

const UUID = /^[0-9a-f-]{36}$/i;

/** Status que o dono pode escolher. 'Removido' só pelo DELETE. */
const STATUS_EDITAVEIS = ['Ativo', 'Reservado', 'Vendido'] as const;

/** Distingue "campo não enviado" de "campo enviado vazio". */
function sent(body: unknown, field: string): boolean {
  return (
    body !== null &&
    typeof body === 'object' &&
    Object.prototype.hasOwnProperty.call(body, field) &&
    (body as Record<string, unknown>)[field] !== undefined
  );
}

/** Detalhe do anúncio: todas as fotos, dados do vendedor e contagem de favoritos. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de anúncio inválido.');

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
          SELECT COALESCE(json_agg(lp.data_url ORDER BY lp.position ASC, lp.created_at ASC), '[]'::json)
          FROM listing_photos lp
          WHERE lp.listing_id = l.id
        ) AS photos,
        (SELECT COUNT(*)::int FROM listing_favorites lf WHERE lf.listing_id = l.id)
          AS favorites_count,
        EXISTS (
          SELECT 1 FROM listing_favorites lf
          WHERE lf.listing_id = l.id AND lf.user_id = ${user.id}
        ) AS is_favorite
      FROM listings l
      JOIN users u ON u.id = l.user_id
      WHERE l.id = ${id}
        -- Anúncio removido só continua visível para o próprio dono.
        AND (l.status <> 'Removido' OR l.user_id = ${user.id})
      LIMIT 1
    `;

    if (rows.length === 0) throw new HttpError(404, 'Anúncio não encontrado.');

    const r = rows[0] as Record<string, unknown>;
    const isOwner = String(r.user_id) === user.id;

    /**
     * Visita do próprio dono não conta: senão o vendedor abre o anúncio dez
     * vezes para revisar o texto e o contador vira ruído para quem lê "127
     * visualizações" como sinal de interesse real.
     */
    if (!isOwner) {
      await sql`
        UPDATE listings SET views_count = views_count + 1
        WHERE id = ${id}
          -- Repete a regra no banco: se a checagem acima mudar, o dono
          -- continua não inflando o próprio contador.
          AND NOT (user_id = ${user.id})
      `;
    }

    const photos = (r.photos as unknown[] | null) ?? [];

    const listing: Listing = {
      id: String(r.id),
      userId: String(r.user_id),
      title: String(r.title),
      description: String(r.description),
      category: r.category as ListingCategory,
      condition: r.condition as ListingCondition,
      priceCents: Number(r.price_cents),
      negotiable: Boolean(r.negotiable),
      brand: r.brand ? String(r.brand) : undefined,
      model: r.model ? String(r.model) : undefined,
      yearManufactured: r.year_manufactured != null ? Number(r.year_manufactured) : undefined,
      sizeM2: r.size_m2 != null ? Number(r.size_m2) : undefined,
      sizeCm: r.size_cm != null ? Number(r.size_cm) : undefined,
      city: String(r.city),
      state: String(r.state),
      status: r.status as ListingStatus,
      // O incremento acima não está refletido na linha lida; somamos aqui para a
      // tela mostrar o número já contando a visita atual.
      viewsCount: Number(r.views_count) + (isOwner ? 0 : 1),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      photos: photos.map((p) => String(p)),
      coverPhoto: photos.length > 0 ? String(photos[0]) : undefined,
      sellerName: String(r.seller_name),
      sellerAvatar: r.seller_avatar ? String(r.seller_avatar) : undefined,
      sellerRiderId: r.seller_rider_id ? String(r.seller_rider_id) : undefined,
      favoritesCount: Number(r.favorites_count),
      isFavorite: Boolean(r.is_favorite),
      isOwner,
    };

    return { listing };
  });
}

/** Edita o próprio anúncio. Campos ausentes ficam como estão (COALESCE). */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = await readJson(request);

    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de anúncio inválido.');

    const owned = await sql`
      SELECT id FROM listings WHERE id = ${id} AND user_id = ${user.id} LIMIT 1
    `;
    if (owned.length === 0) {
      throw new HttpError(404, 'Anúncio não encontrado ou sem permissão para editar.');
    }

    const title = sent(body, 'title') ? str(body, 'title', { min: 4, max: 120 }) : null;
    const description = sent(body, 'description')
      ? str(body, 'description', { min: 10, max: 4000 })
      : null;
    const category = sent(body, 'category')
      ? oneOf<ListingCategory>(body, 'category', LISTING_CATEGORIES)
      : null;
    const condition = sent(body, 'condition')
      ? oneOf<ListingCondition>(body, 'condition', LISTING_CONDITIONS)
      : null;

    let priceCents: number | null = null;
    if (sent(body, 'priceCents')) {
      const raw = num(body, 'priceCents', { min: 0, max: 100_000_000 });
      if (raw === null || !Number.isInteger(raw)) {
        throw new HttpError(400, 'Preço deve ser informado em centavos inteiros.');
      }
      priceCents = raw;
    }

    const negotiable = sent(body, 'negotiable')
      ? (body as Record<string, unknown>).negotiable === true
      : null;
    const brand = sent(body, 'brand') ? str(body, 'brand', { optional: true, max: 80 }) : null;
    const model = sent(body, 'model') ? str(body, 'model', { optional: true, max: 80 }) : null;
    const yearManufactured = sent(body, 'yearManufactured')
      ? num(body, 'yearManufactured', {
          optional: true,
          min: 1990,
          max: new Date().getFullYear() + 1,
        })
      : null;
    const sizeM2 = sent(body, 'sizeM2') ? num(body, 'sizeM2', { optional: true, min: 0.5, max: 25 }) : null;
    const sizeCm = sent(body, 'sizeCm') ? num(body, 'sizeCm', { optional: true, min: 50, max: 300 }) : null;
    const city = sent(body, 'city') ? str(body, 'city', { min: 2, max: 80 }) : null;
    const state = sent(body, 'state') ? str(body, 'state', { min: 2, max: 40 }) : null;
    const status = sent(body, 'status')
      ? oneOf<(typeof STATUS_EDITAVEIS)[number]>(body, 'status', STATUS_EDITAVEIS)
      : null;

    // O filtro por user_id no WHERE é o que impede editar anúncio de terceiro,
    // mesmo que a checagem de posse acima seja removida por engano no futuro.
    await sql`
      UPDATE listings SET
        title             = COALESCE(${title}, title),
        description       = COALESCE(${description}, description),
        category          = COALESCE(${category}, category),
        condition         = COALESCE(${condition}, condition),
        price_cents       = COALESCE(${priceCents}, price_cents),
        negotiable        = COALESCE(${negotiable}, negotiable),
        brand             = COALESCE(${brand || null}, brand),
        model             = COALESCE(${model || null}, model),
        year_manufactured = COALESCE(${yearManufactured}, year_manufactured),
        size_m2           = COALESCE(${sizeM2}, size_m2),
        size_cm           = COALESCE(${sizeCm}, size_cm),
        city              = COALESCE(${city}, city),
        state             = COALESCE(${state}, state),
        status            = COALESCE(${status}, status),
        updated_at        = NOW()
      WHERE id = ${id} AND user_id = ${user.id}
    `;

    // Fotos, quando enviadas, substituem o conjunto inteiro: reordenar e remover
    // no cliente vira um só estado, sem diff parcial que possa deixar órfã.
    if (sent(body, 'photos')) {
      const rawPhotos = (body as Record<string, unknown>).photos;
      const photos: string[] = Array.isArray(rawPhotos) ? rawPhotos.map((p) => String(p)) : [];

      if (photos.length > MAX_LISTING_PHOTOS) {
        throw new HttpError(400, `Máximo de ${MAX_LISTING_PHOTOS} fotos por anúncio.`);
      }
      for (const photo of photos) {
        if (photo.length > MAX_PHOTO_CHARS) {
          throw new HttpError(400, 'Uma das fotos está grande demais. Tente novamente.');
        }
        if (!isSafeImageDataUrl(photo)) {
          throw new HttpError(400, 'Formato de imagem não suportado. Envie JPG, PNG ou WEBP.');
        }
      }

      await sql`
        DELETE FROM listing_photos
        WHERE listing_id IN (
          SELECT id FROM listings WHERE id = ${id} AND user_id = ${user.id}
        )
      `;

      if (photos.length > 0) {
        await sql`
          INSERT INTO listing_photos (listing_id, data_url, position)
          SELECT ${id}, foto, ord - 1
          FROM unnest(${photos}::text[]) WITH ORDINALITY AS t(foto, ord)
        `;
      }
    }

    return { ok: true };
  });
}

/**
 * "Remove" o anúncio marcando status='Removido'.
 *
 * Apagar de verdade levaria embora o histórico de quem já conversou sobre o
 * equipamento e as fotos que o próprio dono pode querer reaproveitar.
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de anúncio inválido.');

    const rows = await sql`
      UPDATE listings
      SET status = 'Removido', updated_at = NOW()
      WHERE id = ${id} AND user_id = ${user.id} AND status <> 'Removido'
      RETURNING id
    `;

    if (rows.length === 0) {
      throw new HttpError(404, 'Anúncio não encontrado ou sem permissão para remover.');
    }

    return { ok: true };
  });
}
