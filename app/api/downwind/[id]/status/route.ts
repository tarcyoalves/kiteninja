import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { oneOf } from '@/lib/validation';
import {
  podeCancelarDownwind,
  podeEncerrarDownwindComoUsuario,
  podeIniciarDownwind,
} from '@/lib/downwindAcesso';
import { buscarContexto, ehUuid, listarParticipantes, resumirEPurgar } from '@/lib/downwindDb';
import { revogarTodosTokensDoDownwind } from '@/lib/trackingToken';
import { sendFcmToUser } from '@/lib/push';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!ehUuid(id)) throw new HttpError(404, 'Downwind não encontrado.');

    const body = await readJson(request);
    const para = oneOf(body, 'para', ['em_andamento', 'encerrado', 'cancelado'] as const);

    const { status, participacao } = await buscarContexto(id, user.id);

    if (para === 'em_andamento') {
      const veredito = podeIniciarDownwind({ statusDownwind: status, participacao });
      if (!veredito.permitido) throw new HttpError(veredito.status, veredito.mensagem);

      if (veredito.noOp) {
        return { status: 'em_andamento', iniciadoEm: null, encerradoEm: null };
      }

      // `AND status = 'aberto'` resolve no banco a corrida de vários
      // velejadores tocando Iniciar ao mesmo tempo — mesmo padrão do
      // `WHERE used_at IS NULL` dos convites.
      const rows = await sql`
        UPDATE downwinds
        SET status = 'em_andamento', iniciado_em = COALESCE(iniciado_em, NOW())
        WHERE id = ${id} AND status = 'aberto'
        RETURNING iniciado_em
      `;
      if (rows.length === 0) {
        // Corrida perdida: outro velejador iniciou um instante antes. Não é
        // erro do ponto de vista de quem chamou — o resultado desejado
        // (downwind em andamento) já existe.
        return { status: 'em_andamento', iniciadoEm: null, encerradoEm: null };
      }

      // O próprio velejador que iniciou também sai de 'confirmado' para
      // 'navegando' — ele está indo para a água agora.
      if (participacao?.estado === 'confirmado') {
        await sql`
          UPDATE downwind_participantes SET estado = 'navegando'
          WHERE downwind_id = ${id} AND user_id = ${user.id}
        `;
      }

      return {
        status: 'em_andamento',
        iniciadoEm: new Date(String((rows[0] as Record<string, unknown>).iniciado_em)).toISOString(),
        encerradoEm: null,
      };
    }

    if (para === 'cancelado') {
      const veredito = podeCancelarDownwind({
        solicitante: { role: user.role },
        participacao,
        statusDownwind: status,
      });
      if (!veredito.permitido) throw new HttpError(veredito.status, veredito.mensagem);

      const rows = await sql`
        UPDATE downwinds
        SET status = 'cancelado', encerrado_em = COALESCE(encerrado_em, NOW())
        WHERE id = ${id} AND status IN ('aberto', 'em_andamento')
        RETURNING encerrado_em
      `;
      if (rows.length === 0) throw new HttpError(409, 'Este downwind já foi encerrado ou cancelado.');

      // Cancelled: revoga tokens de rastreio
      await revogarTodosTokensDoDownwind(id);

      return {
        status: 'cancelado',
        iniciadoEm: null,
        encerradoEm: new Date(String((rows[0] as Record<string, unknown>).encerrado_em)).toISOString(),
      };
    }

    // para === 'encerrado'
    const participantes = await listarParticipantes(id);
    const veredito = podeEncerrarDownwindComoUsuario({
      solicitante: { role: user.role },
      participacao,
      participantes,
      statusDownwind: status,
    });
    if (!veredito.permitido) throw new HttpError(veredito.status, veredito.mensagem);

    const rows = await sql`
      UPDATE downwinds
      SET status = 'encerrado', encerrado_em = COALESCE(encerrado_em, NOW())
      WHERE id = ${id} AND status = 'em_andamento'
      RETURNING encerrado_em
    `;
    if (rows.length === 0) throw new HttpError(409, 'Este downwind já foi encerrado ou cancelado.');

    await resumirEPurgar(id);

    // Revoga tokens de rastreio: o downwind terminou
    await revogarTodosTokensDoDownwind(id);

    // Notifica os participantes que estavam rastreando via FCM (opcional)
    // O app Android pode usar isso para parar o Foreground Service
    try {
      const participantesIds = await sql`
        SELECT DISTINCT user_id FROM downwind_participantes
        WHERE downwind_id = ${id} AND papel = 'velejador'
      `;
      for (const row of participantesIds) {
        const uid = String((row as Record<string, unknown>).user_id);
        // Fire-and-forget: não esperamos para não atrasar a resposta
        sendFcmToUser(uid, {
          title: 'Downwind encerrado',
          body: 'A travessia foi encerrada. O rastreamento foi parado.',
          tag: 'downwind_encerrado',
        });
      }
    } catch {
      // Não falha o encerramento se push falhar
    }

    return {
      status: 'encerrado',
      iniciadoEm: null,
      encerradoEm: new Date(String((rows[0] as Record<string, unknown>).encerrado_em)).toISOString(),
    };
  });
}
