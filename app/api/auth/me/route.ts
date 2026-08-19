import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { getSessionUser } from '@/lib/auth';

export async function GET() {
  return handle(async () => {
    const session = await getSessionUser();
    if (!session) return { user: null };

    const rows = await sql`
      SELECT id, email, name, role, must_change_password, avatar_url, rider_id,
             nationality, country_flag, weight_kg, rider_level, home_spot,
             disciplines, highest_jump_m, bio,
             emergency_contact_name, emergency_contact_phone
      FROM users WHERE id = ${session.id} LIMIT 1
    `;

    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return { user: null };

    const stats = await sql`
      SELECT
        COUNT(*)::int                                   AS total_sessions,
        COALESCE(SUM(duration_minutes), 0)::int         AS total_minutes,
        COALESCE(SUM(distance_km), 0)::float            AS total_km,
        COALESCE(MAX(max_speed_knots), 0)::float        AS max_knots
      FROM sessions_log WHERE user_id = ${session.id}
    `;
    const s = stats[0] as Record<string, unknown>;

    return {
      user: {
        id: String(row.id),
        email: String(row.email),
        name: String(row.name),
        role: row.role,
        mustChangePassword: Boolean(row.must_change_password),
        avatarUrl: row.avatar_url ?? undefined,
        riderId: String(row.rider_id),
        nationality: String(row.nationality),
        countryFlag: String(row.country_flag),
        weightKg: Number(row.weight_kg),
        riderLevel: row.rider_level,
        homeSpot: row.home_spot ?? '',
        disciplines: row.disciplines ?? [],
        highestJumpM: row.highest_jump_m ? Number(row.highest_jump_m) : undefined,
        bio: row.bio ?? undefined,
        emergencyContactName: row.emergency_contact_name ? String(row.emergency_contact_name) : undefined,
        emergencyContactPhone: row.emergency_contact_phone ? String(row.emergency_contact_phone) : undefined,
        totalSessions: Number(s.total_sessions),
        totalHours: Math.round((Number(s.total_minutes) / 60) * 10) / 10,
        totalKm: Math.round(Number(s.total_km) * 10) / 10,
        maxKnotsRidden: Number(s.max_knots),
      },
    };
  });
}
