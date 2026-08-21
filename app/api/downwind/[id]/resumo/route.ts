import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { podeVerResumoDownwind } from '@/lib/downwindAcesso';
import { buscarContexto, ehUuid } from '@/lib/downwindDb';

export const dynamic = 'force-dynamic';

/**
 * Resumo estilo Strava de um downwind — distância, velocidade máxima e
 * trilha reduzida por participante, gravados no encerramento (ver
 * `resumirEPurgar` em app/api/downwind/[id]/status/route.ts).
 *
 * Diferente de GET /posicoes: isto é histórico, não posição ao vivo, então a
 * autorização (lib/downwindAcesso.ts, `podeVerResumoDownwind`) é mais
 * permissiva — quem 'desistiu' também vê, e serve mesmo com o downwind ainda
 * `em_andamento` (resumo parcial de quem já encerrou a própria travessia
 * enquanto o resto do grupo continua na água).
 */
interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, ctx: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!ehUuid(id)) throw new HttpError(404, 'Downwind não encontrado.');

    const { status, participacao } = await buscarContexto(id, user.id);
    const veredito = podeVerResumoDownwind({
      solicitante: { role: user.role },
      statusDownwind: status,
      participacao,
    });
    if (!veredito.permitido) throw new HttpError(veredito.status, veredito.mensagem);

    const header = await sql`
      SELECT d.id, d.nome, d.status, d.previsto_para, d.iniciado_em, d.encerrado_em,
             ss.name AS saida_nome, ss.lat AS saida_lat, ss.lng AS saida_lng,
             sc.name AS chegada_nome, sc.lat AS chegada_lat, sc.lng AS chegada_lng
      FROM downwinds d
      LEFT JOIN spots ss ON ss.id = d.spot_saida
      LEFT JOIN spots sc ON sc.id = d.spot_chegada
      WHERE d.id = ${id}
      LIMIT 1
    `;
    if (header.length === 0) throw new HttpError(404, 'Downwind não encontrado.');
    const h = header[0] as Record<string, unknown>;

    const ponto = (nome: unknown, lat: unknown, lng: unknown) =>
      lat !== null && lat !== undefined && lng !== null && lng !== undefined
        ? { nome: String(nome ?? ''), lat: Number(lat), lng: Number(lng) }
        : null;

    const linhas = await sql`
      SELECT dp.user_id, u.name, u.avatar_url, dp.papel, dp.eh_organizador,
             dp.distancia_km, dp.velocidade_max_nos, dp.trilha_reduzida
      FROM downwind_participantes dp
      JOIN users u ON u.id = dp.user_id
      WHERE dp.downwind_id = ${id}
      ORDER BY dp.distancia_km DESC NULLS LAST, u.name ASC
    `;

    const participantes = linhas.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        userId: String(r.user_id),
        nome: String(r.name),
        avatarUrl: r.avatar_url ? String(r.avatar_url) : null,
        papel: r.papel as 'velejador' | 'apoio_terra',
        ehOrganizador: Boolean(r.eh_organizador),
        distanciaKm: r.distancia_km !== null ? Number(r.distancia_km) : null,
        velocidadeMaxNos: r.velocidade_max_nos !== null ? Number(r.velocidade_max_nos) : null,
        trilhaReduzida: Array.isArray(r.trilha_reduzida) ? r.trilha_reduzida : [],
      };
    });

    return {
      downwind: {
        id: String(h.id),
        nome: String(h.nome),
        status: String(h.status),
        previstoPara: h.previsto_para ? new Date(String(h.previsto_para)).toISOString() : null,
        iniciadoEm: h.iniciado_em ? new Date(String(h.iniciado_em)).toISOString() : null,
        encerradoEm: h.encerrado_em ? new Date(String(h.encerrado_em)).toISOString() : null,
        saida: ponto(h.saida_nome, h.saida_lat, h.saida_lng),
        chegada: ponto(h.chegada_nome, h.chegada_lat, h.chegada_lng),
      },
      participantes,
    };
  });
}
