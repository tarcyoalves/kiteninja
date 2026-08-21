import { after } from 'next/server';
import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { getSessionUser, HttpError, type SessionUser } from '@/lib/auth';
import { CHAT_TEXT_MAX, downwindRoomName, parseRoomName, presenceSafeRoom, salaDireta, sanitizeMessageText } from '@/lib/chat';
import { canAccessDm } from '@/lib/authz';
import { touchPresenceKeepingSpot } from '@/lib/presence';
import { buscarParticipacao } from '@/lib/downwindDb';
import { MSG_DOWNWIND_NAO_ENCONTRADO } from '@/lib/downwindAcesso';

/**
 * Resolve o usuário da requisição, aceitando a sessão de convidado do link
 * de 12h (lib/auth.ts, `SessionUser.guestDownwindId`) — `requireUser()`
 * rejeitaria de cara. O escopo do convidado (só a sala `dw:<seu downwind>`)
 * é checado em `requireExistingRoom`, que conhece o room de destino; aqui só
 * garante que existe uma sessão.
 */
async function resolverUsuarioChat(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, 'Não autenticado.');
  return user;
}

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
 *
 * A sala de downwind (`dw:<uuid>`) e a de DM (`dm:<uuid>:<uuid>`) são as
 * únicas PRIVADAS do sistema, e por isso as únicas que exigem autorização
 * aqui: os dois nomes são visíveis no cliente e triviais de montar a partir
 * de ids que já circulam (userId de quem manda mensagem viaja em
 * `toMessage()`), então quem não participa não pode ler nem escrever.
 *
 * Downwind responde 404 (nunca 403): confirmar que aquele downwind existe já
 * vazaria que um grupo está navegando ali. DM responde 403: ao contrário de
 * um downwind, o "fato" de que duas contas PODERIAM conversar não é segredo
 * nenhum — é verdade pra qualquer par de usuários do app, sempre. O que é
 * protegido é só o conteúdo, então negar sem fingir "não existe" está bem.
 *
 * CONVIDADO DO LINK DE 12H (`user.guestDownwindId` preenchido) só alcança a
 * sala `dw:<seu próprio downwind>` — nunca 'geral', 'spot:*' nem 'dm:*', que
 * são fora do escopo "mapa e chat da travessia" prometido a ele. Aqui é 403,
 * não 404: salas geral/spot sempre existem, não há existência nenhuma a
 * esconder.
 */
async function requireExistingRoom(raw: unknown, user: SessionUser): Promise<string> {
  const parsed = parseRoomName(raw);
  if (!parsed) {
    throw new HttpError(400, "Sala inválida. Use 'geral', 'spot:<id>', 'dw:<id>' ou 'dm:<idA>:<idB>'.");
  }

  if (user.guestDownwindId && (parsed.kind !== 'downwind' || parsed.downwindId !== user.guestDownwindId)) {
    throw new HttpError(403, 'Este acesso de convidado só alcança o chat da própria travessia.');
  }

  if (parsed.kind === 'geral') return 'geral';

  if (parsed.kind === 'downwind') {
    const participacao = await buscarParticipacao(parsed.downwindId, user.id);
    if (!participacao || participacao.estado === 'desistiu') {
      throw new HttpError(404, MSG_DOWNWIND_NAO_ENCONTRADO);
    }
    return downwindRoomName(parsed.downwindId);
  }

  if (parsed.kind === 'dm') {
    if (!canAccessDm(user.id, parsed.userIdA, parsed.userIdB)) {
      throw new HttpError(403, 'Você não participa desta conversa.');
    }
    // Reconstrói via salaDireta (não usa `raw` direto) para qualquer conta
    // que tenha chegado aqui com os UUIDs em caixa mista virar exatamente a
    // mesma string gravada no banco — mesmo raciocínio de downwindRoomName
    // normalizar para minúsculas.
    const sala = salaDireta(parsed.userIdA, parsed.userIdB);
    // Inalcançável na prática: parseRoomName já rejeita userIdA === userIdB,
    // que é o único jeito de salaDireta devolver null aqui.
    if (!sala) throw new HttpError(400, 'Sala de DM inválida.');
    return sala;
  }

  const rows = await sql`SELECT id FROM spots WHERE id = ${parsed.spotId} LIMIT 1`;
  if (rows.length === 0) throw new HttpError(404, 'Spot não encontrado.');

  return `spot:${parsed.spotId}`;
}

export async function GET(request: Request) {
  return handle(async () => {
    const user = await resolverUsuarioChat();
    const url = new URL(request.url);

    const room = await requireExistingRoom(url.searchParams.get('room') ?? 'geral', user);

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
        // presenceSafeRoom: sala de DM nunca vai para user_presence (ver o
        // porquê no próprio helper) — só 'geral'/'spot:'/'dw:' são públicas.
        await touchPresenceKeepingSpot(user.id, presenceSafeRoom(room));
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
    const user = await resolverUsuarioChat();
    const body = await readJson(request);

    const room = await requireExistingRoom(
      (body as Record<string, unknown> | null)?.room,
      user
    );

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
        await touchPresenceKeepingSpot(user.id, presenceSafeRoom(room));
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
