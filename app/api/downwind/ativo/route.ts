import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser } from '@/lib/auth';

/**
 * "Estou dentro de um downwind agora?"
 *
 * É a rota que decide se o app abre no mapa ao vivo ou nas abas normais, então
 * ela é chamada uma vez a cada abertura do app, por todo usuário. Por isso
 * responde só o cabeçalho da travessia — nenhuma posição de ninguém — e usa o
 * índice `idx_downwind_participantes_user`, que existe exatamente para esta
 * busca no sentido pessoa -> downwinds.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const user = await requireUser();

    const rows = await sql`
      SELECT
        d.id, d.nome, d.status, d.previsto_para, d.iniciado_em,
        d.spot_saida, d.spot_chegada,
        ss.name AS saida_nome, ss.lat AS saida_lat, ss.lng AS saida_lng,
        sc.name AS chegada_nome, sc.lat AS chegada_lat, sc.lng AS chegada_lng,
        dp.papel, dp.estado, dp.eh_organizador, dp.apoio_user_id
      FROM downwind_participantes dp
      JOIN downwinds d ON d.id = dp.downwind_id
      LEFT JOIN spots ss ON ss.id = d.spot_saida
      LEFT JOIN spots sc ON sc.id = d.spot_chegada
      WHERE dp.user_id = ${user.id}
        AND d.status IN ('aberto', 'em_andamento')
        AND dp.estado IN ('confirmado', 'navegando')
      ORDER BY d.iniciado_em DESC NULLS LAST, d.previsto_para ASC
      LIMIT 1
    `;

    if (rows.length === 0) return { downwind: null };

    const r = rows[0] as Record<string, unknown>;

    // `spots.lat/lng` são NOT NULL no schema — o único jeito de vir nulo aqui
    // é o downwind não ter `spot_chegada` definido (ainda não decidiram onde
    // termina) ou `spot_saida/chegada` apontar para um spot removido do
    // catálogo (ON DELETE SET NULL). Nesses casos o ponto simplesmente some
    // da resposta, em vez de a UI tentar desenhar um pino sem coordenada.
    const ponto = (nome: unknown, lat: unknown, lng: unknown) =>
      lat !== null && lat !== undefined && lng !== null && lng !== undefined
        ? { nome: String(nome ?? ''), lat: Number(lat), lng: Number(lng) }
        : null;

    return {
      downwind: {
        id: String(r.id),
        nome: String(r.nome),
        status: String(r.status),
        previstoPara: r.previsto_para ? new Date(String(r.previsto_para)).toISOString() : null,
        iniciadoEm: r.iniciado_em ? new Date(String(r.iniciado_em)).toISOString() : null,
        saida: ponto(r.saida_nome, r.saida_lat, r.saida_lng),
        chegada: ponto(r.chegada_nome, r.chegada_lat, r.chegada_lng),
        minhaParticipacao: {
          papel: String(r.papel),
          estado: String(r.estado),
          ehOrganizador: Boolean(r.eh_organizador),
          apoioUserId: r.apoio_user_id ? String(r.apoio_user_id) : null,
        },
      },
    };
  });
}
