import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser, HttpError, newToken, hashToken } from '@/lib/auth';
import { canModerate } from '@/lib/authz';
import { buscarParticipacao, buscarStatusDownwind, ehUuid } from '@/lib/downwindDb';
import { sendPushToUsers } from '@/lib/push';
import { str } from '@/lib/validation';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

const VALIDADE_DIAS = 7;

export async function GET(request: Request, ctx: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!ehUuid(id)) throw new HttpError(404, 'Downwind não encontrado.');

    const status = await buscarStatusDownwind(id);
    if (status === null) throw new HttpError(404, 'Downwind não encontrado.');

    const participacao = await buscarParticipacao(id, user.id);
    const souOrganizador = participacao?.ehOrganizador === true;
    if (!souOrganizador && !canModerate(user.role)) {
      throw new HttpError(403, 'Apenas organizadores podem listar os convites.');
    }

    const rows = await sql`
      SELECT
        dui.id,
        dui.downwind_id,
        dui.inviter_id,
        dui.invitee_id,
        dui.role,
        dui.status,
        dui.expires_at,
        dui.created_at,
        u.name AS invitee_name,
        u.avatar_url AS invitee_avatar_url,
        u.rider_id AS invitee_rider_id
      FROM downwind_user_invites dui
      LEFT JOIN users u ON u.id = dui.invitee_id
      WHERE dui.downwind_id = ${id}
      ORDER BY dui.created_at DESC
    `;

    const invites = rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        downwindId: String(row.downwind_id),
        inviterId: String(row.inviter_id),
        inviteeId: row.invitee_id ? String(row.invitee_id) : null,
        role: String(row.role),
        status: String(row.status),
        expiresAt: String(row.expires_at),
        createdAt: String(row.created_at),
        invitee: row.invitee_id
          ? {
              name: String(row.invitee_name),
              avatarUrl: row.invitee_avatar_url ? String(row.invitee_avatar_url) : null,
              riderId: row.invitee_rider_id ? String(row.invitee_rider_id) : null,
            }
          : null,
      };
    });

    return { invites };
  });
}

export async function POST(request: Request, ctx: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!ehUuid(id)) throw new HttpError(404, 'Downwind não encontrado.');

    const status = await buscarStatusDownwind(id);
    if (status === null) throw new HttpError(404, 'Downwind não encontrado.');
    if (status === 'encerrado' || status === 'cancelado') {
      throw new HttpError(409, 'Este downwind já terminou.');
    }

    const participacao = await buscarParticipacao(id, user.id);
    const souOrganizador = participacao?.ehOrganizador === true;
    if (!souOrganizador && !canModerate(user.role)) {
      throw new HttpError(403, 'Apenas organizadores podem convidar velejadores para este downwind.');
    }

    const body = await readJson(request);
    const inviteeUserId = str(body, 'inviteeUserId', { optional: true, max: 100 });
    const createLink = Boolean((body as Record<string, unknown>)?.createLink);
    const roleRaw = str(body, 'role', { optional: true, max: 20 }) || 'velejador';

    if (roleRaw !== 'velejador' && roleRaw !== 'apoio_terra') {
      throw new HttpError(400, 'Papel de convite inválido.');
    }

    const expiresAt = new Date(Date.now() + VALIDADE_DIAS * 86_400_000);

    // 1. Criação de convite por link
    if (createLink) {
      const token = newToken();
      const tokenH = hashToken(token);

      const inserted = await sql`
        INSERT INTO downwind_user_invites (
          downwind_id, inviter_id, role, status, token_hash, expires_at
        )
        VALUES (
          ${id}, ${user.id}, ${roleRaw}, 'pendente', ${tokenH}, ${expiresAt.toISOString()}
        )
        RETURNING id
      `;

      return {
        id: String((inserted[0] as Record<string, unknown>).id),
        token,
        expiresAt: expiresAt.toISOString(),
      };
    }

    // 2. Convite para usuário específico do app
    if (!inviteeUserId) {
      throw new HttpError(400, 'Informe inviteeUserId ou createLink: true.');
    }

    if (inviteeUserId === user.id) {
      throw new HttpError(400, 'Você já é participante deste downwind.');
    }

    // Verifica se invitee existe
    const inviteeRows = await sql`SELECT id, name FROM users WHERE id = ${inviteeUserId} LIMIT 1`;
    if (inviteeRows.length === 0) throw new HttpError(404, 'Usuário convidado não encontrado.');
    const inviteeName = String((inviteeRows[0] as Record<string, unknown>).name);

    // Verifica se já é participante
    const jaParticipa = await buscarParticipacao(id, inviteeUserId);
    if (jaParticipa && jaParticipa.estado !== 'desistiu' && jaParticipa.estado !== 'encerrado') {
      throw new HttpError(409, `${inviteeName} já participa deste downwind.`);
    }

    // Busca nome do downwind
    const dwRows = await sql`SELECT nome FROM downwinds WHERE id = ${id} LIMIT 1`;
    const dwNome = dwRows.length > 0 ? String((dwRows[0] as Record<string, unknown>).nome) : 'Downwind';

    const inserted = await sql`
      INSERT INTO downwind_user_invites (
        downwind_id, inviter_id, invitee_id, role, status, expires_at
      )
      VALUES (
        ${id}, ${user.id}, ${inviteeUserId}, ${roleRaw}, 'pendente', ${expiresAt.toISOString()}
      )
      RETURNING id
    `;
    const inviteId = String((inserted[0] as Record<string, unknown>).id);

    // Notificação in-app
    await sql`
      INSERT INTO notifications (
        recipient_id, actor_id, type, downwind_id, invite_id
      )
      VALUES (
        ${inviteeUserId}, ${user.id}, 'convite_downwind', ${id}, ${inviteId}
      )
    `;

    // Push notification (FCM + Web Push)
    sendPushToUsers([inviteeUserId], {
      title: 'Convite para Downwind',
      body: `${user.name} convidou você para o downwind "${dwNome}".`,
      url: `/?dw_invite_modal=${id}`,
      tag: `downwind-invite-${id}`,
    }).catch((err) => {
      console.warn('[downwind-invite] Falha ao despachar push de convite:', err);
    });

    return {
      id: inviteId,
      status: 'pendente',
      expiresAt: expiresAt.toISOString(),
    };
  });
}