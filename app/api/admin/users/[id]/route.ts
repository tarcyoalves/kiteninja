import { handle, readJson } from '@/lib/api';
import { HttpError, invalidateAllUserSessions, requireAdmin } from '@/lib/auth';
import { sql } from '@/lib/db';
import { oneOf, bool } from '@/lib/validation';
import type { Role } from '@/lib/authz';
import { registrarAcaoAdmin } from '@/lib/auditoriaAdmin';

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

    // Formato validado aqui: um id que não é UUID chegava ao Postgres, que
    // estourava "invalid input syntax for type uuid" — 500 para o admin e uma
    // entrada falsa no próprio painel de Erros. Mesma checagem da rota /senha.
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
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

    /*
     * O FROM traz a linha como ela era ANTES do UPDATE (o subselect é lido no
     * começo do comando), para a auditoria registrar "de rider para admin" e
     * só o que de fato mudou — sem uma segunda consulta. As colunas dele têm
     * nomes próprios (`*_anterior`) para não colidir com `role`, `is_active`
     * etc. nas expressões do SET.
     */
    const rows = await sql`
      UPDATE users SET
        role = COALESCE(${role}, role),
        is_active = COALESCE(${isActive}, is_active),
        deactivated_at = CASE WHEN ${isActive} = FALSE THEN NOW() WHEN ${isActive} = TRUE THEN NULL ELSE deactivated_at END,
        must_change_password = COALESCE(${mustChangePassword}, must_change_password),
        updated_at = NOW()
      FROM (
        SELECT id AS id_anterior, role AS papel_anterior,
               is_active AS ativo_anterior, must_change_password AS troca_anterior
        FROM users WHERE id = ${id}
      ) anterior
      WHERE users.id = anterior.id_anterior
      RETURNING users.id, users.name, users.email, users.role, users.is_active,
                users.must_change_password,
                anterior.papel_anterior, anterior.ativo_anterior, anterior.troca_anterior
    `;

    if (rows.length === 0) {
      throw new HttpError(404, 'Usuário não encontrado.');
    }

    // Se o usuário foi suspenso, desconecta todas as suas sessões ativas
    if (isActive === false) {
      await invalidateAllUserSessions(id);
    }

    // Auditoria: uma linha por mudança real (o que já era assim não conta).
    // Depois de tudo, e sem poder derrubar a resposta — ver auditoriaAdmin.ts.
    const antes = rows[0] as Record<string, unknown>;
    if (role && role !== antes.papel_anterior) {
      await registrarAcaoAdmin(admin.id, 'admin.usuario.papel_alterado', id, {
        de: antes.papel_anterior,
        para: role,
      }, request);
    }
    if (isActive !== null && isActive !== antes.ativo_anterior) {
      await registrarAcaoAdmin(admin.id, isActive ? 'admin.usuario.reativado' : 'admin.usuario.suspenso', id, {}, request);
    }
    if (mustChangePassword !== null && mustChangePassword !== antes.troca_anterior) {
      await registrarAcaoAdmin(
        admin.id,
        mustChangePassword ? 'admin.usuario.troca_senha_exigida' : 'admin.usuario.troca_senha_dispensada',
        id,
        {},
        request
      );
    }

    const u = rows[0] as Record<string, unknown>;
    return {
      ok: true,
      user: {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        is_active: u.is_active,
        must_change_password: u.must_change_password,
      },
    };
  });
}
