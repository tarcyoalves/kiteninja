import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser, requireDownwindOrganizer, HttpError } from '@/lib/auth';
import { canCreateOfficialEvent } from '@/lib/authz';
import { str } from '@/lib/validation';
import { dataDoEvento } from '@/lib/dataEvento';
import {
  VISIBILIDADE_PADRAO,
  normalizarVisibilidade,
} from '@/lib/downwindVisibilidade';
import { normalizarUf } from '@/lib/uf';
import { encerrarAbandonados } from '@/lib/downwindSilencio';
import type { KiteEvent } from '@/types';

const EVENT_TYPES = ['Downwind', 'Campeonato', 'Clínica / Aulas', 'Encontro de Riders'] as const;

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser();

    /*
     * Filtro por estado. Vem da query string e é normalizado por
     * `normalizarUf` — `?uf=XX` digitado à mão vira null (sem filtro), nunca
     * uma UF plausível. Ver lib/uf.ts para por que a agenda escala por aqui.
     */
    const ufFiltro = normalizarUf(new URL(request.url).searchParams.get('uf'));

    /*
     * Varredura preguiçosa de downwind abandonado, no momento exato em que o
     * dado errado seria visto.
     *
     * Ela vivia em GET /api/downwind, que era o que alimentava a segunda
     * lista da aba Eventos. Com a lista unificada aqui, aquela rota deixou de
     * ser chamada a cada abertura do app — e a varredura teria voltado a
     * depender só do cron, que entrega uma execução a cada ~4,3h (medido; ver
     * docs/CRON-EXTERNO-SOS.md). Foi assim que um downwind ficou "Na água
     * agora" por dois dias.
     *
     * Em try/catch e antes da listagem: ver um status velho é ruim, não ver
     * evento nenhum é pior.
     */
    try {
      await encerrarAbandonados();
    } catch {
      // Varredura é manutenção, não a resposta. Falhou, a agenda vai assim mesmo.
    }

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
        e.uf,
        d.id AS downwind_id,
        d.status AS downwind_status,
        d.visibilidade AS downwind_visibilidade,
        d.notificado_em AS downwind_notificado_em,
        (d.criado_por = ${user.id}) AS downwind_criado_por_mim,
        (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id = e.id) AS participants_count,
        CASE WHEN EXISTS (
          SELECT 1 FROM event_registrations er
          WHERE er.event_id = e.id AND er.user_id = ${user.id}
        ) THEN true ELSE false END AS is_registered
      FROM events e
      LEFT JOIN downwinds d ON d.event_id = e.id
      WHERE (
        d.id IS NULL OR d.visibilidade = 'comunidade' OR d.criado_por = ${user.id} OR EXISTS (
          SELECT 1 FROM downwind_participantes dp WHERE dp.downwind_id = d.id AND dp.user_id = ${user.id}
        )
      )
      -- Filtro de estado. Sem filtro (${ufFiltro} IS NULL) tudo passa; com
      -- filtro, evento de UF desconhecida fica de fora — ver eventoCasaComUf.
      AND (${ufFiltro}::text IS NULL OR e.uf = ${ufFiltro})
      /*
       * event_at, não event_date: a segunda é TEXT com a data por extenso em
       * português, e ordenar texto é ordenar alfabeticamente — "01 de
       * setembro de 2026" vinha antes de "02 de janeiro de 2027", que vinha
       * antes de "31 de agosto de 2026". A agenda aparecia embaralhada.
       * NULLS LAST manda os eventos antigos (sem event_at) para o fim, em
       * ordem de criação — ver lib/dataEvento.ts.
       */
      ORDER BY e.event_at ASC NULLS LAST, e.created_at DESC
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
        uf: r.uf ? String(r.uf) : null,
        downwindId: r.downwind_id ? String(r.downwind_id) : null,
        downwindStatus: r.downwind_status ? String(r.downwind_status) as KiteEvent['downwindStatus'] : null,
        downwindCriadoPorMim: Boolean(r.downwind_criado_por_mim),
        downwindVisibilidade: r.downwind_visibilidade
          ? (String(r.downwind_visibilidade) as 'privado' | 'comunidade')
          : null,
        downwindJaNotificado: r.downwind_notificado_em !== null && r.downwind_notificado_em !== undefined,
      };
    });

    return { events };
  });
}

/**
 * Downwind é criado a partir daqui (não por uma rota própria): o dono pediu
 * que o downwind "nasça em Eventos", então a mesma rota que cria o evento
 * também cria, na mesma requisição, a linha em `downwinds` já vinculada via
 * `event_id` — ver lib/schema.sql e docs/PENDENCIAS-20-08-2026.md. Sem
 * transação (o driver HTTP do Neon não expõe uma aqui, e o resto do projeto
 * já aceita esse risco em fluxos parecidos — ver app/api/sos/[id]/respond):
 * se o segundo INSERT falhar, o evento fica órfão de downwind, mas nunca o
 * contrário (o evento sempre existe antes do downwind ser tentado).
 */
async function createDownwindEvent(body: unknown) {
  const user = await requireDownwindOrganizer();

  const title = str(body, 'title', { max: 200 });
  const location = str(body, 'location', { max: 200 });
  const description = str(body, 'description', { max: 5000 });
  const imageUrl = str(body, 'imageUrl', { optional: true, max: 500 });
  const spotSaidaId = str(body, 'spotSaidaId', { max: 100 });
  const spotChegadaId = str(body, 'spotChegadaId', { optional: true, max: 100 });
  const previstoParaRaw = str(body, 'previstoPara', { max: 40 });

  /*
   * A CAUSA RAIZ DO "CRIEI E NÃO APARECEU PARA NINGUÉM".
   *
   * Este INSERT não passava `visibilidade`, então todo downwind criado pela
   * aba Eventos caía no DEFAULT 'privado' do schema — e o filtro de GET
   * (logo acima) corretamente o escondia de todo mundo. O formulário nem
   * perguntava: não existia jeito de criar um downwind visível por aqui.
   *
   * Valor inválido é 400, não silêncio: publicar ou esconder a localização de
   * um grupo por interpretação de string é exatamente o erro que se está
   * corrigindo. Ausência cai no padrão fechado — ver o comentário sobre isso
   * em lib/downwindVisibilidade.ts.
   */
  const visibilidadeRaw = str(body, 'visibilidade', { optional: true, max: 20 });
  const visibilidade = visibilidadeRaw
    ? normalizarVisibilidade(visibilidadeRaw)
    : VISIBILIDADE_PADRAO;
  if (visibilidade === null) throw new HttpError(400, 'Visibilidade inválida.');

  const previstoPara = new Date(previstoParaRaw);
  if (Number.isNaN(previstoPara.getTime())) {
    throw new HttpError(400, 'Data/hora do downwind inválida.');
  }

  const spotSaidaRows = await sql`SELECT name, state FROM spots WHERE id = ${spotSaidaId} LIMIT 1`;
  if (spotSaidaRows.length === 0) throw new HttpError(400, 'Spot de saída inválido.');
  const spotSaidaRow = spotSaidaRows[0] as Record<string, unknown>;
  const spotSaidaName = String(spotSaidaRow.name);
  // UF herdada do spot de saída: ninguém digita estado. Ver lib/uf.ts.
  const uf = normalizarUf(spotSaidaRow.state);

  if (spotChegadaId) {
    const spotChegadaRows = await sql`SELECT id FROM spots WHERE id = ${spotChegadaId} LIMIT 1`;
    if (spotChegadaRows.length === 0) throw new HttpError(400, 'Spot de chegada inválido.');
  }

  // event_date é TEXT livre (o resto do app só exibe, nunca reparsa) — aqui
  // vem de uma data real digitada no formulário, então formatamos por
  // extenso em vez de pedir pro organizador escrever a data duas vezes.
  const eventDate = previstoPara.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const insertedEvent = await sql`
    INSERT INTO events (
      title, event_date, event_at, location, spot_name, type, description, organizer, image_url, uf
    )
    VALUES (
      ${title}, ${eventDate}, ${previstoPara.toISOString()},
      ${location}, ${spotSaidaName}, 'Downwind',
      ${description}, ${user.name}, ${imageUrl || null}, ${uf}
    )
    RETURNING id
  `;
  const eventId = String((insertedEvent[0] as Record<string, unknown>).id);

  // Sem transação real (o driver HTTP do Neon usado neste projeto não expõe
  // uma): se qualquer passo depois daqui falhar, desfazemos manualmente em
  // vez de deixar um evento "Downwind" órfão no ar, sem downwind nem
  // participante por trás — já aconteceu em produção (schema.sql com
  // downwinds.event_id não migrado ainda) e o evento fake ficou visível pra
  // todo mundo na lista de Eventos mesmo com a criação tendo "falhado".
  let downwindId: string | undefined;
  try {
    const insertedDownwind = await sql`
      INSERT INTO downwinds (
        nome, spot_saida, spot_chegada, criado_por, previsto_para, visibilidade, event_id
      )
      VALUES (
        ${title}, ${spotSaidaId}, ${spotChegadaId || null}, ${user.id},
        ${previstoPara.toISOString()}, ${visibilidade}, ${eventId}
      )
      RETURNING id
    `;
    downwindId = String((insertedDownwind[0] as Record<string, unknown>).id);

    // O organizador entra como participante velejador — ele é quem mais
    // provavelmente vai estar na água puxando o grupo (ver comentário sobre
    // eh_organizador em lib/downwind.ts). Sem isso ele nem entraria no quórum
    // de encerramento do próprio downwind que criou.
    await sql`
      INSERT INTO downwind_participantes (downwind_id, user_id, papel, eh_organizador)
      VALUES (${downwindId}, ${user.id}, 'velejador', TRUE)
    `;

    return { id: eventId, downwindId, visibilidade };
  } catch (err) {
    if (downwindId) await sql`DELETE FROM downwinds WHERE id = ${downwindId}`;
    await sql`DELETE FROM events WHERE id = ${eventId}`;
    throw err;
  }
}

async function createOfficialEvent(body: unknown) {
  const user = await requireUser();
  if (!canCreateOfficialEvent(user.role)) {
    throw new HttpError(403, 'Sem permissão para cadastrar eventos oficiais.');
  }

  const title = str(body, 'title', { max: 200 });
  const eventDate = str(body, 'eventDate', { max: 20 });
  const location = str(body, 'location', { max: 200 });
  const spotName = str(body, 'spotName', { optional: true, max: 200 });
  const type = str(body, 'type', { max: 50 });
  const description = str(body, 'description', { max: 5000 });
  const organizer = str(body, 'organizer', { max: 200 });
  const imageUrl = str(body, 'imageUrl', { optional: true, max: 500 });

  const inserted = await sql`
    INSERT INTO events (
      title, event_date, event_at, location, spot_name, type, description, organizer, image_url
    )
    VALUES (
      ${title}, ${eventDate}, ${dataDoEvento(eventDate)?.toISOString() ?? null},
      ${location}, ${spotName || null}, ${type},
      ${description}, ${organizer}, ${imageUrl || null}
    )
    RETURNING id
  `;

  return { id: String((inserted[0] as Record<string, unknown>).id) };
}

export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    const type = str(body, 'type', { max: 50 });
    if (!EVENT_TYPES.includes(type as (typeof EVENT_TYPES)[number])) {
      throw new HttpError(400, `Type inválido. Valores aceitos: ${EVENT_TYPES.join(', ')}.`);
    }

    if (type === 'Downwind') return createDownwindEvent(body);
    return createOfficialEvent(body);
  });
}
