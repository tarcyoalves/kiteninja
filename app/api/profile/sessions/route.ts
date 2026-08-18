import { handle } from '@/lib/api';
import { listUserSessions, requireUser, SESSION_COOKIE, hashToken } from '@/lib/auth';
import { sql } from '@/lib/db';
import { cookies } from 'next/headers';


/**
 * Lista as sessões ativas do usuário e permite revogar todas as outras sessões.
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const sessions = await listUserSessions(user.id);
    return { sessions };
  });
}

export async function DELETE() {
  return handle(async () => {
    const user = await requireUser();
    const jar = await cookies();
    const currentToken = jar.get(SESSION_COOKIE)?.value;

    if (currentToken) {
      const currentHash = hashToken(currentToken);
      // Remove todas as sessões do usuário EXCETO a atual
      await sql`
        DELETE FROM auth_sessions
        WHERE user_id = ${user.id} AND token_hash != ${currentHash}
      `;
    } else {
      await sql`DELETE FROM auth_sessions WHERE user_id = ${user.id}`;
    }

    return { ok: true, message: 'Todas as outras sessões foram desconectadas.' };
  });
}
