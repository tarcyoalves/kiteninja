import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { HttpError, createSession, verifyPassword } from '@/lib/auth';
import { email as parseEmail } from '@/lib/validation';

// Hash descartável de uma senha inexistente. Se o email não existe, ainda
// gastamos o mesmo tempo de bcrypt — sem isso, a diferença de resposta revelaria
// quais emails estão cadastrados.
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO1pJ8Yd6xUqZ6ZQ0Zj3Z8QqW1lYqPYbS';

export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    const email = parseEmail(body);
    const rawPassword = (body as Record<string, unknown>)?.password;

    if (typeof rawPassword !== 'string' || rawPassword.length === 0) {
      throw new HttpError(400, 'Informe a senha.');
    }

    const rows = await sql`
      SELECT id, password_hash, name, role, must_change_password
      FROM users WHERE LOWER(email) = ${email} LIMIT 1
    `;

    const row = rows[0] as Record<string, unknown> | undefined;
    const ok = await verifyPassword(rawPassword, row ? String(row.password_hash) : DUMMY_HASH);

    // Mensagem idêntica nos dois casos: não dizemos se foi o email ou a senha.
    if (!row || !ok) throw new HttpError(401, 'Email ou senha incorretos.');

    await createSession(String(row.id), request.headers.get('user-agent') ?? undefined);

    return {
      user: {
        id: String(row.id),
        email,
        name: String(row.name),
        role: row.role,
        mustChangePassword: Boolean(row.must_change_password),
      },
    };
  });
}
