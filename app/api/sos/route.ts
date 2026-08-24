import { sql } from '@/lib/db';
import { handle, readOptionalJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { num, str } from '@/lib/validation';
import { rateLimiters } from '@/lib/rateLimit';
import { nearestSpot } from '@/lib/geo';
import { textoDoAlerta } from '@/lib/sos';
import { selectSosCandidates } from '@/lib/sosCandidates';
import { sendPushToUsers } from '@/lib/push';
import { logSos } from '@/lib/sosLog';

export const dynamic = 'force-dynamic';

/** Violação de índice único no Postgres. */
const PG_UNIQUE_VIOLATION = '23505';

function ehViolacaoDeUnicidade(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === PG_UNIQUE_VIOLATION || String(code) === PG_UNIQUE_VIOLATION;
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    rateLimiters.sos(user.id);

    const body = await readOptionalJson(request);

    // Faixa validada (item 7 da revisão): sem min/max, `lat: 999` era aceito e
    // gravado, e o socorro seria mandado para um ponto inexistente. Coordenada
    // inválida é erro do cliente (400), não dado a persistir.
    const lat = num(body, 'lat', { optional: true, min: -90, max: 90 });
    const lng = num(body, 'lng', { optional: true, min: -180, max: 180 });
    const accuracyM = num(body, 'accuracyM', { optional: true, min: 0, max: 100000 });
    const message = str(body, 'message', { optional: true, max: 1000 });

    /**
     * Reaproveita o SOS aberto do próprio usuário, se houver.
     *
     * Antes a busca era `status = 'ativo' AND created_at > NOW() - 5min`, o que
     * deixava dois furos agora que existe `uniq_sos_aberto_por_usuario`:
     *   - SOS 'em_atendimento' não era encontrado;
     *   - SOS ativo com mais de 5 min não era encontrado.
     * Nos dois casos o INSERT abaixo bateria na constraint e o velejador
     * receberia 500 no momento em que mais precisa. A janela de tempo sai: se
     * o SOS está aberto, é o mesmo socorro, independente de quando começou.
     */
    const aberto = await sql`
      SELECT id, lat, lng, spot_id, radius_km, status
      FROM sos_alerts
      WHERE user_id = ${user.id} AND status IN ('ativo', 'em_atendimento')
      ORDER BY created_at DESC LIMIT 1
    `;

    if (aberto.length > 0) {
      const row = aberto[0] as Record<string, unknown>;
      const updateLat = lat ?? (row.lat === null ? null : Number(row.lat));
      const updateLng = lng ?? (row.lng === null ? null : Number(row.lng));
      // Apertar SOS de novo é o velejador atualizando a própria posição.
      await sql`
        UPDATE sos_alerts
        SET lat = ${updateLat},
            lng = ${updateLng},
            accuracy_m = COALESCE(${accuracyM ?? null}, accuracy_m),
            updated_at = NOW()
        WHERE id = ${row.id} AND user_id = ${user.id}
      `;
      logSos({
        etapa: 'criado.duplicata_evitada',
        sosId: String(row.id),
        userId: user.id,
        detalhe: { status: String(row.status), posicaoAtualizada: lat !== null && lng !== null },
      });
      return {
        sos: {
          id: String(row.id),
          lat: updateLat,
          lng: updateLng,
          spotId: row.spot_id ? String(row.spot_id) : null,
          radiusKm: Number(row.radius_km),
          reaproveitado: true,
        },
        notificados: 0,
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

    let inserted;
    try {
      inserted = await sql`
        INSERT INTO sos_alerts (user_id, lat, lng, accuracy_m, message, spot_id, status, radius_km)
        VALUES (${user.id}, ${lat ?? null}, ${lng ?? null}, ${accuracyM ?? null}, ${message || null}, ${spotId ?? null}, 'ativo', 5)
        RETURNING id, radius_km
      `;
    } catch (err) {
      // Corrida real: outro pedido do mesmo usuário inseriu entre o SELECT
      // acima e este INSERT. A constraint é a fonte da verdade; aqui só
      // traduzimos para o SOS que venceu, em vez de devolver erro a quem está
      // pedindo socorro.
      if (!ehViolacaoDeUnicidade(err)) throw err;

      const vencedor = await sql`
        SELECT id, lat, lng, spot_id, radius_km
        FROM sos_alerts
        WHERE user_id = ${user.id} AND status IN ('ativo', 'em_atendimento')
        ORDER BY created_at DESC LIMIT 1
      `;
      if (vencedor.length === 0) throw err;
      const row = vencedor[0] as Record<string, unknown>;
      logSos({
        etapa: 'criado.duplicata_evitada',
        sosId: String(row.id),
        userId: user.id,
        detalhe: { viaConstraint: true },
      });
      return {
        sos: {
          id: String(row.id),
          lat: row.lat === null ? null : Number(row.lat),
          lng: row.lng === null ? null : Number(row.lng),
          spotId: row.spot_id ? String(row.spot_id) : null,
          radiusKm: Number(row.radius_km),
          reaproveitado: true,
        },
        notificados: 0,
      };
    }

    const row = inserted[0] as Record<string, unknown>;
    const sosId = String(row.id);
    const radiusKm = Number(row.radius_km);

    logSos({
      etapa: lat === null || lng === null ? 'criado.sem_gps' : 'criado',
      sosId,
      userId: user.id,
      // Precisão sim, coordenada não — ver lib/sosLog.ts.
      detalhe: { precisaoM: accuracyM, spot: spotId, raioKm: radiusKm },
    });

    /**
     * Quem é avisado: quem está perto com o app, MAIS o grupo do downwind em
     * andamento (independente de distância) — ver lib/sosCandidates.ts.
     *
     * A chamada acontece mesmo SEM coordenada. Antes ela estava dentro de um
     * `if (lat !== null && lng !== null)`, então um SOS sem GPS (celular
     * molhado, permissão negada, 3s de timeout) era gravado e **ninguém era
     * notificado** — falha silenciosa no caminho de vida. O seletor lida com
     * `origin: null` avisando o grupo do downwind, que não depende de
     * coordenada nenhuma.
     */
    const candidatos = await selectSosCandidates({
      excludeUserId: user.id,
      origin: lat !== null && lng !== null ? { lat, lng } : null,
      radiusKm,
    });

    logSos({
      etapa: 'candidatos',
      sosId,
      userId: user.id,
      detalhe: {
        total: candidatos.length,
        raioKm: radiusKm,
        porProximidade: candidatos.filter(c => c.motivo === 'proximidade').length,
        porDownwind: candidatos.filter(c => c.motivo !== 'proximidade').length,
        temGps: lat !== null && lng !== null,
      },
    });

    // Um único INSERT com todos os candidatos, em vez de um por candidato.
    // Com 50 vizinhos eram 50 round-trips à Neon dentro do caminho crítico do
    // socorro — o suficiente para estourar o tempo da função serverless e o
    // velejador não receber resposta. ON CONFLICT porque (sos_id, user_id) é PK
    // composta e uma duplicata abortaria o lote inteiro.
    if (candidatos.length > 0) {
      const ids = candidatos.map(c => c.userId);
      const dists = candidatos.map(c => c.dist);
      const motivos = candidatos.map(c => c.motivo);
      await sql`
        INSERT INTO sos_responders (sos_id, user_id, state, distance_km, motivo)
        SELECT ${sosId}, u.id, 'notificado', d.dist, d.motivo
        FROM UNNEST(${ids}::uuid[], ${dists}::numeric[], ${motivos}::text[]) AS d(uid, dist, motivo)
        JOIN users u ON u.id = d.uid
        ON CONFLICT (sos_id, user_id) DO NOTHING
      `;
    }

    await sql`
      INSERT INTO audit_logs (actor_id, action, target_type, target_id)
      VALUES (${user.id}, 'sos.created', 'sos_alert', ${sosId})
    `;

    // Push em paralelo, não em fila. Sequencial, 50 notificações somavam 50
    // latências de rede antes de responder ao velejador. `allSettled` porque
    // uma falha de push jamais pode derrubar o SOS já gravado.
    const envios = await Promise.allSettled(
      candidatos.map(c => {
        const txt = textoDoAlerta({
          nome: user.name,
          distanciaKm: c.dist,
          spotNome: spotName,
          temCoordenada: lat !== null && lng !== null,
          motivo: c.motivo,
        });
        return sendPushToUsers([c.userId], {
          title: txt.titulo,
          body: txt.corpo,
          requireInteraction: true,
          url: `/?tab=mapa&sos=${sosId}`,
        });
      })
    );

    const falhas = envios.filter(e => e.status === 'rejected').length;
    logSos({
      etapa: falhas > 0 ? 'push.falhou' : 'push.enviado',
      sosId,
      userId: user.id,
      detalhe: { tentados: envios.length, falhas },
    });

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
