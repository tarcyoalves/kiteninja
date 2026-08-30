import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { getSessionUser } from '@/lib/auth';
import { canOrganizeDownwind } from '@/lib/authz';

export async function GET() {
  return handle(async () => {
    const session = await getSessionUser();
    // Sessão de convidado (link de 12h) não conta como "logado" para o app
    // principal — ela é escopada só ao mapa/chat de UM downwind (ver
    // lib/auth.ts, SessionUser.guestDownwindId). Sem isto, um convidado que
    // abrisse a raiz do app em vez de /dw-motorista/[token] receberia o shell
    // inteiro (Feed, Mapa geral, Chat geral, Perfil) em vez de "logado
    // apenas para o mapa e chat da própria travessia".
    if (!session || session.guestDownwindId) return { user: null };

    const rows = await sql`
      SELECT id, email, name, role, must_change_password, avatar_url, rider_id,
             nationality, country_flag, weight_kg, height_cm, rider_level, home_spot,
             disciplines, quiver_kites, quiver_boards, preferred_wind_unit,
             highest_jump_m, bio, pode_organizar_downwind,
             emergency_contact_name, emergency_contact_phone,
             notificar_amigo_velejando
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
        canOrganizeDownwind: canOrganizeDownwind({
          id: String(row.id),
          role: row.role as 'admin' | 'moderator' | 'instructor' | 'rider',
          pode_organizar_downwind: Boolean(row.pode_organizar_downwind),
        }),
        avatarUrl: row.avatar_url ?? undefined,
        riderId: String(row.rider_id),
        nationality: String(row.nationality),
        countryFlag: String(row.country_flag),
        weightKg: Number(row.weight_kg),
        heightCm: row.height_cm ? Number(row.height_cm) : undefined,
        riderLevel: row.rider_level,
        homeSpot: row.home_spot ?? '',
        disciplines: row.disciplines ?? [],
        quiverKites: (row.quiver_kites as number[] | null)?.map(Number) ?? [],
        quiverBoards: (row.quiver_boards as string[] | null) ?? [],
        preferredWindUnit: row.preferred_wind_unit ? String(row.preferred_wind_unit) : 'knots',
        highestJumpM: row.highest_jump_m ? Number(row.highest_jump_m) : undefined,
        bio: row.bio ?? undefined,
        emergencyContactName: row.emergency_contact_name ? String(row.emergency_contact_name) : undefined,
        emergencyContactPhone: row.emergency_contact_phone ? String(row.emergency_contact_phone) : undefined,
        // `!== false` e não `Boolean(...)`: a coluna nasceu depois de contas
        // já existirem, e uma linha antiga pode vir NULL antes da migração
        // rodar. Nesse caso o padrão correto é LIGADO, igual ao DEFAULT da
        // coluna — não desligado por acidente de ordem de deploy.
        notificarAmigoVelejando: row.notificar_amigo_velejando !== false,
        totalSessions: Number(s.total_sessions),
        totalHours: Math.round((Number(s.total_minutes) / 60) * 10) / 10,
        totalKm: Math.round(Number(s.total_km) * 10) / 10,
        maxKnotsRidden: Number(s.max_knots),
      },
    };
  });
}
