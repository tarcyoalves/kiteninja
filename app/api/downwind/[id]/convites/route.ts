import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser, HttpError, newToken, hashToken } from '@/lib/auth';
import { canModerate } from '@/lib/authz';
import { buscarParticipacao, buscarStatusDownwind, ehUuid } from '@/lib/downwindDb';

export const dynamic = 'force-dynamic';

/** Link de apoio em terra sem conta — pedido do dono. Sempre 12h, sempre apoio_terra. */
const VALIDADE_HORAS = 12;

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Gera o link de convite de 12h para apoio em terra sem conta (motorista).
 *
 * Quem pode: o organizador DESTE downwind, ou moderação. Não é
 * `requireDownwindOrganizer()` (aquela função checa a liberação GERAL de
 * organizar downwind, `pode_organizar_downwind`) — aqui a pergunta é mais
 * estreita: "você organiza ESTE downwind específico?".
 *
 * O token em claro só existe nesta resposta — o banco guarda só o hash
 * (mesmo padrão de invites/downwind_convites). Reutilizável: `max_usos` fica
 * NULL de propósito, então vários motoristas podem entrar com o MESMO link
 * dentro da janela de 12h — o pedido foi "um link para os motoristas", não
 * um link por pessoa.
 */
export async function POST(request: Request, ctx: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!ehUuid(id)) throw new HttpError(404, 'Downwind não encontrado.');

    const status = await buscarStatusDownwind(id);
    if (status === null) throw new HttpError(404, 'Downwind não encontrado.');
    if (status === 'encerrado' || status === 'cancelado') {
      throw new HttpError(409, 'Este downwind já terminou.');
    }

    const participacao = await buscarParticipacao(id, user.id);
    const souOrganizador = participacao?.ehOrganizador === true;
    if (!souOrganizador && !canModerate(user.role)) {
      throw new HttpError(403, 'Só o organizador pode gerar o link de apoio.');
    }

    const token = newToken();
    const expiraEm = new Date(Date.now() + VALIDADE_HORAS * 3_600_000);

    await sql`
      INSERT INTO downwind_convites (downwind_id, token_hash, criado_por, papel_destino, expira_em)
      VALUES (${id}, ${hashToken(token)}, ${user.id}, 'apoio_terra', ${expiraEm.toISOString()})
    `;

    return { token, expiresAt: expiraEm.toISOString() };
  });
}
