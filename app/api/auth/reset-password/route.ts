import { handle, readJson } from '@/lib/api';
import { HttpError, consumePasswordReset, hashPassword } from '@/lib/auth';
import { password as parsePassword, str } from '@/lib/validation';

/**
 * Consome o token de recuperação e redefine a senha do usuário.
 *
 * Invalida o token de uso único e encerra todas as sessões ativas do usuário.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    const token = str(body, 'token', { max: 200 });
    const newPassword = parsePassword(body, 'newPassword');

    const passwordHash = await hashPassword(newPassword);
    const ok = await consumePasswordReset(token, passwordHash);

    if (!ok) {
      throw new HttpError(400, 'Link de recuperação inválido, expirado ou já utilizado.');
    }

    return { ok: true, message: 'Senha redefinida com sucesso. Faça login com a nova senha.' };
  });
}
