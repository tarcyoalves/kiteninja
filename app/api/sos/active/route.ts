import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { touchPresenceKeepingSpot } from '@/lib/presence';
import { escalarUmSos } from '@/lib/sosEscalada';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    // Consulta ao SOS prova presença e mantém spot atual. Em try/catch porque
    // um SOS ativo NUNCA pode sumir da tela por causa de uma falha ao gravar
    // presença — é o pedido de socorro que importa aqui.
    try {
      await touchPresenceKeepingSpot(user.id);
    } catch (err) {
      console.error('[sos] presença não gravada ao listar ativos', err);
    }

    const alertRows = await sql`
      SELECT DISTINCT sa.id, sa.user_id, sa.lat, sa.lng, sa.spot_id, sa.status, 
             sa.radius_km, sa.created_at, sa.escalated_at, sa.message,
             u.name as author_name
      FROM sos_alerts sa
      JOIN users u ON u.id = sa.user_id
      LEFT JOIN sos_responders sr ON sr.sos_id = sa.id
      -- 'em_atendimento' entra na listagem: um socorrista confirmar "a
      -- caminho" não pode fazer o alerta sumir da tela de ninguém, nem da
      -- do próprio acidentado. Só 'resolvido'/'cancelado'/'falso_alarme'
      -- saem da lista de ativos.
      WHERE sa.status IN ('ativo', 'em_atendimento')
        AND (sa.user_id = ${user.id} OR sr.user_id = ${user.id})
    `;

    const mappedAlerts = [];

    for (const r of alertRows) {
      const row = r as Record<string, unknown>;
      const sosId = String(row.id);
      const sosUserId = String(row.user_id);
      let radiusKm = Number(row.radius_km);
      let escalatedAt = row.escalated_at ? new Date(String(row.escalated_at)) : null;
      const lat = row.lat ? Number(row.lat) : null;
      const lng = row.lng ? Number(row.lng) : null;
      
      const responderRows = await sql`
        SELECT user_id, state, lat, lng, responded_at
        FROM sos_responders
        WHERE sos_id = ${sosId}
      `;
      
      const responders = responderRows.map(rr => ({
        userId: String(rr.user_id),
        state: String(rr.state),
        lat: rr.lat ? Number(rr.lat) : null,
        lng: rr.lng ? Number(rr.lng) : null,
        respondedAt: String(rr.responded_at)
      }));

      const temResponsavel = responders.some(resp => resp.state === 'a_caminho' || resp.state === 'no_local');

      /**
       * Escalada preguiçosa — mantida, mas agora é só UM dos dois gatilhos.
       *
       * O motor real vive em lib/sosEscalada.ts e também roda pelo cron
       * (/api/cron/sos-escalada), porque este caminho aqui tem um limite
       * estrutural: a consulta acima lista apenas os SOS que ESTE usuário pode
       * ver. Um pedido de socorro cujos vizinhos estão todos com o app fechado
       * nunca seria varrido por ninguém — exatamente o caso em que ampliar o
       * raio é vital.
       *
       * As duas vias chamam a mesma função idempotente (o UPDATE é condicionado
       * ao raio lido), então rodar as duas ao mesmo tempo não escala em dobro.
       * Comprovado em scripts/verify-sos.ts, seção 3.
       *
       * Falha na escalada não pode esconder o SOS da tela: em try/catch, mesmo
       * princípio já usado acima para a gravação de presença.
       */
      try {
        const resultado = await escalarUmSos({
          id: sosId,
          userId: sosUserId,
          authorName: String(row.author_name),
          lat,
          lng,
          spotName: null,
          status: String(row.status),
          radiusKm,
          createdAt: new Date(String(row.created_at)),
          escalatedAt,
          temResponsavel,
          jaNotificados: new Set(responders.map(rr => rr.userId)),
        });

        if (resultado) {
          radiusKm = resultado.raioNovo;
          escalatedAt = new Date();
          // Recarrega os socorristas: a escalada acabou de inserir os novos
          // notificados, e a resposta precisa refletir o estado real.
          const atualizados = await sql`
            SELECT user_id, state, lat, lng, responded_at
            FROM sos_responders
            WHERE sos_id = ${sosId}
          `;
          responders.length = 0;
          for (const rr of atualizados) {
            responders.push({
              userId: String(rr.user_id),
              state: String(rr.state),
              lat: rr.lat ? Number(rr.lat) : null,
              lng: rr.lng ? Number(rr.lng) : null,
              respondedAt: rr.responded_at ? String(rr.responded_at) : new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        console.error('[sos] escalada preguiçosa falhou (alerta segue visível)', err);
      }

      // PRIVACY: Posições do acidentado e socorristas são sensíveis, 
      // mostramos apenas para quem foi notificado, o próprio autor ou moderação.
      const isResponder = responders.some(rr => rr.userId === user.id);
      const isAuthor = sosUserId === user.id;
      const isMod = user.role === 'admin' || user.role === 'moderator';
      const canSeePos = isResponder || isAuthor || isMod;

      mappedAlerts.push({
        id: sosId,
        userId: sosUserId,
        authorName: String(row.author_name),
        status: String(row.status),
        radiusKm,
        createdAt: String(row.created_at),
        escalatedAt: escalatedAt ? escalatedAt.toISOString() : null,
        message: row.message ? String(row.message) : null,
        lat: canSeePos ? lat : null,
        lng: canSeePos ? lng : null,
        spotId: row.spot_id ? String(row.spot_id) : null,
        responders: responders.map(rr => ({
          userId: rr.userId,
          state: rr.state,
          lat: canSeePos ? rr.lat : null,
          lng: canSeePos ? rr.lng : null,
          respondedAt: rr.respondedAt
        }))
      });
    }

    return { alerts: mappedAlerts };
  });
}
