/**
 * Regras puras do chat de velejadores.
 *
 * Fica fora das rotas e da view de propósito: a mesma validação de sala, o mesmo
 * corte de texto e a mesma janela de presença precisam valer no servidor (onde é
 * garantia) e no cliente (onde é só cortesia). Duas implementações divergindo
 * seria a origem clássica de "a UI aceitou e a API recusou".
 *
 * Nada aqui toca banco, cookie ou DOM — é o que permite testar tudo em processo.
 */

/** Sala aberta a todos. */
export const GENERAL_ROOM = 'geral';

/** Limite alinhado ao CHECK de `chat_messages.text` no schema. */
export const CHAT_TEXT_MAX = 1000;

/**
 * Presença é derivada de `last_seen_at`, e esta é a janela.
 *
 * Dois minutos cobrem com folga o heartbeat de 30s do app: dá margem para uma
 * batida perdida no 3G da praia sem manter na lista alguém que já guardou o
 * celular. Aumentar isso enche a aba "Online" de fantasmas; diminuir faz o
 * velejador piscar entre online e offline a cada oscilação de sinal.
 */
export const PRESENCE_WINDOW_MS = 2 * 60 * 1000;

/** Mensagens seguidas do mesmo autor dentro desta janela viram um bloco só. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * IDs de spot são slugs (`ponta-do-mel`), não UUIDs. O recorte explícito aqui
 * impede que qualquer texto viaje como nome de sala e crie salas fantasma —
 * `room` é coluna TEXT livre, então a validação é a única barreira.
 */
const SPOT_ROOM_RE = /^spot:([A-Za-z0-9_-]{1,64})$/;

/**
 * Sala privada de um downwind: `dw:<uuid do downwind>`.
 *
 * Existe porque o mapa ao vivo prende o velejador na travessia (ele não navega
 * para as outras abas até encerrar), e sem um canal ali dentro o grupo voltaria
 * a se coordenar por WhatsApp no meio da água — que é justamente o que a
 * feature veio substituir.
 *
 * AVISO DE SEGURANÇA: o nome da sala é visível no cliente e trivial de
 * adivinhar a partir de um id de downwind. Este regex só valida FORMATO. Quem
 * autoriza é a rota, confirmando no banco que o solicitante é participante
 * daquele downwind — sem isso, qualquer pessoa leria a conversa de um grupo
 * do qual não faz parte.
 */
const DOWNWIND_ROOM_RE = /^dw:([0-9a-fA-F-]{36})$/;

/**
 * DM 1:1: `dm:<uuid menor>:<uuid maior>`, sempre nesta ordem — ver
 * `salaDireta`. Igual ao aviso de `dw:` acima, o nome é visível no cliente
 * (userId de quem manda mensagem já viaja em `toMessage()`); quem autoriza de
 * verdade é a rota, confirmando que o solicitante é um dos dois UUIDs.
 *
 * A ordem canônica NÃO é normalizada aqui de propósito: `dm:B:A` (fora de
 * ordem) é rejeitada como sala INVÁLIDA, não reescrita para `dm:A:B`. Aceitar
 * as duas grafias deixaria `chat_messages.room` (TEXT livre, sem UNIQUE) com
 * duas strings diferentes para a "mesma" conversa — metade das mensagens
 * cairia numa, metade na outra, sem ninguém perceber a conversa dividida. Só
 * quem produz o nome com `salaDireta` (sempre ordenado) nasce válido.
 */
const DM_ROOM_RE = /^dm:([0-9a-fA-F-]{36}):([0-9a-fA-F-]{36})$/;

export type ChatRoom =
  | { kind: 'geral' }
  | { kind: 'spot'; spotId: string }
  | { kind: 'downwind'; downwindId: string }
  | { kind: 'dm'; userIdA: string; userIdB: string };

/** Interpreta o nome da sala. Devolve null para qualquer coisa fora do formato. */
export function parseRoomName(raw: unknown): ChatRoom | null {
  if (typeof raw !== 'string') return null;
  if (raw === GENERAL_ROOM) return { kind: 'geral' };

  const downwind = DOWNWIND_ROOM_RE.exec(raw);
  if (downwind) return { kind: 'downwind', downwindId: downwind[1].toLowerCase() };

  const dm = DM_ROOM_RE.exec(raw);
  if (dm) {
    const userIdA = dm[1].toLowerCase();
    const userIdB = dm[2].toLowerCase();
    // Mesmo id dos dois lados (DM consigo mesmo) e ordem fora do canônico são
    // as duas formas de sala "tecnicamente no formato, mas inválida" — ver
    // comentário de DM_ROOM_RE.
    if (userIdA >= userIdB) return null;
    return { kind: 'dm', userIdA, userIdB };
  }

  const match = SPOT_ROOM_RE.exec(raw);
  if (!match) return null;
  return { kind: 'spot', spotId: match[1] };
}

export function isValidRoomName(raw: unknown): boolean {
  return parseRoomName(raw) !== null;
}

export function spotRoomName(spotId: string): string {
  return `spot:${spotId}`;
}

/**
 * Nome da sala do downwind. Sempre em minúsculas: o UUID pode chegar em
 * qualquer caixa vindo do cliente, e duas grafias do mesmo id não podem virar
 * duas conversas separadas — metade do grupo ficaria numa sala e metade na
 * outra, sem ninguém perceber.
 */
export function downwindRoomName(downwindId: string): string {
  return `dw:${downwindId.toLowerCase()}`;
}

/**
 * Nome da sala de uma conversa direta entre dois usuários. Sempre ordena os
 * dois IDs (menor primeiro) para `salaDireta(A, B)` e `salaDireta(B, A)`
 * produzirem a MESMA string — sem isso, "abrir a DM" a partir de cada lado da
 * conversa criaria duas salas diferentes. `null` para o caso degenerado de um
 * usuário tentando abrir DM consigo mesmo, que não é uma conversa.
 */
export function salaDireta(userIdA: string, userIdB: string): string | null {
  const a = userIdA.toLowerCase();
  const b = userIdB.toLowerCase();
  if (a === b) return null;
  return a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`;
}

export type SanitizedText = { ok: true; text: string } | { ok: false; error: string };

/**
 * Normaliza o texto da mensagem.
 *
 * Não escapamos HTML aqui: o React escapa na renderização e mexer nisso só
 * produziria `&lt;` visível no balão. O que fazemos é tirar caracteres de
 * controle invisíveis (que servem para forjar mensagens "vazias" ou embaralhar
 * o layout) preservando quebra de linha e tabulação, e recusar o que sobrar
 * fora do intervalo aceito pelo banco.
 */
export function sanitizeMessageText(raw: unknown): SanitizedText {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Mensagem deve ser texto.' };
  }

  // Remove controles invisiveis, mantendo \n (0x0A) e \t (0x09).
  const text = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();

  if (text.length === 0) {
    return { ok: false, error: 'Mensagem vazia.' };
  }
  if (text.length > CHAT_TEXT_MAX) {
    return { ok: false, error: `Mensagem excede ${CHAT_TEXT_MAX} caracteres.` };
  }

  return { ok: true, text };
}

/** Milissegundos entre `iso` e `now`, ou null se a data não for utilizável. */
function ageMs(value: string | Date, now: Date): number | null {
  const then = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(then)) return null;
  return now.getTime() - then;
}

/**
 * Hora relativa curta, para caber no balão sem quebrar linha.
 *
 * Idade negativa (relógio do celular adiantado em relação ao servidor) vira
 * "agora" em vez de "há -3 min" — o velejador não tem como consertar isso e o
 * texto negativo só parece bug.
 */
export function formatRelativeTime(value: string | Date, now: Date = new Date()): string {
  const age = ageMs(value, now);
  if (age === null) return '';
  if (age < 60_000) return 'agora';

  const minutos = Math.floor(age / 60_000);
  if (minutos < 60) return `há ${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;

  const dias = Math.floor(horas / 24);
  if (dias < 7) return `há ${dias} d`;

  const date = value instanceof Date ? value : new Date(value);
  const dia = String(date.getDate()).padStart(2, '0');
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}`;
}

/** Hora do relógio (HH:MM) para o rodapé do balão. */
export function formatClockTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Online = visto dentro da janela de presença. Ver PRESENCE_WINDOW_MS. */
export function isPresenceOnline(lastSeenAt: string | Date, now: Date = new Date()): boolean {
  const age = ageMs(lastSeenAt, now);
  if (age === null) return false;
  // Idade negativa é relógio adiantado, não ausência: continua online.
  return age < PRESENCE_WINDOW_MS;
}

/** Instante limite: `last_seen_at` anterior a isto está offline. */
export function presenceCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - PRESENCE_WINDOW_MS);
}

interface GroupableMessage {
  userId: string;
  createdAt: string;
}

/**
 * Decide se a mensagem continua o bloco anterior. Sem isso, uma sequência de
 * cinco frases do mesmo velejador vira cinco avatares repetidos e a conversa
 * fica ilegível na tela do celular.
 */
export function shouldGroupWithPrevious(
  previous: GroupableMessage | null | undefined,
  current: GroupableMessage
): boolean {
  if (!previous) return false;
  if (previous.userId !== current.userId) return false;

  const anterior = Date.parse(previous.createdAt);
  const atual = Date.parse(current.createdAt);
  if (!Number.isFinite(anterior) || !Number.isFinite(atual)) return false;

  return Math.abs(atual - anterior) <= GROUP_WINDOW_MS;
}
