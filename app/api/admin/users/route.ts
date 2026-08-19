import { handle } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { sql } from '@/lib/db';

/**
 * Listagem paginada e monitoramento em tempo real de velejadores para o painel Admin.
 * Retorna estatísticas globais de acesso (DAU, online, velejos) e dados detalhados de cada usuário.
 */
export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim().toLowerCase() || '';
    const roleFilter = searchParams.get('role')?.trim() || '';
    const statusFilter = searchParams.get('status')?.trim() || ''; // 'online', 'today', 'inactive', 'all'
    const limit = Math.min(Math.max(1, Number(searchParams.get('limit')) || 50), 100);
    const offset = Math.max(0, Number(searchParams.get('offset')) || 0);

    const pattern = q ? `%${q}%` : null;

    // 1. Estatísticas Globais de Monitoramento
    const statsRows = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS total_users,
        (SELECT COUNT(*)::int FROM users WHERE is_active = TRUE) AS active_users,
        (SELECT COUNT(*)::int FROM user_presence WHERE last_seen_at > NOW() - INTERVAL '5 minutes') AS online_now,
        (SELECT COUNT(*)::int FROM users WHERE (last_seen_at IS NOT NULL AND last_seen_at > NOW() - INTERVAL '24 hours') OR (last_login_at IS NOT NULL AND last_login_at > NOW() - INTERVAL '24 hours')) AS active_today,
        (SELECT COUNT(*)::int FROM users WHERE (last_seen_at IS NOT NULL AND last_seen_at > NOW() - INTERVAL '7 days') OR (last_login_at IS NOT NULL AND last_login_at > NOW() - INTERVAL '7 days')) AS active_week,
        (SELECT COUNT(*)::int FROM sessions_log) AS total_sessions,
        (SELECT COUNT(*)::int FROM posts) AS total_posts,
        (SELECT COUNT(*)::int FROM chat_messages) AS total_messages
    `;
    const s = (statsRows[0] ?? {}) as Record<string, unknown>;
    const stats = {
      totalUsers: Number(s.total_users || 0),
      activeUsers: Number(s.active_users || 0),
      onlineNow: Number(s.online_now || 0),
      activeToday: Number(s.active_today || 0),
      activeWeek: Number(s.active_week || 0),
      totalSessions: Number(s.total_sessions || 0),
      totalPosts: Number(s.total_posts || 0),
      totalMessages: Number(s.total_messages || 0),
    };

    // 2. Consulta dos Usuários com Enriquecimento de Acessos
    const rows = await sql`
      SELECT
        u.id,
        u.email,
        u.name,
        u.role,
        u.rider_id,
        u.avatar_url,
        u.country_flag,
        u.is_active,
        u.must_change_password,
        u.home_spot,
        u.rider_level,
        u.weight_kg,
        u.created_at,
        u.updated_at,
        u.last_login_at,
        COALESCE(p.last_seen_at, u.last_seen_at, u.last_login_at, u.created_at) AS effective_last_seen,
        COALESCE(u.login_count, 1) AS login_count,
        u.last_user_agent,
        p.room AS current_room,
        p.at_spot_id AS current_spot_id,
        (p.last_seen_at IS NOT NULL AND p.last_seen_at > NOW() - INTERVAL '5 minutes') AS is_online,
        (SELECT COUNT(*)::int FROM sessions_log ses WHERE ses.user_id = u.id) AS total_user_sessions,
        (SELECT COUNT(*)::int FROM posts pos WHERE pos.user_id = u.id) AS total_user_posts,
        (SELECT COUNT(*)::int FROM chat_messages msg WHERE msg.user_id = u.id) AS total_user_messages
      FROM users u
      LEFT JOIN user_presence p ON p.user_id = u.id
      WHERE
        (${pattern}::text IS NULL OR LOWER(u.name) LIKE ${pattern} OR LOWER(u.email) LIKE ${pattern} OR u.rider_id LIKE ${pattern})
        AND (${roleFilter} = '' OR u.role = ${roleFilter})
        AND (
          ${statusFilter} = '' OR ${statusFilter} = 'all'
          OR (${statusFilter} = 'online' AND p.last_seen_at > NOW() - INTERVAL '5 minutes')
          OR (${statusFilter} = 'today' AND (p.last_seen_at > NOW() - INTERVAL '24 hours' OR u.last_login_at > NOW() - INTERVAL '24 hours'))
          OR (${statusFilter} = 'inactive' AND (p.last_seen_at IS NULL OR p.last_seen_at < NOW() - INTERVAL '7 days'))
        )
      ORDER BY
        (p.last_seen_at IS NOT NULL AND p.last_seen_at > NOW() - INTERVAL '5 minutes') DESC,
        effective_last_seen DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countRows = await sql`
      SELECT COUNT(*)::int AS total
      FROM users u
      LEFT JOIN user_presence p ON p.user_id = u.id
      WHERE
        (${pattern}::text IS NULL OR LOWER(u.name) LIKE ${pattern} OR LOWER(u.email) LIKE ${pattern} OR u.rider_id LIKE ${pattern})
        AND (${roleFilter} = '' OR u.role = ${roleFilter})
        AND (
          ${statusFilter} = '' OR ${statusFilter} = 'all'
          OR (${statusFilter} = 'online' AND p.last_seen_at > NOW() - INTERVAL '5 minutes')
          OR (${statusFilter} = 'today' AND (p.last_seen_at > NOW() - INTERVAL '24 hours' OR u.last_login_at > NOW() - INTERVAL '24 hours'))
          OR (${statusFilter} = 'inactive' AND (p.last_seen_at IS NULL OR p.last_seen_at < NOW() - INTERVAL '7 days'))
        )
    `;

    const total = Number((countRows[0] as Record<string, unknown>)?.total || 0);

    return {
      stats,
      users: rows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          id: String(row.id),
          email: String(row.email),
          name: String(row.name),
          role: String(row.role),
          riderId: String(row.rider_id),
          avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
          countryFlag: row.country_flag ? String(row.country_flag) : '🇧🇷',
          isActive: Boolean(row.is_active),
          mustChangePassword: Boolean(row.must_change_password),
          homeSpot: row.home_spot ? String(row.home_spot) : null,
          riderLevel: String(row.rider_level || 'Intermediário'),
          weightKg: Number(row.weight_kg || 75),
          createdAt: String(row.created_at),
          lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
          lastSeenAt: row.effective_last_seen ? String(row.effective_last_seen) : String(row.created_at),
          loginCount: Number(row.login_count || 1),
          lastUserAgent: row.last_user_agent ? String(row.last_user_agent) : null,
          isOnline: Boolean(row.is_online),
          currentRoom: row.current_room ? String(row.current_room) : null,
          currentSpotId: row.current_spot_id ? String(row.current_spot_id) : null,
          totalSessions: Number(row.total_user_sessions || 0),
          totalPosts: Number(row.total_user_posts || 0),
          totalMessages: Number(row.total_user_messages || 0),
        };
      }),
      total,
      limit,
      offset,
    };
  });
}
