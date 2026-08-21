import { sql } from '@/lib/db';
import { handle, readOptionalJson } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { oneOf } from '@/lib/validation';
import { rateLimiters } from '@/lib/rateLimit';
import { ehUuid } from '@/lib/downwindDb';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Entra num downwind — o ponto de entrada é o card do evento em
 * views/EventsAndAlertsView.tsx, não um convite (downwind_convites fica fora
 * de escopo por ora: o downwind nasce de um evento visível a todo o app, que
 * já é fechado por convite de conta).
 *
 * IDEMPOTENTE de propósito: reabrir o card e tocar de novo, ou uma rede
 * instável duplicando a requisição, não pode virar erro nem trocar o papel de
 * quem já está navegando.
 */
export async function POST(request: Request, ctx: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!ehUuid(id)) throw new HttpError(404, 'Downwind não encontrado.');

    rateLimiters.downwindEntrar(user.id);

    const downwinds = await sql`SELECT status FROM downwinds WHERE id = ${id} LIMIT 1`;
    if (downwinds.length === 0) throw new HttpError(404, 'Downwind não encontrado.');
    const status = String((downwinds[0] as Record<string, unknown>).status);
    if (status !== 'aberto' && status !== 'em_andamento') {
      throw new HttpError(409, 'Este downwind já foi encerrado ou cancelado.');
    }

    const body = await readOptionalJson(request);
    const papel = oneOf(body, 'papel', ['velejador', 'apoio_terra'] as const, 'velejador');

    // Duas etapas em vez de um único ON CONFLICT com ação de escrita embutida:
    // o downwind já tem organizador inserido na criação (app/api/events/
    // route.ts), então o caso comum aqui É o conflito, não a exceção — e essa
    // ação embutida sem filtro explícito de participante escaparia da
    // varredura de lib/authz.test.ts que garante que toda mutação de dado de
    // usuário está filtrada. DO NOTHING resolve a corrida de dois toques
    // quase simultâneos no próprio banco (mesmo espírito do convite de uso
    // único, `WHERE used_at IS NULL`), sem escrever nada quando já existe.
    //
    // downwind_participantes tem PK composta (downwind_id, user_id), sem
    // coluna `id` — ver HANDOFF.md.
    const inserted = await sql`
      INSERT INTO downwind_participantes (downwind_id, user_id, papel)
      VALUES (${id}, ${user.id}, ${papel})
      ON CONFLICT (downwind_id, user_id) DO NOTHING
      RETURNING papel, estado, eh_organizador, apoio_user_id
    `;

    let rows = inserted;
    if (rows.length === 0) {
      // Já era participante: atualiza o papel e, se tinha desistido, volta
      // para 'confirmado' — a única volta permitida por lib/downwind.ts.
      // NUNCA rebaixa 'navegando' para 'confirmado': reabrir o card no meio
      // da travessia não pode tirar ninguém da água por engano.
      rows = await sql`
        UPDATE downwind_participantes
        SET papel = ${papel},
            estado = CASE WHEN estado = 'desistiu' THEN 'confirmado' ELSE estado END
        WHERE downwind_id = ${id} AND user_id = ${user.id}
        RETURNING papel, estado, eh_organizador, apoio_user_id
      `;
    }

    const r = rows[0] as Record<string, unknown>;
    return {
      minhaParticipacao: {
        papel: String(r.papel),
        estado: String(r.estado),
        ehOrganizador: Boolean(r.eh_organizador),
        apoioUserId: r.apoio_user_id ? String(r.apoio_user_id) : null,
      },
    };
  });
}
