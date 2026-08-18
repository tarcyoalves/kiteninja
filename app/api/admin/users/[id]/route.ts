import { handle, readJson } from '@/lib/api';
import { HttpError, invalidateAllUserSessions, requireAdmin } from '@/lib/auth';
import { sql } from '@/lib/db';
import { oneOf, bool } from '@/lib/validation';
import type { Role } from '@/lib/authz';

const ALLOWED_ROLES = ['admin', 'moderator', 'instructor', 'rider'] as const;

/**
 * Atualização de papel, status ativo/suspenso e exigência de troca de senha
 * para um velejador específico pelo administrador.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;

    if (!id) {
      throw new HttpError(400, 'ID de usuário inválido.');
    }

    const body = await readJson(request);
    const hasRole = (body as Record<string, unknown>)?.role !== undefined;
    const role = hasRole ? oneOf<Role>(body, 'role', ALLOWED_ROLES) : null;

    const hasActive = (body as Record<string, unknown>)?.isActive !== undefined;
    const isActive = hasActive ? bool(body, 'isActive') : null;

    const hasMustChange = (body as Record<string, unknown>)?.mustChangePassword !== undefined;
    const mustChangePassword = hasMustChange ? bool(body, 'mustChangePassword') : null;

    // Impede que o admin suspenda ou rebaixe a si próprio por engano
    if (admin.id === id && (isActive === false || (role && role !== 'admin'))) {
      throw new HttpError(400, 'Você não pode suspender nem rebaixar sua própria conta de administrador.');
    }

    const rows = await sql`
      UPDATE users SET
        role = COALESCE(${role}, role),
        is_active = COALESCE(${isActive}, is_active),
        deactivated_at = CASE WHEN ${isActive} = FALSE THEN NOW() WHEN ${isActive} = TRUE THEN NULL ELSE deactivated_at END,
        must_change_password = COALESCE(${mustChangePassword}, must_change_password),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, name, email, role, is_active, must_change_password
    `;

    if (rows.length === 0) {
      throw new HttpError(404, 'Usuário não encontrado.');
    }

    // Se o usuário foi suspenso, desconecta todas as suas sessões ativas
    if (isActive === false) {
      await invalidateAllUserSessions(id);
    }

    return { ok: true, user: rows[0] };
  });
}
