import { handle, readJson } from '@/lib/api';
import { createPasswordResetToken } from '@/lib/auth';
import { rateLimiters } from '@/lib/rateLimit';
import { email as parseEmail } from '@/lib/validation';

/**
 * Solicitação de recuperação de senha.
 *
 * Gera um token de uso único (expiração de 2h) guardado como hash no banco.
 * Em produção o link seria enviado por e-mail; a resposta retorna sucesso uniforme
 * mesmo se o e-mail não existir (evitando enumeração de contas).
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    const email = parseEmail(body);

    rateLimiters.passwordReset(email);

    const token = await createPasswordResetToken(email);

    return {
      ok: true,
      message: 'Se o e-mail estiver cadastrado, as instruções de recuperação foram geradas.',
      // Em ambiente de desenvolvimento/teste, expõe o token para validação automatizada
      ...(process.env.NODE_ENV !== 'production' && token ? { resetToken: token } : {}),
    };
  });
}
