import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { HttpError, requireAdmin } from '@/lib/auth';
import { oneOf, str } from '@/lib/validation';
import { registrarAcaoAdmin } from '@/lib/auditoriaAdmin';
import type { StatusChamado } from '@/types';

/**
 * Atualiza status e/ou parecer de UM chamado — atrás de requireAdmin, nunca
 * um usuário comum. Pelo menos um dos dois campos precisa vir no corpo.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
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

    // O FROM traz o status de ANTES do UPDATE, para a auditoria dizer "de
    // novo para aprovado" sem uma segunda consulta (ver users/[id]/route.ts).
    const rows = await sql`
      UPDATE chamados
      SET status = COALESCE(${status ?? null}, chamados.status),
          parecer = COALESCE(${parecer}, chamados.parecer),
          atualizado_em = NOW()
      FROM (SELECT id AS id_anterior, status AS status_anterior FROM chamados WHERE id = ${id}) anterior
      WHERE chamados.id = anterior.id_anterior
      RETURNING chamados.id, anterior.status_anterior
    `;

    if (rows.length === 0) {
      throw new HttpError(404, 'Chamado não encontrado.');
    }

    const statusAnterior = (rows[0] as Record<string, unknown>).status_anterior;
    if (status !== undefined && status !== statusAnterior) {
      await registrarAcaoAdmin(admin.id, 'admin.chamado.status_alterado', id, {
        de: statusAnterior,
        para: status,
      }, request);
    }
    // O texto do parecer não vai para o log: é opinião sobre um chamado de
    // outra pessoa, e o que interessa auditar é que o admin mexeu nele.
    if (parecer) {
      await registrarAcaoAdmin(admin.id, 'admin.chamado.parecer_alterado', id, {}, request);
    }

    return { ok: true };
  });
}
