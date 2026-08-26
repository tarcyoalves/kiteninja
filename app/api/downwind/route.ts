import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser, requireDownwindOrganizer, HttpError } from '@/lib/auth';
import { rateLimiters } from '@/lib/rateLimit';
import { str } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson(request);

    const nome = str(body, 'nome', { min: 3, max: 100 });
    const spotSaida = str(body, 'spotSaida', { max: 100 });
    const spotChegada = str(body, 'spotChegada', { optional: true, max: 100 });
    const previstoParaRaw = str(body, 'previstoPara', { optional: true, max: 50 });
    const visibilidade = str(body, 'visibilidade', { optional: true, max: 20 }) || 'privado';

    if (visibilidade !== 'privado' && visibilidade !== 'comunidade') {
      throw new HttpError(400, 'Visibilidade inválida.');
    }

    if (visibilidade === 'comunidade') {
      await requireDownwindOrganizer();
    } else {
      rateLimiters.downwindCriar(user.id);
    }

    const spotSaidaRows = await sql`SELECT id, name, location FROM spots WHERE id = ${spotSaida} LIMIT 1`;
    if (spotSaidaRows.length === 0) throw new HttpError(400, 'Spot de saída inválido.');
    const spotSaidaObj = spotSaidaRows[0] as Record<string, unknown>;
    const spotSaidaName = String(spotSaidaObj.name);
    const spotSaidaLocation = String(spotSaidaObj.location || spotSaidaName);

    if (spotChegada) {
      const spotChegadaRows = await sql`SELECT id FROM spots WHERE id = ${spotChegada} LIMIT 1`;
      if (spotChegadaRows.length === 0) throw new HttpError(400, 'Spot de chegada inválido.');
    }

    let previstoPara: Date;
    if (previstoParaRaw) {
      previstoPara = new Date(previstoParaRaw);
      if (Number.isNaN(previstoPara.getTime())) {
        throw new HttpError(400, 'Data/hora de previsão inválida.');
      }
    } else {
      previstoPara = new Date();
    }

    let eventId: string | null = null;
    let downwindId: string | undefined;

    try {
      if (visibilidade === 'comunidade') {
        const eventDate = previstoPara.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        });

        const insertedEvent = await sql`
          INSERT INTO events (
            title, event_date, location, spot_name, type, description, organizer
          )
          VALUES (
            ${nome}, ${eventDate}, ${spotSaidaLocation}, ${spotSaidaName}, 'Downwind',
            ${`Downwind da comunidade organizado por ${user.name}`}, ${user.name}
          )
          RETURNING id
        `;
        eventId = String((insertedEvent[0] as Record<string, unknown>).id);
      }

      const inserted = await sql`
        INSERT INTO downwinds (
          nome, spot_saida, spot_chegada, criado_por, status, previsto_para, visibilidade, event_id
        )
        VALUES (
          ${nome}, ${spotSaida}, ${spotChegada || null}, ${user.id}, 'aberto',
          ${previstoPara.toISOString()}, ${visibilidade}, ${eventId}
        )
        RETURNING id, nome, spot_saida, spot_chegada, status, previsto_para, visibilidade, criado_em
      `;

      const downwind = inserted[0] as Record<string, unknown>;
      downwindId = String(downwind.id);

      await sql`
        INSERT INTO downwind_participantes (downwind_id, user_id, papel, eh_organizador, estado)
        VALUES (${downwindId}, ${user.id}, 'velejador', TRUE, 'confirmado')
        ON CONFLICT DO NOTHING
      `;

      return {
        id: downwindId,
        eventId,
        nome: String(downwind.nome),
        spotSaida: String(downwind.spot_saida),
        spotChegada: downwind.spot_chegada ? String(downwind.spot_chegada) : null,
        status: String(downwind.status),
        previstoPara: String(downwind.previsto_para),
        visibilidade: String(downwind.visibilidade),
        criadoEm: String(downwind.criado_em),
      };
    } catch (err) {
      if (downwindId) {
        await sql`DELETE FROM downwinds WHERE id = ${downwindId}`;
      }
      if (eventId) {
        await sql`DELETE FROM events WHERE id = ${eventId}`;
      }
      throw err;
    }
  });
}