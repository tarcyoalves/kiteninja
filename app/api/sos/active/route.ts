import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { touchPresenceKeepingSpot } from '@/lib/presence';
import { deveEscalar, proximoRaio, textoDoAlerta } from '@/lib/sos';
import { selectSosCandidates } from '@/lib/sosCandidates';
import { sendPushToUsers } from '@/lib/push';

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

      // Escalada preguiçosa — a Vercel não tem processo em background e o cron do plano gratuito não existe. 
      // Como quem está online consulta a cada poucos segundos, a escalada acontece naturalmente pela consulta de qualquer usuário online.
      if (deveEscalar({
        raioKm: radiusKm,
        criadoEm: new Date(String(row.created_at)),
        escaladoEm: escalatedAt,
        agora: new Date(),
        temResponsavel,
        // 'em_atendimento' nunca escala, mesmo se o responsável recuar depois
        // (ver comentário em lib/sos.ts).
        statusAtual: String(row.status) as 'ativo' | 'em_atendimento'
      })) {
        const nextRadius = proximoRaio(radiusKm);
        if (nextRadius !== null) {
          await sql`
            UPDATE sos_alerts
            SET radius_km = ${nextRadius}, escalated_at = NOW()
            WHERE id = ${sosId}
          `;
          radiusKm = nextRadius;
          escalatedAt = new Date();

          if (lat !== null && lng !== null) {
            const existingResponders = new Set(responders.map(rr => rr.userId));

            // Mesma seleção de candidatos do disparo inicial (posição real
            // ou fallback pelo spot) — ver lib/sosCandidates.ts.
            const newCandidatos = await selectSosCandidates({
              excludeUserId: sosUserId,
              origin: { lat, lng },
              radiusKm,
              alreadyNotified: existingResponders,
            });

            for (const c of newCandidatos) {
              await sql`
                INSERT INTO sos_responders (sos_id, user_id, state)
                VALUES (${sosId}, ${c.userId}, 'notificado')
              `;
              responders.push({
                userId: c.userId,
                state: 'notificado',
                lat: null,
                lng: null,
                respondedAt: new Date().toISOString()
              });

              try {
                const txt = textoDoAlerta({
                  nome: String(row.author_name),
                  distanciaKm: c.dist,
                  spotNome: null,
                  temCoordenada: true
                });
                await sendPushToUsers([c.userId], {
                  title: txt.titulo,
                  body: txt.corpo,
                  requireInteraction: true,
                  url: `/?tab=mapa&sos=${sosId}`,
                });
              } catch (err) {
                console.error('[sos] Push falhou na escalada', err);
              }
            }
          }
        }
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
