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
  atSpotId: string | null = null
): Promise<void> {
  // Nada de COALESCE nas colunas: desmarcar "estou no spot" precisa gravar NULL
  // de fato, senão o velejador fica preso no último spot que escolheu.
  await sql`
    INSERT INTO user_presence (user_id, last_seen_at, room, at_spot_id)
    VALUES (${userId}, NOW(), ${room}, ${atSpotId})
    ON CONFLICT (user_id) DO UPDATE
      SET last_seen_at = NOW(),
          room         = ${room},
          at_spot_id   = ${atSpotId}
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
  room: string | null = null
): Promise<void> {
  await sql`
    INSERT INTO user_presence (user_id, last_seen_at, room)
    VALUES (${userId}, NOW(), ${room})
    ON CONFLICT (user_id) DO UPDATE
      SET last_seen_at = NOW(),
          room         = ${room}
  `;

  try {
    await sql`UPDATE users SET last_seen_at = NOW() WHERE id = ${userId}`;
  } catch {
    // Ignora erro
  }
}
