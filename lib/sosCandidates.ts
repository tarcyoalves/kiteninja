import 'server-only';

import { sql } from './db';
import { boundingBox, JANELA_PRESENCA_MS } from './sos';
import { haversineKm, LatLng } from './geo';

/**
 * De onde veio o aviso — serve para a UI e o push explicarem ao socorrista
 * POR QUE ele foi chamado, o que muda a decisão dele:
 *
 *  - 'proximidade': está perto agora (posição fresca ou spot declarado);
 *  - 'downwind': navega no mesmo downwind em andamento. Pode estar a 30 km,
 *    fora de qualquer raio, e ainda assim ser o socorro mais rápido — está na
 *    água, na mesma rota, com o mesmo vento;
 *  - 'downwind_apoio': é o apoio em terra do downwind. Não navega, mas tem
 *    carro, telefone e sabe exatamente onde o grupo entrou na água. Em resgate
 *    real, quem está em terra costuma ser quem consegue acionar autoridade.
 */
export type MotivoNotificacao = 'proximidade' | 'downwind' | 'downwind_apoio';

export interface CandidatoSos {
  userId: string;
  /** null quando não há como medir (sem GPS do pedinte, ou sem posição do candidato). */
  dist: number | null;
  motivo: MotivoNotificacao;
}

/**
 * Seleciona quem notificar de um SOS.
 *
 * DUAS FONTES INDEPENDENTES, unidas sem duplicar ninguém:
 *
 * 1. QUEM ESTÁ PERTO COM O APP (`candidatosPorProximidade`)
 *    Duas fontes de posição, nesta ordem: (a) a posição real do velejador,
 *    quando `pos_updated_at` ainda está dentro da janela de presença — o GPS
 *    pode ter se movido desde que ele declarou um spot; (b) na falta de
 *    posição fresca, a coordenada do spot que ele marcou em `at_spot_id`
 *    ("estou em Ponta do Mel"). Quem não tem nem uma coisa nem outra fica de
 *    fora: não dá para saber se está dentro do raio.
 *
 * 2. QUEM ESTÁ NO MESMO DOWNWIND (`candidatosPorDownwind`)
 *    Companheiros de uma remada em andamento, INDEPENDENTE de distância e
 *    INDEPENDENTE de presença recente no app. Isso é deliberado e é a diferença
 *    entre os dois grupos: num downwind o grupo se espalha por dezenas de km ao
 *    longo da costa, então exigir proximidade excluiria exatamente as pessoas
 *    que combinaram de navegar juntas e que sabem que você está na água.
 *
 * Por que a união importa: o filtro por raio depende de GPS do pedinte. Se o
 * `getCurrentPosition` falhar (celular molhado, permissão negada, 3s de
 * timeout), a fonte 1 devolve zero e o SOS morria em silêncio — gravado no
 * banco, sem ninguém avisado. A fonte 2 não depende de coordenada nenhuma:
 * ainda avisa o grupo do downwind. Ver `scripts/verify-sos.ts`.
 *
 * Quando alguém se qualifica pelos dois caminhos, 'downwind' vence: é a
 * informação mais forte para quem recebe ("é do seu grupo") e evita dois
 * pushes para a mesma pessoa.
 *
 * O corte de janela é calculado em JS e passado como parâmetro (em vez de um
 * INTERVAL literal no SQL) porque a template-tag do Neon parametriza a
 * interpolação: `INTERVAL '${ms} milliseconds'` vira `INTERVAL '$1
 * milliseconds'`, que o Postgres rejeita. Mesmo padrão de
 * `presenceCutoff()` em lib/chat.ts.
 */
export async function selectSosCandidates(args: {
  excludeUserId: string;
  /** null quando o SOS saiu sem GPS — só a fonte de downwind roda. */
  origin: LatLng | null;
  radiusKm: number;
  /** Quem já foi notificado antes (ex.: em uma escalada) não entra de novo. */
  alreadyNotified?: Set<string>;
}): Promise<CandidatoSos[]> {
  const already = args.alreadyNotified ?? new Set<string>();

  const [porDownwind, porProximidade] = await Promise.all([
    candidatosPorDownwind(args.excludeUserId, args.origin),
    args.origin
      ? candidatosPorProximidade(args.excludeUserId, args.origin, args.radiusKm)
      : Promise.resolve([] as CandidatoSos[]),
  ]);

  // Downwind primeiro: em empate, o motivo mais informativo permanece.
  const porUsuario = new Map<string, CandidatoSos>();
  for (const c of [...porDownwind, ...porProximidade]) {
    if (already.has(c.userId)) continue;
    if (!porUsuario.has(c.userId)) porUsuario.set(c.userId, c);
  }

  return [...porUsuario.values()];
}

/** Quem está fisicamente perto agora, com presença recente no app. */
async function candidatosPorProximidade(
  excludeUserId: string,
  origin: LatLng,
  radiusKm: number
): Promise<CandidatoSos[]> {
  const cutoff = new Date(Date.now() - JANELA_PRESENCA_MS).toISOString();
  const box = boundingBox(origin.lat, origin.lng, radiusKm);

  // O pré-filtro por bounding box (sobre a posição já resolvida) evita calcular
  // Haversine para presenças fora de qualquer chance de estar no raio; o filtro
  // exato por distância roda depois, em JS.
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
      WHERE p.user_id != ${excludeUserId}
        AND p.last_seen_at >= ${cutoff}
    ) candidato
    WHERE cand_lat IS NOT NULL AND cand_lng IS NOT NULL
      AND cand_lat BETWEEN ${box.minLat} AND ${box.maxLat}
      AND cand_lng BETWEEN ${box.minLng} AND ${box.maxLng}
  `;

  return rows
    .map((r) => {
      const row = r as Record<string, unknown>;
      return {
        userId: String(row.user_id),
        dist: haversineKm(origin, { lat: Number(row.cand_lat), lng: Number(row.cand_lng) }),
        motivo: 'proximidade' as const,
      };
    })
    .filter((c) => c.dist !== null && c.dist <= radiusKm);
}

/**
 * Companheiros de downwind em andamento — sem filtro de distância nem de
 * presença.
 *
 * Só `status = 'em_andamento'`: um downwind 'aberto' é plano futuro (ninguém
 * está na água ainda) e 'encerrado'/'cancelado' é passado. Notificar gente de
 * um downwind que não está acontecendo seria ruído, e ruído em canal de
 * emergência treina as pessoas a ignorar o alerta.
 *
 * Estado do participante: 'confirmado' e 'navegando' entram. Quem já marcou
 * 'encerrado' ou 'desistiu' saiu da água e fica de fora — exceto o
 * `apoio_terra`, que nunca navega e por isso permanece elegível enquanto o
 * downwind estiver em andamento.
 *
 * A distância é calculada quando dá: se o pedinte tem GPS e o companheiro tem
 * posição recente na trilha do downwind, o socorrista vê "a 12 km". Quando não
 * dá, `dist` é null e a UI mostra "no seu downwind" — sem inventar número, que
 * em resgate é pior que não ter número.
 */
async function candidatosPorDownwind(
  excludeUserId: string,
  origin: LatLng | null
): Promise<CandidatoSos[]> {
  const cutoff = new Date(Date.now() - JANELA_PRESENCA_MS).toISOString();

  const rows = await sql`
    SELECT DISTINCT ON (p.user_id)
           p.user_id AS user_id,
           p.papel   AS papel,
           pos.lat   AS pos_lat,
           pos.lng   AS pos_lng
    FROM downwind_participantes eu
    JOIN downwinds d
      ON d.id = eu.downwind_id
     AND d.status = 'em_andamento'
    JOIN downwind_participantes p
      ON p.downwind_id = eu.downwind_id
     AND p.user_id != ${excludeUserId}
     AND (p.papel = 'apoio_terra' OR p.estado IN ('confirmado', 'navegando'))
    LEFT JOIN LATERAL (
      SELECT dp.lat, dp.lng
      FROM downwind_posicoes dp
      WHERE dp.downwind_id = p.downwind_id
        AND dp.user_id = p.user_id
        AND dp.registrado_em >= ${cutoff}
      ORDER BY dp.registrado_em DESC
      LIMIT 1
    ) pos ON TRUE
    WHERE eu.user_id = ${excludeUserId}
      AND (eu.papel = 'apoio_terra' OR eu.estado IN ('confirmado', 'navegando'))
  `;

  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    const temPos = row.pos_lat !== null && row.pos_lat !== undefined;
    return {
      userId: String(row.user_id),
      dist:
        origin && temPos
          ? haversineKm(origin, { lat: Number(row.pos_lat), lng: Number(row.pos_lng) })
          : null,
      motivo: String(row.papel) === 'apoio_terra'
        ? ('downwind_apoio' as const)
        : ('downwind' as const),
    };
  });
}
