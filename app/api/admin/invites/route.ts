import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { createInvite, requireAdmin } from '@/lib/auth';
import { str } from '@/lib/validation';

function appOrigin(request: Request): string {
  // Em produção usamos a origem configurada; em preview/local caímos no host da
  // própria requisição para o link não apontar para o lugar errado.
  const configured = process.env.APP_URL?.replace(/\/$/, '');
  if (configured) return configured;
  return new URL(request.url).origin;
}

/** Lista convites do admin, sem nunca devolver o token (só o hash existe). */
export async function GET() {
  return handle(async () => {
    await requireAdmin();

    const rows = await sql`
      SELECT i.id, i.email, i.note, i.expires_at, i.used_at, i.revoked_at,
             u.name AS used_by_name
      FROM invites i
      LEFT JOIN users u ON u.id = i.used_by
      ORDER BY i.created_at DESC
      LIMIT 100
    `;

    return {
      invites: rows.map((r) => {
        const row = r as Record<string, unknown>;
        const expired = new Date(String(row.expires_at)) < new Date();
        return {
          id: String(row.id),
          email: row.email ?? null,
          note: row.note ?? null,
          expiresAt: row.expires_at,
          usedAt: row.used_at ?? null,
          usedByName: row.used_by_name ?? null,
          status: row.revoked_at
            ? 'revogado'
            : row.used_at
              ? 'usado'
              : expired
                ? 'expirado'
                : 'aberto',
        };
      }),
    };
  });
}

/**
 * Gera um convite. O token em claro aparece UMA única vez, aqui na resposta —
 * depois disso só existe o hash no banco e não há como recuperá-lo.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = await readJson(request);

    const emailRaw = str(body, 'email', { optional: true, max: 254 });
    const note = str(body, 'note', { optional: true, max: 200 });

    const { token, expiresAt } = await createInvite(admin.id, {
      email: emailRaw || undefined,
      note: note || undefined,
    });

    return {
      inviteUrl: `${appOrigin(request)}/convite/${token}`,
      expiresAt: expiresAt.toISOString(),
      warning: 'Copie o link agora. Ele não pode ser recuperado depois.',
    };
  });
}
