import { after } from 'next/server';
import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';
import { CHAT_TEXT_MAX, parseRoomName, sanitizeMessageText } from '@/lib/chat';
import { touchPresenceKeepingSpot } from '@/lib/presence';

/** Teto de leitura por requisição. Acima disso o payload passa a doer no 3G. */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/** Rate limit do POST: 10 mensagens por minuto por velejador. */
const RATE_LIMIT_PER_MINUTE = 10;

interface MessageRow {
  id: unknown;
  user_id: unknown;
  text: unknown;
  created_at: unknown;
  author_name: unknown;
  author_avatar: unknown;
  author_rider_id: unknown;
}

function toMessage(row: unknown) {
  const r = row as MessageRow;
  return {
    id: String(r.id),
    userId: String(r.user_id),
    userName: String(r.author_name),
    userAvatar: r.author_avatar ? String(r.author_avatar) : undefined,
    userRiderId: String(r.author_rider_id),
    text: String(r.text),
    createdAt: new Date(String(r.created_at)).toISOString(),
  };
}

/**
 * Valida o nome da sala e, quando for sala de spot, confirma que o spot existe.
 *
 * A checagem no banco importa: sem ela, um cliente com typo no slug cria uma
 * sala válida no formato mas invisível na UI (nenhum seletor aponta para ela),
 * e as mensagens somem sem erro aparente.
 */
async function requireExistingRoom(raw: unknown): Promise<string> {
  const parsed = parseRoomName(raw);
  if (!parsed) {
    throw new HttpError(400, "Sala inválida. Use 'geral' ou 'spot:<id>'.");
  }
  if (parsed.kind === 'geral') return 'geral';

  const rows = await sql`SELECT id FROM spots WHERE id = ${parsed.spotId} LIMIT 1`;
  if (rows.length === 0) throw new HttpError(404, 'Spot não encontrado.');

  return `spot:${parsed.spotId}`;
}

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(request.url);

    const room = await requireExistingRoom(url.searchParams.get('room') ?? 'geral');

    const rawLimit = Number(url.searchParams.get('limit'));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

    // `since` chega do próprio cliente (é o createdAt da última mensagem que ele
    // já tem). Data inválida é ignorada em vez de virar erro: o pior caso é
    // recarregar o histórico, e derrubar o polling por isso seria pior.
    const sinceRaw = url.searchParams.get('since');
    const sinceMs = sinceRaw ? Date.parse(sinceRaw) : NaN;
    const since = Number.isFinite(sinceMs) ? new Date(sinceMs).toISOString() : null;

    let rows;
    if (since) {
      // Incremental: ASC direto, já que só vem o que é novo e cabe no limite.
      rows = await sql`
        SELECT
          cm.id, cm.user_id, cm.text, cm.created_at,
          u.name      AS author_name,
          u.avatar_url AS author_avatar,
          u.rider_id  AS author_rider_id
        FROM chat_messages cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.room = ${room} AND cm.created_at > ${since}
        ORDER BY cm.created_at ASC
        LIMIT ${limit}
      `;
    } else {
      // Primeira carga: pegamos as N MAIS RECENTES (DESC + LIMIT) e invertemos
      // no servidor. ASC com LIMIT devolveria as mais antigas — o começo da
      // conversa em vez do fim, que é o que interessa em chat.
      const recent = await sql`
        SELECT
          cm.id, cm.user_id, cm.text, cm.created_at,
          u.name      AS author_name,
          u.avatar_url AS author_avatar,
          u.rider_id  AS author_rider_id
        FROM chat_messages cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.room = ${room}
        ORDER BY cm.created_at DESC
        LIMIT ${limit}
      `;
      rows = recent.slice().reverse();
    }

    // Um GET já prova que a pessoa está com o app aberto nesta sala, então
    // renovamos a presença aqui: o heartbeat dedicado passa a ser só a garantia
    // de quem está lendo sem novidade chegando.
    //
    // Presença é acessório; mensagem é o serviço. Roda em after() — depois da
    // resposta ser enviada — em vez de aguardado: touchPresenceKeepingSpot faz
    // um UPSERT + um UPDATE, dois round-trips a mais no Neon a cada poll de
    // 4s, e esperar por eles antes de responder significa que quem abre o
    // chat vê a tela em branco até essas duas escritas acessórias terminarem,
    // em cima da própria busca de mensagens. after() (Next.js), não uma
    // Promise solta sem await: em ambiente serverless (Vercel) o processo pode
    // ser congelado assim que a resposta é enviada, e uma Promise sem await
    // arriscaria nunca terminar; after() garante que a plataforma espera o
    // callback antes de finalizar a função.
    after(async () => {
      try {
        await touchPresenceKeepingSpot(user.id, room);
      } catch (err) {
        console.error('[chat] presença não gravada no GET', err);
      }
    });

    const messages = rows.map(toMessage);

    return {
      room,
      messages,
      // O cliente usa isto como próximo `since`, em vez de calcular no relógio
      // dele: relógio de celular adiantado pularia mensagens para sempre.
      latestAt: messages.length > 0 ? messages[messages.length - 1].createdAt : since,
    };
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson(request);

    const room = await requireExistingRoom((body as Record<string, unknown> | null)?.room);

    const clean = sanitizeMessageText((body as Record<string, unknown> | null)?.text);
    if (!clean.ok) throw new HttpError(400, clean.error);

    /**
     * Rate limit por janela deslizante de 1 minuto.
     *
     * Sem isto, um cliente com loop de retry mal fechado (ou alguém de má fé)
     * enche a tabela em segundos e afoga a sala para todos. O COUNT é sobre um
     * índice já existente (room, created_at) filtrado por user_id — barato o
     * bastante para pagar em cada envio.
     */
    const recent = await sql`
      SELECT COUNT(*)::int AS total
      FROM chat_messages
      WHERE user_id = ${user.id}
        AND created_at > NOW() - INTERVAL '1 minute'
    `;
    const total = Number((recent[0] as Record<string, unknown>).total);
    if (total >= RATE_LIMIT_PER_MINUTE) {
      throw new HttpError(
        429,
        `Muitas mensagens seguidas. Aguarde um instante (limite de ${RATE_LIMIT_PER_MINUTE} por minuto).`
      );
    }

    const inserted = await sql`
      INSERT INTO chat_messages (user_id, room, text)
      VALUES (${user.id}, ${room}, ${clean.text})
      RETURNING id, user_id, text, created_at
    `;

    // Enviar também é sinal de presença — evita o velejador que só escreve
    // aparecer como offline entre dois heartbeats. Mesmo motivo do GET: roda
    // em after() em vez de aguardado, porque a mensagem já está gravada, e
    // perder a presença não pode fazer o envio parecer mais lento (nem
    // falhar) — e after() garante que a escrita realmente roda até o fim em
    // serverless, o que uma Promise solta sem await não garante.
    after(async () => {
      try {
        await touchPresenceKeepingSpot(user.id, room);
      } catch (err) {
        console.error('[chat] presença não gravada no POST', err);
      }
    });

    // Devolvemos só o que o cliente NÃO tinha (id e created_at do banco). Nome,
    // avatar e riderId do próprio autor já estão na sessão do cliente, e buscá-
    // los de novo aqui seria um round-trip a mais em cada envio.
    const r = inserted[0] as Record<string, unknown>;
    return {
      message: {
        id: String(r.id),
        userId: String(r.user_id),
        text: String(r.text),
        createdAt: new Date(String(r.created_at)).toISOString(),
      },
      maxLength: CHAT_TEXT_MAX,
    };
  });
}
