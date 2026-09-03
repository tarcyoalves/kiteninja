import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { HttpError, createSession, hashPassword, newToken } from '@/lib/auth';
import { str } from '@/lib/validation';
import { rateLimiters } from '@/lib/rateLimit';
import { buscarConviteValido } from '@/lib/downwindDb';

export const dynamic = 'force-dynamic';

/**
 * Onboarding do link de 12h para apoio em terra — PÚBLICO, sem
 * `requireUser()`, de propósito: é exatamente o caminho para quem NÃO tem
 * conta. Decisão do dono, tomada cientes do que isso significa: o app é
 * fechado por convite de conta em todo o resto, e este é o único ponto de
 * entrada sem senha — mas escopado a um downwind e 12h, nunca ao app geral.
 *
 * O que acontece aqui, em ordem:
 * 1. Valida o token contra `downwind_convites` (não revogado, não expirado,
 *    dentro do limite de usos — mesma query que qualquer convite deste app).
 * 2. Cria uma conta DESCARTÁVEL em `users`, com `downwind_guest_of` apontando
 *    para o downwind — e-mail e senha são gerados aleatoriamente e nunca
 *    revelados a ninguém (nem ao próprio convidado): ele nunca vai logar de
 *    novo com credencial, só a sessão importa.
 * 3. Insere o participante como `apoio_terra`.
 * 4. Abre sessão de 12h (não os 30 dias padrão) — ver `createSession`,
 *    `opts.expiresInHours`.
 *
 * A partir daqui, `lib/auth.ts` (`requireUser()` rejeita por padrão
 * `guestDownwindId`) garante que esta conta só alcança o mapa e o chat do
 * PRÓPRIO downwind — nunca o resto do app. Ver o comentário em
 * `SessionUser.guestDownwindId`.
 */
interface Params {
  params: Promise<{ token: string }>;
}

export async function POST(request: Request, ctx: Params) {
  return handle(async () => {
    const { token } = await ctx.params;
    if (!token) throw new HttpError(404, 'Convite inválido ou expirado.');

    // Sem usuário autenticado ainda para chavear por id — mesmo padrão de
    // invites/validate: IP com fallback, porque é a única coisa disponível
    // antes do login existir.
    const ip = request.headers.get('x-forwarded-for') || 'unknown-ip';
    await rateLimiters.invite(ip);

    const body = await readJson(request);
    // str() já trima e recusa vazio (min:1 é o default) — ver lib/validation.ts.
    const nome = str(body, 'nome', { max: 60 });

    // Mesma função que app/dw-motorista/[token]/page.tsx usa para pré-validar
    // antes de mostrar o formulário — as duas nunca podem divergir sobre o
    // que conta como "válido" (ver lib/downwindDb.ts).
    const convite = await buscarConviteValido(token);
    if (!convite) throw new HttpError(404, 'Convite inválido ou expirado.');
    const downwindId = convite.downwindId;

    // Sufixo aleatório para e-mail/rider_id únicos — nunca exibido, nunca
    // usado para login de verdade. newToken() (base64url) tem `-`/`_`, que
    // saem por segurança de formato mesmo não sendo estritamente necessário
    // aqui (o e-mail nunca é validado por regex, é gerado por nós).
    const sufixo = newToken().replace(/[^a-zA-Z0-9]/g, '').slice(0, 20).toLowerCase();
    const email = `convidado-${sufixo}@dw.kiteninja.guest`;
    const riderId = `CONV-${sufixo.slice(0, 8).toUpperCase()}`;
    const senhaDescartavel = await hashPassword(newToken());

    const criado = await sql`
      INSERT INTO users (email, password_hash, name, role, rider_id, downwind_guest_of)
      VALUES (${email}, ${senhaDescartavel}, ${nome}, 'rider', ${riderId}, ${downwindId})
      RETURNING id
    `;
    const guestId = String((criado[0] as Record<string, unknown>).id);

    // Sem ON CONFLICT: este user_id acabou de nascer, nunca pode já ser
    // participante de nada.
    await sql`
      INSERT INTO downwind_participantes (downwind_id, user_id, papel)
      VALUES (${downwindId}, ${guestId}, 'apoio_terra')
    `;

    await sql`UPDATE downwind_convites SET usos = usos + 1 WHERE id = ${convite.id}`;

    await createSession(guestId, request.headers.get('user-agent') ?? undefined, {
      expiresInHours: 12,
    });

    return { ok: true };
  });
}
