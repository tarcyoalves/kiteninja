import { sql } from '@/lib/db';
import { handle, readOptionalJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { num, str } from '@/lib/validation';
import { rateLimiters } from '@/lib/rateLimit';
import { nearestSpot } from '@/lib/geo';
import { textoDoAlerta } from '@/lib/sos';
import { selectSosCandidates } from '@/lib/sosCandidates';
import { sendPushToUsers } from '@/lib/push';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    rateLimiters.sos(user.id);

    const body = await readOptionalJson(request);
    const lat = num(body, 'lat', { optional: true });
    const lng = num(body, 'lng', { optional: true });
    const accuracyM = num(body, 'accuracyM', { optional: true });
    const message = str(body, 'message', { optional: true, max: 1000 });

    const existing = await sql`
      SELECT id, lat, lng, spot_id
      FROM sos_alerts
      WHERE user_id = ${user.id} AND status = 'ativo'
      AND created_at > NOW() - INTERVAL '5 minutes'
      ORDER BY created_at DESC LIMIT 1
    `;

    if (existing.length > 0) {
      const row = existing[0] as Record<string, unknown>;
      const updateLat = lat ?? (row.lat ? Number(row.lat) : null);
      const updateLng = lng ?? (row.lng ? Number(row.lng) : null);
      await sql`
        UPDATE sos_alerts
        SET lat = ${updateLat}, lng = ${updateLng}, accuracy_m = COALESCE(${accuracyM ?? null}, accuracy_m)
        WHERE id = ${row.id} AND user_id = ${user.id}
      `;
      return {
        sos: {
          id: String(row.id),
          lat: updateLat,
          lng: updateLng,
          spotId: row.spot_id ? String(row.spot_id) : null
        },
        notificados: 0
      };
    }

    let spotId: string | null = null;
    let spotName: string | null = null;
    if (lat !== null && lng !== null) {
      const spotsRows = await sql`SELECT id, lat, lng, name FROM spots`;
      const spots = spotsRows.map(r => ({
        id: String(r.id),
        lat: Number(r.lat),
        lng: Number(r.lng),
        name: String(r.name)
      }));
      const nearest = nearestSpot(lat, lng, spots);
      if (nearest) {
        spotId = nearest.spot.id;
        spotName = nearest.spot.name;
      }
    }

    const inserted = await sql`
      INSERT INTO sos_alerts (user_id, lat, lng, accuracy_m, message, spot_id, status, radius_km)
      VALUES (${user.id}, ${lat ?? null}, ${lng ?? null}, ${accuracyM ?? null}, ${message || null}, ${spotId ?? null}, 'ativo', 5)
      RETURNING id, radius_km
    `;
    const row = inserted[0] as Record<string, unknown>;
    const sosId = String(row.id);
    const radiusKm = Number(row.radius_km);

    let candidatos: Array<{ userId: string; dist: number }> = [];
    if (lat !== null && lng !== null) {
      // Considera tanto quem tem posição real recente quanto quem só
      // declarou um spot ("estou em Ponta do Mel") — ver lib/sosCandidates.ts.
      candidatos = await selectSosCandidates({
        excludeUserId: user.id,
        origin: { lat, lng },
        radiusKm,
      });
    }

    for (const c of candidatos) {
      await sql`
        INSERT INTO sos_responders (sos_id, user_id, state)
        VALUES (${sosId}, ${c.userId}, 'notificado')
      `;
    }

    await sql`
      INSERT INTO audit_logs (actor_id, action, target_type, target_id)
      VALUES (${user.id}, 'sos.created', 'sos_alert', ${sosId})
    `;

    // O envio de push nunca pode falhar e interromper a gravação do SOS
    for (const c of candidatos) {
      try {
        const txt = textoDoAlerta({
          nome: user.name,
          distanciaKm: c.dist,
          spotNome: spotName,
          temCoordenada: true
        });
        await sendPushToUsers([c.userId], {
          title: txt.titulo,
          body: txt.corpo,
          requireInteraction: true,
          url: `/?tab=mapa&sos=${sosId}`,
        });
      } catch (err) {
        console.error('[sos] Falha silenciosa no push', err);
      }
    }

    return {
      sos: {
        id: sosId,
        lat: lat,
        lng: lng,
        spotId: spotId,
        radiusKm: radiusKm,
        message: message || null
      },
      notificados: candidatos.length
    };
  });
}
