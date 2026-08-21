import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { oneOf } from '@/lib/validation';
import { haversineKm } from '@/lib/geo';
import {
  podeCancelarDownwind,
  podeEncerrarDownwindComoUsuario,
  podeIniciarDownwind,
} from '@/lib/downwindAcesso';
import { buscarContexto, ehUuid, listarParticipantes } from '@/lib/downwindDb';
import { amostrarTrilha } from '@/lib/trilhaDownwind';
import type { PontoTrilha } from '@/lib/trilhaDownwind';

export const dynamic = 'force-dynamic';

/** Pontos do resumo gravado no encerramento — ver lib/schema.sql. */
const LIMITE_TRILHA_RESUMO = 200;

/**
 * Grava distancia_km/velocidade_max_nos/trilha_reduzida de quem ainda não tem
 * resumo, a partir dos pontos brutos, e então apaga a trilha bruta de
 * downwinds antigos.
 *
 * TUDO EM try/catch: falha aqui nunca pode impedir o encerramento de um
 * downwind — mesmo raciocínio do touchPresence em app/api/sos/active/route.ts.
 * Um downwind que não conseguiu encerrar por causa de uma limpeza de trilha é
 * pior que uma limpeza que não rodou desta vez.
 */
async function resumirEPurgar(downwindId: string) {
  try {
    const participantes = await sql`
      SELECT user_id FROM downwind_participantes
      WHERE downwind_id = ${downwindId} AND distancia_km IS NULL
    `;

    for (const row of participantes) {
      const userId = String((row as Record<string, unknown>).user_id);
      const pontos = await sql`
        SELECT lat, lng, registrado_em FROM downwind_posicoes
        WHERE downwind_id = ${downwindId} AND user_id = ${userId}
        ORDER BY registrado_em ASC
      `;
      if (pontos.length === 0) continue;

      let distanciaKm = 0;
      let velocidadeMaxNos = 0;
      const brutos: PontoTrilha[] = pontos.map((p) => {
        const r = p as Record<string, unknown>;
        return [Number(r.lat), Number(r.lng), Date.parse(String(r.registrado_em))] as PontoTrilha;
      });

      for (let i = 1; i < brutos.length; i++) {
        const [latA, lngA, tsA] = brutos[i - 1];
        const [latB, lngB, tsB] = brutos[i];
        const dKm = haversineKm({ lat: latA, lng: lngA }, { lat: latB, lng: lngB });
        distanciaKm += dKm;
        const dHoras = (tsB - tsA) / 3_600_000;
        if (dHoras > 0) {
          const nos = (dKm / 1.852) / dHoras;
          // Teto físico de plausibilidade (mesmo usado em trilhaSessao):
          // salto de GPS não vira "recorde de velocidade" no resumo.
          if (nos <= 90) velocidadeMaxNos = Math.max(velocidadeMaxNos, nos);
        }
      }

      const reduzida = amostrarTrilha(brutos, LIMITE_TRILHA_RESUMO);

      await sql`
        UPDATE downwind_participantes
        SET distancia_km = ${Number(distanciaKm.toFixed(2))},
            velocidade_max_nos = ${Number(velocidadeMaxNos.toFixed(2))},
            trilha_reduzida = ${JSON.stringify(reduzida)}::jsonb
        WHERE downwind_id = ${downwindId} AND user_id = ${userId}
      `;
    }
  } catch (err) {
    console.error('[downwind] falha ao gravar resumo da travessia', err);
  }

  try {
    // Sem cron no plano gratuito da Vercel: a limpeza é preguiçosa, disparada
    // por quem encerra um downwind — mesmo padrão da escalada de raio do SOS
    // (app/api/sos/active/route.ts).
    await sql`
      DELETE FROM downwind_posicoes p USING downwinds d
       WHERE d.id = p.downwind_id
         AND d.status IN ('encerrado', 'cancelado')
         AND d.encerrado_em < NOW() - INTERVAL '7 days'
    `;
  } catch (err) {
    console.error('[downwind] falha na purga preguiçosa de trilha', err);
  }
}

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

    return {
      status: 'encerrado',
      iniciadoEm: null,
      encerradoEm: new Date(String((rows[0] as Record<string, unknown>).encerrado_em)).toISOString(),
    };
  });
}
