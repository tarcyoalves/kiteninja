import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';
import { PRESENCE_WINDOW_MS, isValidRoomName, presenceCutoff } from '@/lib/chat';
import { touchPresence } from '@/lib/presence';

/**
 * Heartbeat. Marca "estou com o app aberto" e, opcionalmente, em qual spot.
 *
 * O UPSERT existe porque a primeira batida de um velejador é um INSERT e todas
 * as seguintes são UPDATE. Sem ON CONFLICT, cada heartbeat depois do primeiro
 * quebraria na chave primária — e a lista de online nunca atualizaria.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson(request);
    const payload = (body ?? {}) as Record<string, unknown>;

    // Sala é opcional no heartbeat: quem está na aba "Online" não está em sala
    // nenhuma, e forçar um valor aqui inventaria presença numa conversa.
    const roomRaw = payload.room;
    let room: string | null = null;
    if (roomRaw !== undefined && roomRaw !== null && roomRaw !== '') {
      if (!isValidRoomName(roomRaw)) throw new HttpError(400, 'Sala inválida.');
      room = String(roomRaw);
    }

    const spotRaw = payload.atSpotId;
    let atSpotId: string | null = null;
    if (spotRaw !== undefined && spotRaw !== null && spotRaw !== '') {
      if (typeof spotRaw !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(spotRaw)) {
        throw new HttpError(400, 'Spot inválido.');
      }
      const exists = await sql`SELECT id FROM spots WHERE id = ${spotRaw} LIMIT 1`;
      if (exists.length === 0) throw new HttpError(404, 'Spot não encontrado.');
      atSpotId = spotRaw;
    }

    await touchPresence(user.id, room, atSpotId);

    return { ok: true, windowMs: PRESENCE_WINDOW_MS };
  });
}

/** Quem está na água agora: presença dentro da janela, mais recente primeiro. */
export async function GET(request: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(request.url);

    // O corte é calculado em JS e passado como parâmetro (em vez de um
    // INTERVAL literal no SQL) para que a janela tenha uma única definição no
    // código — a constante de lib/chat.ts, também usada pela UI.
    const cutoff = presenceCutoff().toISOString();

    // Filtro opcional por sala, para quando a UI quiser "quem está nesta sala".
    const roomRaw = url.searchParams.get('room');
    const room = roomRaw && isValidRoomName(roomRaw) ? roomRaw : null;

    const rows = await sql`
      SELECT
        p.user_id,
        p.last_seen_at,
        p.room,
        p.at_spot_id,
        u.name        AS user_name,
        u.avatar_url  AS user_avatar,
        u.rider_id    AS user_rider_id,
        u.rider_level AS user_level,
        u.country_flag AS user_flag,
        s.name        AS spot_name
      FROM user_presence p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN spots s ON s.id = p.at_spot_id
      WHERE p.last_seen_at > ${cutoff}
        AND (${room}::text IS NULL OR p.room = ${room})
      ORDER BY p.last_seen_at DESC
      LIMIT 200
    `;

    const online = rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        userId: String(r.user_id),
        userName: String(r.user_name),
        userAvatar: r.user_avatar ? String(r.user_avatar) : undefined,
        userRiderId: String(r.user_rider_id),
        userLevel: String(r.user_level),
        countryFlag: r.user_flag ? String(r.user_flag) : '🇧🇷',
        room: r.room ? String(r.room) : undefined,
        atSpotId: r.at_spot_id ? String(r.at_spot_id) : undefined,
        atSpotName: r.spot_name ? String(r.spot_name) : undefined,
        lastSeenAt: new Date(String(r.last_seen_at)).toISOString(),
      };
    });

    return { online, count: online.length, windowMs: PRESENCE_WINDOW_MS };
  });
}
