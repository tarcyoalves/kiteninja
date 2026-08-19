import 'server-only';

import { sql } from './db';
import { boundingBox, JANELA_PRESENCA_MS } from './sos';
import { haversineKm, LatLng } from './geo';

/**
 * Seleciona quem notificar de um SOS.
 *
 * Duas fontes de posição, nesta ordem: (a) a posição real do velejador,
 * quando `pos_updated_at` ainda está dentro da janela de presença — o GPS
 * pode ter se movido desde que ele declarou um spot; (b) na falta de posição
 * fresca, a coordenada do spot que ele marcou em `at_spot_id` ("estou em
 * Ponta do Mel"). Quem não tem nem uma coisa nem outra fica de fora: não dá
 * para saber se está dentro do raio.
 *
 * O corte de janela é calculado em JS e passado como parâmetro (em vez de um
 * INTERVAL literal no SQL) porque a template-tag do Neon parametriza a
 * interpolação: `INTERVAL '${ms} milliseconds'` vira `INTERVAL '$1
 * milliseconds'`, que o Postgres rejeita. Mesmo padrão de
 * `presenceCutoff()` em lib/chat.ts.
 *
 * O pré-filtro por bounding box (sobre a posição já resolvida em (a)/(b))
 * evita calcular Haversine para presenças fora de qualquer chance de estar
 * no raio; o filtro exato por distância roda depois, em JS.
 */
export async function selectSosCandidates(args: {
  excludeUserId: string;
  origin: LatLng;
  radiusKm: number;
  /** Quem já foi notificado antes (ex.: em uma escalada) não entra de novo. */
  alreadyNotified?: Set<string>;
}): Promise<Array<{ userId: string; dist: number }>> {
  const cutoff = new Date(Date.now() - JANELA_PRESENCA_MS).toISOString();
  const box = boundingBox(args.origin.lat, args.origin.lng, args.radiusKm);

  const rows = await sql`
    SELECT user_id, cand_lat, cand_lng FROM (
      SELECT
        p.user_id AS user_id,
        COALESCE(
          CASE WHEN p.pos_updated_at >= ${cutoff} THEN p.lat END,
          s.lat
        ) AS cand_lat,
        COALESCE(
          CASE WHEN p.pos_updated_at >= ${cutoff} THEN p.lng END,
          s.lng
        ) AS cand_lng
      FROM user_presence p
      LEFT JOIN spots s ON s.id = p.at_spot_id
      WHERE p.user_id != ${args.excludeUserId}
        AND p.last_seen_at >= ${cutoff}
    ) candidato
    WHERE cand_lat IS NOT NULL AND cand_lng IS NOT NULL
      AND cand_lat BETWEEN ${box.minLat} AND ${box.maxLat}
      AND cand_lng BETWEEN ${box.minLng} AND ${box.maxLng}
  `;

  const already = args.alreadyNotified ?? new Set<string>();

  return rows
    .map((r) => {
      const row = r as Record<string, unknown>;
      return {
        userId: String(row.user_id),
        dist: haversineKm(args.origin, { lat: Number(row.cand_lat), lng: Number(row.cand_lng) }),
      };
    })
    .filter((c) => c.dist <= args.radiusKm && !already.has(c.userId));
}
