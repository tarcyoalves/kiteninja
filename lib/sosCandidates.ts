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
 *  - 'moderador': é moderador/admin do sistema. Sempre notificado quando não
 *    há ninguém por proximidade nem downwind — é o fallback de último recurso.
 *  - 'spot_fallback': está no mesmo spot ou estado do autor do SOS. Fallback
 *    quando não há moderadores online.
 */
export type MotivoNotificacao = 'proximidade' | 'downwind' | 'downwind_apoio' | 'moderador' | 'spot_fallback';

export interface CandidatoSos {
  userId: string;
  /** null quando não há como medir (sem GPS do pedinte, ou sem posição do candidato). */
  dist: number | null;
  motivo: MotivoNotificacao;
}

/**
 * Junta as camadas de candidatos numa lista única, sem repetir ninguém.
 *
 * A ORDEM DAS CAMADAS É A PRIORIDADE: quem aparece numa camada anterior fica
 * com o motivo dela. Isso importa porque o motivo é o que o socorrista lê no
 * push — "é do seu downwind" faz ele largar o que está fazendo, "alguém no
 * seu spot" não. Quem se qualifica pelos dois caminhos recebe UM push, com a
 * informação mais forte.
 *
 * `jaNotificados` é a memória da escalada: quem já foi chamado no raio de
 * 5 km não é chamado de novo aos 15 km.
 *
 * Está separada das consultas de propósito — é a única parte desta decisão
 * que dá para testar sem banco, e é onde um engano (ordem trocada, dedupe
 * pelo lado errado) manda o push errado para a pessoa errada.
 */
export function mesclarCamadas(
  camadas: CandidatoSos[][],
  jaNotificados: Set<string> = new Set()
): CandidatoSos[] {
  const porUsuario = new Map<string, CandidatoSos>();
  for (const camada of camadas) {
    for (const c of camada) {
      if (jaNotificados.has(c.userId)) continue;
      if (!porUsuario.has(c.userId)) porUsuario.set(c.userId, c);
    }
  }
  return [...porUsuario.values()];
}

/**
 * Teto de quem é chamado nas camadas amplas (mesmo spot, mesmo estado).
 *
 * Existe porque essas camadas não têm filtro geográfico nenhum: num estado
 * com o app popular, "todo mundo do RN" pode ser centenas de pushes de uma
 * vez, e o INSERT em `sos_responders` mais o fan-out de push entram no
 * caminho crítico do socorro — o tempo da função serverless é finito, e
 * estourá-lo faria o velejador não receber resposta nenhuma.
 */
const MAX_CANDIDATOS_AMPLOS = 200;

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
  /** ID do spot do autor (para fallback). */
  spotId?: string | null;
}): Promise<CandidatoSos[]> {
  const already = args.alreadyNotified ?? new Set<string>();

  const [porDownwind, porProximidade] = await Promise.all([
    candidatosPorDownwind(args.excludeUserId, args.origin),
    args.origin
      ? candidatosPorProximidade(args.excludeUserId, args.origin, args.radiusKm)
      : Promise.resolve([] as CandidatoSos[]),
  ]);

  // Downwind primeiro: em empate, o motivo mais informativo permanece.
  const principais = mesclarCamadas([porDownwind, porProximidade], already);
  if (principais.length > 0) return principais;

  // NINGUÉM pelas fontes normais. É o cenário do ANT-001: SOS sem GPS, fora de
  // downwind. A partir daqui a pergunta deixa de ser "quem pode chegar rápido"
  // e passa a ser "quem existe para ser avisado" — um push para alguém longe é
  // infinitamente melhor que zero pushes.
  const [moderadoresOnline, noSpot] = await Promise.all([
    candidatosModeradores(args.excludeUserId, true),
    candidatosNoSpot(args.excludeUserId, args.spotId ?? null),
  ]);

  const fallback = mesclarCamadas([moderadoresOnline, noSpot], already);
  if (fallback.length > 0) return fallback;

  /**
   * ÚLTIMO RECURSO — as duas camadas que fecham o buraco do ANT-001.
   *
   * Antes daqui, um SOS sem GPS, fora de downwind, sem spot declarado e sem
   * moderador que tivesse aberto o app recentemente notificava ZERO pessoas.
   * O alerta era gravado, a tela dizia "SOS Enviado" e a escalada de
   * 5 → 15 → 50 km ampliava o raio no banco indefinidamente sem chamar
   * ninguém. Falha silenciosa, no caminho de vida.
   *
   * As duas camadas abaixo derrubam justamente os filtros que causavam isso:
   *
   *  - Moderadores SEM exigir presença recente. O filtro de presença faz
   *    sentido para "quem está por perto e pode ajudar agora"; não faz nenhum
   *    para o último recurso. O push chega no celular com o app fechado — é
   *    exatamente para isso que ele serve.
   *  - Quem está no mesmo ESTADO do velejador, derivado do spot do SOS ou,
   *    na falta dele, do spot de origem do perfil. Esta camada existia no
   *    código mas era inalcançável: quem chamava sempre passava `estado: null`.
   */
  const [moderadoresOffline, noEstado] = await Promise.all([
    candidatosModeradores(args.excludeUserId, false),
    candidatosNoEstadoDoAutor(args.excludeUserId, args.spotId ?? null),
  ]);

  return mesclarCamadas([moderadoresOffline, noEstado], already);
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

/**
 * Moderadores do sistema — chamados quando não há ninguém por proximidade,
 * downwind ou apoio.
 *
 * `exigirPresenca` separa dois usos que pareciam um só:
 *
 *  - `true`: moderadores que abriram o app dentro da janela de presença. É a
 *    primeira tentativa — gente com o app na mão responde mais rápido.
 *  - `false`: TODOS os moderadores ativos, tenham ou não aberto o app. É o
 *    último recurso, e o filtro de presença aqui era ativamente nocivo: numa
 *    base pequena, "nenhum moderador com o app aberto agora" é o caso comum,
 *    e ele transformava o último recurso em lista vazia. O push chega no
 *    celular com o app fechado.
 *
 * Em ambos os casos só contas ativas: notificar conta desativada é push que
 * ninguém lê.
 */
async function candidatosModeradores(
  excludeUserId: string,
  exigirPresenca: boolean
): Promise<CandidatoSos[]> {
  const cutoff = new Date(Date.now() - JANELA_PRESENCA_MS).toISOString();

  // Duas consultas completas, escolhidas aqui. O driver HTTP da Neon NÃO
  // compõe fragmentos: um `sql` aninhado vira VALOR de parâmetro, não SQL —
  // ver lib/sqlComposicao.test.ts.
  const rows = exigirPresenca
    ? await sql`
        SELECT DISTINCT u.id AS user_id
        FROM users u
        JOIN user_presence p ON p.user_id = u.id
        WHERE u.id != ${excludeUserId}
          AND u.role IN ('admin', 'moderator')
          AND u.is_active = TRUE
          AND p.last_seen_at >= ${cutoff}
      `
    : await sql`
        SELECT u.id AS user_id
        FROM users u
        WHERE u.id != ${excludeUserId}
          AND u.role IN ('admin', 'moderator')
          AND u.is_active = TRUE
      `;

  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      userId: String(row.user_id),
      dist: null,
      motivo: 'moderador' as const,
    };
  });
}

/**
 * Quem declarou estar no MESMO SPOT do SOS, com presença recente.
 *
 * Não exige GPS de ninguém: o velejador marcou "estou em Ponta do Mel" no
 * chat e isso basta para saber que ele está na mesma praia.
 */
async function candidatosNoSpot(
  excludeUserId: string,
  spotId: string | null
): Promise<CandidatoSos[]> {
  if (!spotId) return [];

  const cutoff = new Date(Date.now() - JANELA_PRESENCA_MS).toISOString();

  const rows = await sql`
    SELECT DISTINCT p.user_id AS user_id
    FROM user_presence p
    JOIN users u ON u.id = p.user_id
    WHERE p.user_id != ${excludeUserId}
      AND p.at_spot_id = ${spotId}
      AND p.last_seen_at >= ${cutoff}
      AND u.is_active = TRUE
    LIMIT ${MAX_CANDIDATOS_AMPLOS}
  `;

  return rows.map((r) => ({
    userId: String((r as Record<string, unknown>).user_id),
    dist: null,
    motivo: 'spot_fallback' as const,
  }));
}

/**
 * Quem está no mesmo ESTADO do velejador em apuros.
 *
 * A camada mais ampla que existe, e a última antes de não avisar ninguém. O
 * estado sai do spot do próprio SOS quando há um; na falta dele, do
 * `home_spot` do perfil — que é a única pista que sobra de onde a pessoa
 * costuma velejar quando o GPS falhou e ela não declarou nada.
 *
 * Sem filtro de presença, pelo mesmo motivo do moderador offline: no último
 * recurso a pergunta é "quem existe para ser avisado". Com teto, porque isto
 * roda dentro do caminho crítico do socorro.
 */
async function candidatosNoEstadoDoAutor(
  excludeUserId: string,
  spotId: string | null
): Promise<CandidatoSos[]> {
  const estadoRows = spotId
    ? await sql`SELECT state FROM spots WHERE id = ${spotId} LIMIT 1`
    : await sql`
        SELECT s.state
        FROM users u
        JOIN spots s ON s.id = u.home_spot
        WHERE u.id = ${excludeUserId}
        LIMIT 1
      `;

  if (estadoRows.length === 0) return [];
  const estado = (estadoRows[0] as Record<string, unknown>).state;
  if (estado === null || estado === undefined) return [];

  const rows = await sql`
    SELECT DISTINCT u.id AS user_id
    FROM users u
    JOIN spots s ON s.id = u.home_spot
    WHERE u.id != ${excludeUserId}
      AND s.state = ${String(estado)}
      AND u.is_active = TRUE
    LIMIT ${MAX_CANDIDATOS_AMPLOS}
  `;

  return rows.map((r) => ({
    userId: String((r as Record<string, unknown>).user_id),
    dist: null,
    motivo: 'spot_fallback' as const,
  }));
}
