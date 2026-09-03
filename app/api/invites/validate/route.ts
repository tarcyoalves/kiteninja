import { handle } from '@/lib/api';
import { findUsableInvite } from '@/lib/auth';
import { rateLimiters } from '@/lib/rateLimit';

/**
 * Checa se um link de convite ainda vale, para a página mostrar o formulário ou
 * a mensagem de expirado. Não consome o convite.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const ip = request.headers.get('x-forwarded-for') || 'unknown-ip';
    await rateLimiters.invite(ip);

    const token = new URL(request.url).searchParams.get('token') ?? '';
    const invite = await findUsableInvite(token);

    if (!invite) return { valid: false as const };
    return { valid: true as const, email: invite.email };
  });
}

