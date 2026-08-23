import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser, requireAdmin } from '@/lib/auth';
import { HttpError } from '@/lib/auth';
import { str } from '@/lib/validation';
import type { KiteEvent } from '@/types';

export async function GET() {
  return handle(async () => {
    const user = await requireUser();

    const rows = await sql`
      SELECT
        e.id,
        e.title,
        e.event_date,
        e.location,
        e.spot_name,
        e.type,
        e.description,
        e.organizer,
        e.image_url,
        e.created_at,
        (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id = e.id) AS participants_count,
        CASE WHEN EXISTS (
          SELECT 1 FROM event_registrations er
          WHERE er.event_id = e.id AND er.user_id = ${user.id}
        ) THEN true ELSE false END AS is_registered
      FROM events e
      ORDER BY e.event_date ASC
      LIMIT 200
    `;

    const events = rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        title: String(r.title),
        date: String(r.event_date),
        location: String(r.location),
        spotName: r.spot_name ? String(r.spot_name) : undefined,
        type: r.type as KiteEvent['type'],
        description: String(r.description),
        organizer: String(r.organizer),
        imageUrl: r.image_url ? String(r.image_url) : undefined,
        timestamp: String(r.created_at),
        participantsCount: Number(r.participants_count),
        isRegistered: Boolean(r.is_registered),
      };
    });

    return { events };
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireAdmin();
    const body = await readJson(request);

    const title = str(body, 'title', { max: 200 });
    const eventDate = str(body, 'eventDate', { max: 20 });
    const location = str(body, 'location', { max: 200 });
    const spotName = str(body, 'spotName', { optional: true, max: 200 });
    const type = str(body, 'type', { max: 50 });
    const description = str(body, 'description', { max: 5000 });
    const organizer = str(body, 'organizer', { max: 200 });
    const imageUrl = str(body, 'imageUrl', { optional: true, max: 500 });

    // Validate type
    const validTypes = ['Downwind', 'Campeonato', 'Clínica / Aulas', 'Encontro de Riders'];
    if (!validTypes.includes(type)) {
      throw new HttpError(400, `Type inválido. Valores aceitos: ${validTypes.join(', ')}.`);
    }

    const inserted = await sql`
      INSERT INTO events (
        title, event_date, location, spot_name, type, description, organizer, image_url
      )
      VALUES (
        ${title}, ${eventDate}, ${location}, ${spotName || null}, ${type},
        ${description}, ${organizer}, ${imageUrl || null}
      )
      RETURNING id
    `;

    return { id: String((inserted[0] as Record<string, unknown>).id) };
  });
}
