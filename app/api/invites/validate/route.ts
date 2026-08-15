import { handle } from '@/lib/api';
import { findUsableInvite } from '@/lib/auth';

/**
 * Checa se um link de convite ainda vale, para a página mostrar o formulário ou
 * a mensagem de expirado. Não consome o convite.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const token = new URL(request.url).searchParams.get('token') ?? '';
    const invite = await findUsableInvite(token);

    if (!invite) return { valid: false as const };
    return { valid: true as const, email: invite.email };
  });
}
