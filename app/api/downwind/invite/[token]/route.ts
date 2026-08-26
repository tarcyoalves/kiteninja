import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser, HttpError, hashToken } from '@/lib/auth';
import { ehUuid, buscarParticipacao, buscarStatusDownwind } from '@/lib/downwindDb';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ token: string }>;
}

export async function GET(request: Request, ctx: Params) {
  return handle(async () => {
    const { token } = await ctx.params;
    if (!token || token.length < 10) throw new HttpError(400, 'Token inválido.');

    const tokenH = hashToken(token);
    const rows = await sql`
      SELECT
        dui.id,
        dui.downwind_id,
        dui.role,
        dui.status,
        dui.expires_at,
        d.nome AS downwind_nome,
        d.status AS downwind_status,
        d.spot_saida_id,
        d.spot_chegada_id,
        d.previsto_para,
        d.iniciado_em,
        u.name AS inviter_name,
        (SELECT COUNT(*)::int FROM downwind_participantes WHERE downwind_id = d.id AND estado != 'desistiu') AS total_participantes
      FROM downwind_user_invites dui
      JOIN downwinds d ON d.id = dui.downwind_id
      JOIN users u ON u.id = dui.inviter_id
      WHERE dui.token_hash = ${tokenH}
      LIMIT 1
    `;

    if (rows.length === 0) {
      throw new HttpError(404, 'Convite não encontrado ou inválido.');
    }

    const row = rows[0] as Record<string, unknown>;
    const expiresAt = new Date(String(row.expires_at));
    const expirado = expiresAt.getTime() < Date.now();

    return {
      id: String(row.id),
      downwindId: String(row.downwind_id),
      downwindNome: String(row.downwind_nome),
      downwindStatus: String(row.downwind_status),
      spotSaidaId: row.spot_saida_id ? String(row.spot_saida_id) : null,
      spotChegadaId: row.spot_chegada_id ? String(row.spot_chegada_id) : null,
      previstoPara: row.previsto_para ? String(row.previsto_para) : null,
      iniciadoEm: row.iniciado_em ? String(row.iniciado_em) : null,
      inviterName: String(row.inviter_name),
      role: String(row.role),
      status: expirado ? 'expirado' : String(row.status),
      expiresAt: expiresAt.toISOString(),
      totalParticipantes: Number(row.total_participantes || 0),
    };
  });
}

export async function POST(request: Request, ctx: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { token } = await ctx.params;
    if (!token || token.length < 10) throw new HttpError(400, 'Token inválido.');

    const tokenH = hashToken(token);
    const rows = await sql`
      SELECT
        dui.id,
        dui.downwind_id,
        dui.role,
        dui.status,
        dui.expires_at,
        d.status AS downwind_status
      FROM downwind_user_invites dui
      JOIN downwinds d ON d.id = dui.downwind_id
      WHERE dui.token_hash = ${tokenH}
      LIMIT 1
    `;

    if (rows.length === 0) {
      throw new HttpError(404, 'Convite não encontrado.');
    }

    const row = rows[0] as Record<string, unknown>;
    const inviteId = String(row.id);
    const downwindId = String(row.downwind_id);
    const downwindStatus = String(row.downwind_status);
    const papel = String(row.role);
    const expiresAt = new Date(String(row.expires_at));

    if (expiresAt.getTime() < Date.now()) {
      throw new HttpError(410, 'Este convite expirou.');
    }

    if (downwindStatus === 'encerrado' || downwindStatus === 'cancelado') {
      throw new HttpError(409, 'Este downwind já terminou.');
    }

    const jaParticipa = await buscarParticipacao(downwindId, user.id);
    if (jaParticipa && jaParticipa.estado !== 'desistiu' && jaParticipa.estado !== 'encerrado') {
      return { ok: true, downwindId, message: 'Você já é participante deste downwind.' };
    }

    await sql`
      INSERT INTO downwind_participantes (
        downwind_id, user_id, papel, eh_organizador, estado
      )
      VALUES (
        ${downwindId}, ${user.id}, ${papel}, FALSE, 'confirmado'
      )
      ON CONFLICT (downwind_id, user_id) DO UPDATE SET
        papel = EXCLUDED.papel,
        estado = 'confirmado',
        apoio_user_id = NULL
    `;

    return { ok: true, downwindId };
  });
}