import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { HttpError, hashPassword, requireUser, verifyPassword } from '@/lib/auth';
import { password as parsePassword } from '@/lib/validation';

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson(request);

    const currentRaw = (body as Record<string, unknown>)?.currentPassword;
    if (typeof currentRaw !== 'string' || currentRaw.length === 0) {
      throw new HttpError(400, 'Informe a senha atual.');
    }

    const next = parsePassword(body, 'newPassword');

    const rows = await sql`SELECT password_hash FROM users WHERE id = ${user.id} LIMIT 1`;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, 'Usuário não encontrado.');

    const ok = await verifyPassword(currentRaw, String(row.password_hash));
    if (!ok) throw new HttpError(401, 'Senha atual incorreta.');

    if (await verifyPassword(next, String(row.password_hash))) {
      throw new HttpError(400, 'A nova senha precisa ser diferente da atual.');
    }

    await sql`
      UPDATE users
      SET password_hash = ${await hashPassword(next)},
          must_change_password = FALSE,
          updated_at = NOW()
      WHERE id = ${user.id}
    `;

    // Encerra as outras sessões: se a senha foi trocada por suspeita de acesso
    // indevido, o invasor perde o acesso imediatamente.
    await sql`DELETE FROM auth_sessions WHERE user_id = ${user.id}`;

    return { ok: true, reauth: true };
  });
}
