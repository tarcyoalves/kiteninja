import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser } from '@/lib/auth';

/**
 * Inbox de conversas diretas: uma linha por sala `dm:*` da qual o usuário
 * participa, com a última mensagem e quem é do outro lado. `DISTINCT ON
 * (room)` + `ORDER BY room, created_at DESC` é o idioma padrão do Postgres
 * para "a linha mais recente de cada grupo" — não precisa de subquery.
 *
 * `room LIKE 'dm:' || id || ':%'` casa quando o usuário é o UUID MENOR
 * (primeira posição), e `'dm:%:' || id` quando é o MAIOR (segunda posição) —
 * ver lib/chat.ts sobre a ordem canônica. Os dois `LIKE` juntos cobrem os
 * dois casos sem precisar decidir de antemão qual é o meu.
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();

    const rows = await sql`
      SELECT DISTINCT ON (room)
        room, user_id AS last_sender_id, text, created_at
      FROM chat_messages
      WHERE room LIKE 'dm:%'
        AND (room LIKE ${'dm:' + user.id + ':%'} OR room LIKE ${'dm:%:' + user.id})
      ORDER BY room, created_at DESC
    `;

    if (rows.length === 0) return { conversas: [] };

    const outroIdDaSala = (room: string): string => {
      const [, a, b] = room.split(':');
      return a === user.id ? b : a;
    };

    const outrosIds = rows.map((r) => outroIdDaSala(String((r as Record<string, unknown>).room)));

    const usuarios = await sql`
      SELECT id, name, avatar_url, rider_id, country_flag
      FROM users WHERE id = ANY(${outrosIds})
    `;
    const usuariosPorId = new Map(
      usuarios.map((u) => [String((u as Record<string, unknown>).id), u as Record<string, unknown>])
    );

    const conversas = rows
      .map((r) => {
        const row = r as Record<string, unknown>;
        const room = String(row.room);
        const outroId = outroIdDaSala(room);
        const outro = usuariosPorId.get(outroId);
        // Conta apagada: a conversa fica pra trás em vez de quebrar o inbox
        // inteiro — mesma tolerância que sessions_log.spot_id / SET NULL usam
        // pro resto do app.
        if (!outro) return null;

        return {
          userId: outroId,
          userName: String(outro.name),
          userAvatar: outro.avatar_url ? String(outro.avatar_url) : undefined,
          userRiderId: String(outro.rider_id),
          countryFlag: outro.country_flag ? String(outro.country_flag) : undefined,
          lastMessage: {
            text: String(row.text),
            createdAt: new Date(String(row.created_at)).toISOString(),
            fromMe: String(row.last_sender_id) === user.id,
          },
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => Date.parse(b.lastMessage.createdAt) - Date.parse(a.lastMessage.createdAt));

    return { conversas };
  });
}
