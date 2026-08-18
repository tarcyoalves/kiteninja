import { handle } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { sql } from '@/lib/db';

/**
 * Listagem paginada de velejadores cadastrados para a área administrativa.
 * Suporta busca por nome, email ou rider_id, e filtro por papel.
 */
export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim().toLowerCase() || '';
    const roleFilter = searchParams.get('role')?.trim() || '';
    const limit = Math.min(Math.max(1, Number(searchParams.get('limit')) || 50), 100);
    const offset = Math.max(0, Number(searchParams.get('offset')) || 0);

    const pattern = q ? `%${q}%` : null;

    const rows = await sql`
      SELECT
        id, email, name, role, rider_id, avatar_url,
        is_active, must_change_password, home_spot,
        rider_level, weight_kg, created_at, updated_at
      FROM users
      WHERE
        (${pattern}::text IS NULL OR LOWER(name) LIKE ${pattern} OR LOWER(email) LIKE ${pattern} OR rider_id LIKE ${pattern})
        AND (${roleFilter} = '' OR role = ${roleFilter})
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countRows = await sql`
      SELECT COUNT(*)::int AS total
      FROM users
      WHERE
        (${pattern}::text IS NULL OR LOWER(name) LIKE ${pattern} OR LOWER(email) LIKE ${pattern} OR rider_id LIKE ${pattern})
        AND (${roleFilter} = '' OR role = ${roleFilter})
    `;

    const total = Number((countRows[0] as Record<string, unknown>)?.total || 0);

    return {
      users: rows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          id: String(row.id),
          email: String(row.email),
          name: String(row.name),
          role: String(row.role),
          riderId: String(row.rider_id),
          avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
          isActive: Boolean(row.is_active),
          mustChangePassword: Boolean(row.must_change_password),
          homeSpot: row.home_spot ? String(row.home_spot) : null,
          riderLevel: String(row.rider_level),
          weightKg: Number(row.weight_kg),
          createdAt: String(row.created_at),
        };
      }),
      total,
      limit,
      offset,
    };
  });
}
