import { handle } from '@/lib/api';
import { HttpError, requireUser, revokeUserSession } from '@/lib/auth';

/**
 * Revoga uma sessão específica de um usuário (identificada por ID).
 */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!id) {
      throw new HttpError(400, 'ID de sessão inválido.');
    }

    const ok = await revokeUserSession(user.id, id);
    if (!ok) {
      throw new HttpError(404, 'Sessão não encontrada.');
    }

    return { ok: true, message: 'Sessão desconectada.' };
  });
}
