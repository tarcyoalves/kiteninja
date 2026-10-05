import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { HttpError, createSession, verifyPassword } from '@/lib/auth';
import { limparFalhasLogin, registrarFalhaLogin, verificarBloqueioLogin } from '@/lib/rateLimit';
import { email as parseEmail } from '@/lib/validation';

// Hash descartável de uma senha inexistente. Se o email não existe, ainda
// gastamos o mesmo tempo de bcrypt — sem isso, a diferença de resposta revelaria
// quais emails estão cadastrados.
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO1pJ8Yd6xUqZ6ZQ0Zj3Z8QqW1lYqPYbS';

export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    const email = parseEmail(body);

    // Só confere o bloqueio; NÃO conta esta tentativa. Contar acontece mais
    // abaixo, e só se a senha errar — ver o comentário de
    // `verificarBloqueioLogin` em lib/rateLimit.ts.
    await verificarBloqueioLogin(email);

    const rawPassword = (body as Record<string, unknown>)?.password;


    if (typeof rawPassword !== 'string' || rawPassword.length === 0) {
      throw new HttpError(400, 'Informe a senha.');
    }

    const rows = await sql`
      SELECT id, password_hash, name, role, must_change_password, is_active
      FROM users WHERE LOWER(email) = ${email} LIMIT 1
    `;

    const row = rows[0] as Record<string, unknown> | undefined;
    const ok = await verifyPassword(rawPassword, row ? String(row.password_hash) : DUMMY_HASH);

    // Mensagem idêntica nos dois casos: não dizemos se foi o email ou a senha.
    // A falha é registrada nos dois casos também — senão a contagem de
    // bloqueio revelaria quais emails existem.
    if (!row || !ok) {
      await registrarFalhaLogin(email);
      throw new HttpError(401, 'Email ou senha incorretos.');
    }

    // Entrou: as falhas de antes deixam de significar ataque.
    await limparFalhasLogin(email);

    /*
     * CONTA SUSPENSA NÃO ENTRA — e ouve o porquê.
     *
     * Antes o login respondia 200 e criava sessão para conta suspensa. Não
     * era brecha (getSessionUser filtra is_active, então a sessão nascia
     * inútil), mas era pior para quem usa: o app mostrava a pessoa logada e
     * na primeira ação tudo virava 401, sem explicação nenhuma. Achado
     * rodando o painel admin contra Postgres (lib/painelAdminFluxo.test.ts).
     *
     * Só depois de a senha conferir: dizer "suspensa" para quem não provou
     * a senha revelaria que o e-mail existe.
     */
    if (!row.is_active) {
      throw new HttpError(403, 'Sua conta está suspensa. Fale com o administrador do KiteNinja.');
    }

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
