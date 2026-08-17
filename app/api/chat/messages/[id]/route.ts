import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Apaga uma mensagem. O autor apaga a própria; admin apaga qualquer uma
 * (moderação — uma sala pública precisa de alguém que remova abuso).
 *
 * O DELETE é sempre filtrado por `user_id = ${user.id}`, com UMA exceção
 * documentada: quando `user.role === 'admin'`, o filtro é dispensado. Isso está
 * escrito como dois comandos distintos em vez de um WHERE condicional esperto:
 * o caminho do velejador comum não tem como perder o filtro por acidente de
 * refatoração.
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de mensagem inválido.');

    const rows =
      user.role === 'admin'
        ? // Exceção justificada: moderação de sala pública.
          await sql`DELETE FROM chat_messages WHERE id = ${id} RETURNING id`
        : await sql`
            DELETE FROM chat_messages
            WHERE id = ${id} AND user_id = ${user.id}
            RETURNING id
          `;

    if (rows.length === 0) {
      // Mesma resposta para "não existe" e "não é sua": responder diferente
      // revelaria a existência de mensagens de outras pessoas.
      throw new HttpError(404, 'Mensagem não encontrada ou sem permissão para excluir.');
    }

    return { ok: true, id };
  });
}
