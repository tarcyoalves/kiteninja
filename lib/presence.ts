import 'server-only';

import { sql } from './db';

/**
 * Renova a presença do velejador (o "estou aqui").
 *
 * Vive aqui, e não dentro de uma rota, porque três chamadas diferentes precisam
 * exatamente do mesmo UPSERT: o heartbeat dedicado, o GET de mensagens (ler o
 * chat já prova que o app está aberto) e o POST (escrever, idem). Três cópias
 * da mesma query divergiriam na primeira mudança de coluna.
 *
 * O ON CONFLICT existe porque a primeira batida é INSERT e todas as seguintes
 * são UPDATE na mesma linha (user_id é PK). Sem ele, tudo depois do primeiro
 * heartbeat estouraria na chave primária e a lista de online congelaria.
 */
export async function touchPresence(
  userId: string,
  room: string | null = null,
  atSpotId: string | null = null,
  lat: number | null = null,
  lng: number | null = null
): Promise<void> {
  // Nada de COALESCE em room/at_spot_id: desmarcar "estou no spot" precisa
  // gravar NULL de fato, senão o velejador fica preso no último spot que
  // escolheu.
  //
  // lat/lng são o oposto: aqui QUEREMOS preservar o valor antigo quando o
  // heartbeat não trouxe coordenada nova. O heartbeat bate a cada poucos
  // segundos, mas o navegador só reenvia posição quando o GPS de fato se
  // move — se um heartbeat sem coordenada apagasse a última conhecida, um
  // SOS logo depois perderia candidato só por causa do timing do heartbeat.
  // pos_updated_at só avança quando uma coordenada nova de fato chega, para
  // a seleção de candidatos do SOS saber se essa posição ainda é fresca.
  const posUpdatedAt = lat !== null && lng !== null ? new Date() : null;
  await sql`
    INSERT INTO user_presence (user_id, last_seen_at, room, at_spot_id, lat, lng, pos_updated_at)
    VALUES (${userId}, NOW(), ${room}, ${atSpotId}, ${lat}, ${lng}, ${posUpdatedAt})
    ON CONFLICT (user_id) DO UPDATE
      SET last_seen_at   = NOW(),
          room           = ${room},
          at_spot_id     = ${atSpotId},
          lat            = COALESCE(${lat}, user_presence.lat),
          lng            = COALESCE(${lng}, user_presence.lng),
          pos_updated_at = COALESCE(${posUpdatedAt}, user_presence.pos_updated_at)
  `;

  // Sincroniza last_seen_at na tabela principal de velejadores para o painel de monitoramento
  try {
    await sql`UPDATE users SET last_seen_at = NOW() WHERE id = ${userId}`;
  } catch {
    // Ignora erro
  }
}

/**
 * Variante que preserva o spot já marcado.
 *
 * Usada pelas rotas de mensagem: ler ou escrever no chat renova o horário e a
 * sala, mas não deve apagar o "estou em Ponta do Mel" que o velejador marcou na
 * aba Online — ele não mexeu nisso ao mandar um recado.
 */
export async function touchPresenceKeepingSpot(
  userId: string,
  room: string | null = null,
  lat: number | null = null,
  lng: number | null = null
): Promise<void> {
  // Mesma lógica de preservar lat/lng de touchPresence (ver comentário lá):
  // sem coordenada nova, mantém a última conhecida em vez de apagar.
  const posUpdatedAt = lat !== null && lng !== null ? new Date() : null;
  await sql`
    INSERT INTO user_presence (user_id, last_seen_at, room, lat, lng, pos_updated_at)
    VALUES (${userId}, NOW(), ${room}, ${lat}, ${lng}, ${posUpdatedAt})
    ON CONFLICT (user_id) DO UPDATE
      SET last_seen_at   = NOW(),
          room           = ${room},
          lat            = COALESCE(${lat}, user_presence.lat),
          lng            = COALESCE(${lng}, user_presence.lng),
          pos_updated_at = COALESCE(${posUpdatedAt}, user_presence.pos_updated_at)
  `;

  try {
    await sql`UPDATE users SET last_seen_at = NOW() WHERE id = ${userId}`;
  } catch {
    // Ignora erro
  }
}
