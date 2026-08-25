import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { ehUuid } from '@/lib/downwindDb';
import { criarTokenRastreio } from '@/lib/trackingToken';

/**
 * Emite um token de rastreio para o Foreground Service Android.
 *
 * O token é gerado quando o velejador inicia o downwind em primeiro plano.
 * O token é então entregue ao app Android via FCM, e o serviço nativo o usa
 * para autenticar chamadas de POST /api/downwind/{id}/posicoes mesmo com o app fechado.
 *
 * O token:
 * - É válido apenas para ESTE downwind (escopo restrito)
 * - Expira em no máximo 24h
 * - Pode ser revogado quando o downwind termina
 * - Não dá acesso à conta (apenas reporta posições)
 */
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Emite um novo token de rastreio para este downwind.
 *
 * POST /api/downwind/{id}/tracking-token
 */
export async function POST(request: Request, ctx: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!ehUuid(id)) throw new HttpError(404, 'Downwind não encontrado.');

    // Verifica se o downwind existe e está em andamento
    const downwinds = await sql`
      SELECT d.status, dp.papel, dp.estado
      FROM downwinds d
      JOIN downwind_participantes dp ON dp.downwind_id = d.id AND dp.user_id = ${user.id}
      WHERE d.id = ${id}
      LIMIT 1
    `;

    if (downwinds.length === 0) {
      throw new HttpError(404, 'Downwind não encontrado.');
    }

    const row = downwinds[0] as Record<string, unknown>;
    const status = String(row.status);
    const papel = String(row.papel);
    const estado = String(row.estado);

    // Só emite token para downwind em andamento
    if (status !== 'em_andamento') {
      throw new HttpError(409, 'O downwind não está em andamento.');
    }

    // Só emite token para velejador (não apoio em terra)
    if (papel !== 'velejador') {
      throw new HttpError(403, 'Apenas velejadores podem emitir token de rastreio.');
    }

    // O participante precisa estar em estado que permite rastreamento
    if (estado !== 'navegando' && estado !== 'confirmado') {
      throw new HttpError(409, 'Você não está em condições de rastrear neste momento.');
    }

    // Gera o token
    const token = await criarTokenRastreio(id, user.id);

    return {
      token,
      // O token expira em 24h (ou quando o downwind encerrar, o que vier primeiro)
      expiresIn: 24 * 60 * 60, // segundos
    };
  });
}
