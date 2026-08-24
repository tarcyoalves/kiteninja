import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { HttpError, requireAdmin } from '@/lib/auth';
import { oneOf, str } from '@/lib/validation';
import type { StatusChamado } from '@/types';

/**
 * Atualiza status e/ou parecer de UM chamado — atrás de requireAdmin, nunca
 * um usuário comum. Pelo menos um dos dois campos precisa vir no corpo.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await ctx.params;

    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new HttpError(400, 'Identificador de chamado inválido.');
    }

    const body = await readJson(request);
    const bodyObj = body as Record<string, unknown> | null;

    // status é opcional de verdade (ausente = não mexe nele) — oneOf() só
    // aceita "opcional com valor padrão", então a presença é checada antes de
    // chamar oneOf, que aqui só valida um valor que de fato veio no corpo.
    const statusRaw = bodyObj?.status;
    const status =
      statusRaw === undefined || statusRaw === null || statusRaw === ''
        ? undefined
        : oneOf<StatusChamado>(body, 'status', [
            'novo',
            'em_analise',
            'aprovado',
            'rejeitado',
            'implementado',
          ]);

    const parecerBruto = str(body, 'parecer', { optional: true, max: 2000 });
    const parecer = parecerBruto || null;

    if (status === undefined && !parecer) {
      throw new HttpError(400, 'Nada para atualizar.');
    }

    const rows = await sql`
      UPDATE chamados
      SET status = COALESCE(${status ?? null}, status),
          parecer = COALESCE(${parecer}, parecer),
          atualizado_em = NOW()
      WHERE id = ${id}
      RETURNING id
    `;

    if (rows.length === 0) {
      throw new HttpError(404, 'Chamado não encontrado.');
    }

    return { ok: true };
  });
}
