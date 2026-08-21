/**
 * Testes das regras do chat.
 *
 * O que está coberto aqui é justamente o que o servidor e o cliente precisam
 * concordar: nome de sala, corte de texto e janela de presença. Se essas três
 * divergirem, o sintoma no app é "mandei e não apareceu" ou "estou online mas
 * não estou na lista" — bugs caros de diagnosticar em produção.
 */
import { describe, expect, it } from 'vitest';
import {
  CHAT_TEXT_MAX,
  GENERAL_ROOM,
  GROUP_WINDOW_MS,
  PRESENCE_WINDOW_MS,
  formatClockTime,
  formatRelativeTime,
  isPresenceOnline,
  isValidRoomName,
  parseRoomName,
  presenceCutoff,
  salaDireta,
  sanitizeMessageText,
  shouldGroupWithPrevious,
  spotRoomName,
} from './chat';

describe('nome de sala', () => {
  it('aceita a sala geral', () => {
    expect(parseRoomName(GENERAL_ROOM)).toEqual({ kind: 'geral' });
    expect(isValidRoomName('geral')).toBe(true);
  });

  it('aceita sala de spot e devolve o id', () => {
    expect(parseRoomName('spot:ponta-do-mel')).toEqual({
      kind: 'spot',
      spotId: 'ponta-do-mel',
    });
    expect(parseRoomName('spot:taiba_secret')).toEqual({
      kind: 'spot',
      spotId: 'taiba_secret',
    });
  });

  it('spotRoomName e parseRoomName são inversos', () => {
    for (const id of ['ponta-do-mel', 'galinhos', 'barra-grande-pi']) {
      expect(parseRoomName(spotRoomName(id))).toEqual({ kind: 'spot', spotId: id });
    }
  });

  it('rejeita qualquer outro formato', () => {
    // `room` é coluna TEXT livre no banco: sem esta barreira, qualquer string
    // criaria uma sala que nenhuma tela do app consegue abrir depois.
    const invalidas = [
      '',
      'GERAL',
      'Geral',
      'spot',
      'spot:',
      'spot::x',
      'spot:ponta do mel', // espaço
      'spot:ponta.do.mel', // ponto
      'spot:../etc/passwd',
      "spot:x'; DROP TABLE chat_messages;--",
      'privado:alguem',
      'geral ',
      ' geral',
      'spot:' + 'a'.repeat(65), // acima de 64 caracteres
    ];
    for (const raw of invalidas) {
      expect(parseRoomName(raw), `deveria rejeitar: ${JSON.stringify(raw)}`).toBeNull();
      expect(isValidRoomName(raw)).toBe(false);
    }
  });

  it('rejeita o que não é string', () => {
    for (const raw of [null, undefined, 42, {}, [], true, { kind: 'geral' }]) {
      expect(parseRoomName(raw)).toBeNull();
    }
  });

  it('aceita id de spot no limite de 64 caracteres', () => {
    const id = 'a'.repeat(64);
    expect(parseRoomName(`spot:${id}`)).toEqual({ kind: 'spot', spotId: id });
  });
});

describe('DM (conversa direta)', () => {
  const idA = '11111111-1111-1111-1111-111111111111';
  const idB = '22222222-2222-2222-2222-222222222222';

  it('salaDireta produz a mesma sala não importa a ordem dos argumentos', () => {
    expect(salaDireta(idA, idB)).toBe(`dm:${idA}:${idB}`);
    expect(salaDireta(idB, idA)).toBe(`dm:${idA}:${idB}`);
  });

  it('salaDireta rejeita DM consigo mesmo', () => {
    expect(salaDireta(idA, idA)).toBeNull();
    // Mesma checagem precisa valer com caixa diferente — é o mesmo usuário.
    expect(salaDireta(idA, idA.toUpperCase())).toBeNull();
  });

  it('salaDireta normaliza para minúsculas', () => {
    expect(salaDireta(idA.toUpperCase(), idB)).toBe(`dm:${idA}:${idB}`);
  });

  it('parseRoomName aceita dm:<menor>:<maior> na ordem canônica', () => {
    expect(parseRoomName(`dm:${idA}:${idB}`)).toEqual({ kind: 'dm', userIdA: idA, userIdB: idB });
    expect(isValidRoomName(`dm:${idA}:${idB}`)).toBe(true);
  });

  it('parseRoomName E salaDireta são inversos (roundtrip)', () => {
    const sala = salaDireta(idA, idB);
    expect(sala).not.toBeNull();
    expect(parseRoomName(sala)).toEqual({ kind: 'dm', userIdA: idA, userIdB: idB });
  });

  it('parseRoomName rejeita a ordem trocada — não normaliza, trata como sala inválida', () => {
    // Ver o comentário de DM_ROOM_RE em lib/chat.ts: aceitar as duas ordens
    // deixaria a mesma conversa gravada sob duas strings de room diferentes.
    expect(parseRoomName(`dm:${idB}:${idA}`)).toBeNull();
  });

  it('parseRoomName rejeita DM consigo mesmo mesmo que o formato bata', () => {
    expect(parseRoomName(`dm:${idA}:${idA}`)).toBeNull();
  });

  it('parseRoomName rejeita formato malformado', () => {
    const invalidas = [
      'dm:',
      'dm:sozinho',
      `dm:${idA}`,
      `dm:${idA}:${idB}:extra`,
      `dm:${idA}:naoehuuid`,
      `DM:${idA}:${idB}`, // prefixo maiúsculo não é reconhecido, igual a GERAL/Geral
      `dm:${idA} :${idB}`, // espaço
    ];
    for (const raw of invalidas) {
      expect(parseRoomName(raw), `deveria rejeitar: ${JSON.stringify(raw)}`).toBeNull();
    }
  });
});

describe('sanitização do texto', () => {
  it('faz trim e aceita mensagem normal', () => {
    const r = sanitizeMessageText('  vento entrando forte  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('vento entrando forte');
  });

  it('rejeita vazio e só espaço em branco', () => {
    for (const raw of ['', '   ', '\t\t', '\n\n', ' \t \n ']) {
      const r = sanitizeMessageText(raw);
      expect(r.ok, `deveria rejeitar: ${JSON.stringify(raw)}`).toBe(false);
    }
  });

  it('rejeita mensagem feita só de caracteres de controle invisíveis', () => {
    // Sem isso um cliente conseguiria inserir uma "mensagem vazia" que passa o
    // CHECK do banco (length >= 1) e aparece como balão em branco na conversa.
    const r = sanitizeMessageText('\u0000\u0001\u0007\u007F');
    expect(r.ok).toBe(false);
  });

  it('preserva quebra de linha e tabulação dentro da mensagem', () => {
    const r = sanitizeMessageText('linha 1\nlinha 2\tfim');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('linha 1\nlinha 2\tfim');
  });

  it('aceita exatamente no limite e rejeita um caractere acima', () => {
    const noLimite = sanitizeMessageText('a'.repeat(CHAT_TEXT_MAX));
    expect(noLimite.ok).toBe(true);

    const acima = sanitizeMessageText('a'.repeat(CHAT_TEXT_MAX + 1));
    expect(acima.ok).toBe(false);
    if (!acima.ok) expect(acima.error).toContain(String(CHAT_TEXT_MAX));
  });

  it('o trim conta antes do limite: espaço extra não estoura a mensagem', () => {
    const r = sanitizeMessageText('   ' + 'a'.repeat(CHAT_TEXT_MAX) + '   ');
    expect(r.ok).toBe(true);
  });

  it('rejeita o que não é string', () => {
    for (const raw of [null, undefined, 42, {}, [], true]) {
      expect(sanitizeMessageText(raw).ok).toBe(false);
    }
  });

  it('não escapa HTML — quem escapa é o React na renderização', () => {
    // Se escapássemos aqui, o velejador veria `&lt;b&gt;` literal no balão.
    const r = sanitizeMessageText('<b>vento</b> & cia');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('<b>vento</b> & cia');
  });
});

describe('hora relativa', () => {
  const agora = new Date('2026-08-16T12:00:00Z');

  it('menos de um minuto vira "agora"', () => {
    expect(formatRelativeTime(new Date('2026-08-16T11:59:31Z'), agora)).toBe('agora');
    expect(formatRelativeTime(agora, agora)).toBe('agora');
  });

  it('minutos', () => {
    expect(formatRelativeTime(new Date('2026-08-16T11:57:00Z'), agora)).toBe('há 3 min');
    expect(formatRelativeTime(new Date('2026-08-16T11:01:00Z'), agora)).toBe('há 59 min');
  });

  it('horas', () => {
    expect(formatRelativeTime(new Date('2026-08-16T09:00:00Z'), agora)).toBe('há 3 h');
    expect(formatRelativeTime(new Date('2026-08-15T13:00:00Z'), agora)).toBe('há 23 h');
  });

  it('dias', () => {
    expect(formatRelativeTime(new Date('2026-08-14T12:00:00Z'), agora)).toBe('há 2 d');
    expect(formatRelativeTime(new Date('2026-08-10T12:00:00Z'), agora)).toBe('há 6 d');
  });

  it('acima de uma semana cai para data curta', () => {
    const saida = formatRelativeTime(new Date('2026-07-04T12:00:00Z'), agora);
    expect(saida).toMatch(/^\d{2}\/\d{2}$/);
  });

  it('relógio adiantado no celular não produz "há -3 min"', () => {
    // O velejador não tem como consertar o relógio dele na praia; texto
    // negativo só pareceria bug do app.
    const futuro = new Date('2026-08-16T12:05:00Z');
    expect(formatRelativeTime(futuro, agora)).toBe('agora');
  });

  it('data inválida devolve string vazia em vez de "Invalid Date"', () => {
    expect(formatRelativeTime('não é data', agora)).toBe('');
  });

  it('aceita string ISO igual a Date', () => {
    expect(formatRelativeTime('2026-08-16T11:57:00Z', agora)).toBe('há 3 min');
  });
});

describe('hora do relógio', () => {
  it('formata com dois dígitos', () => {
    const d = new Date(2026, 7, 16, 7, 5);
    expect(formatClockTime(d)).toBe('07:05');
  });

  it('data inválida devolve string vazia', () => {
    expect(formatClockTime('lixo')).toBe('');
  });
});

describe('janela de presença', () => {
  const agora = new Date('2026-08-16T12:00:00Z');

  it('a janela é de 2 minutos', () => {
    expect(PRESENCE_WINDOW_MS).toBe(120_000);
  });

  it('visto agora está online', () => {
    expect(isPresenceOnline(agora, agora)).toBe(true);
  });

  it('visto dentro da janela está online', () => {
    // Um heartbeat de 30s perdido no 3G ainda cabe aqui.
    for (const segundos of [1, 30, 60, 90, 119]) {
      const visto = new Date(agora.getTime() - segundos * 1000);
      expect(isPresenceOnline(visto, agora), `${segundos}s atrás`).toBe(true);
    }
  });

  it('visto fora da janela está offline', () => {
    for (const segundos of [121, 180, 600, 86_400]) {
      const visto = new Date(agora.getTime() - segundos * 1000);
      expect(isPresenceOnline(visto, agora), `${segundos}s atrás`).toBe(false);
    }
  });

  it('a borda exata da janela conta como offline', () => {
    const naBorda = new Date(agora.getTime() - PRESENCE_WINDOW_MS);
    expect(isPresenceOnline(naBorda, agora)).toBe(false);

    const umMsAntesDaBorda = new Date(agora.getTime() - PRESENCE_WINDOW_MS + 1);
    expect(isPresenceOnline(umMsAntesDaBorda, agora)).toBe(true);
  });

  it('relógio adiantado continua online, não vira ausência', () => {
    const futuro = new Date(agora.getTime() + 60_000);
    expect(isPresenceOnline(futuro, agora)).toBe(true);
  });

  it('data inválida é offline (não dá para afirmar presença)', () => {
    expect(isPresenceOnline('não é data', agora)).toBe(false);
  });

  it('presenceCutoff e isPresenceOnline concordam', () => {
    // O SQL filtra por presenceCutoff() e a UI decide o pontinho verde por
    // isPresenceOnline(): as duas precisam classificar igual, senão aparece
    // gente cinza na lista de online.
    const cutoff = presenceCutoff(agora);
    expect(cutoff.getTime()).toBe(agora.getTime() - PRESENCE_WINDOW_MS);

    for (const segundos of [0, 60, 119, 120, 121, 300]) {
      const visto = new Date(agora.getTime() - segundos * 1000);
      const passaNoSql = visto.getTime() > cutoff.getTime();
      expect(isPresenceOnline(visto, agora), `${segundos}s atrás`).toBe(passaNoSql);
    }
  });
});

describe('agrupamento de mensagens seguidas', () => {
  const base = '2026-08-16T12:00:00.000Z';
  const msg = (userId: string, createdAt: string) => ({ userId, createdAt });

  it('a primeira mensagem nunca agrupa', () => {
    expect(shouldGroupWithPrevious(null, msg('u1', base))).toBe(false);
    expect(shouldGroupWithPrevious(undefined, msg('u1', base))).toBe(false);
  });

  it('mesmo autor dentro da janela agrupa', () => {
    const depois = new Date(Date.parse(base) + 60_000).toISOString();
    expect(shouldGroupWithPrevious(msg('u1', base), msg('u1', depois))).toBe(true);
  });

  it('autor diferente nunca agrupa', () => {
    const depois = new Date(Date.parse(base) + 1_000).toISOString();
    expect(shouldGroupWithPrevious(msg('u1', base), msg('u2', depois))).toBe(false);
  });

  it('mesmo autor fora da janela não agrupa', () => {
    const muitoDepois = new Date(Date.parse(base) + GROUP_WINDOW_MS + 1_000).toISOString();
    expect(shouldGroupWithPrevious(msg('u1', base), msg('u1', muitoDepois))).toBe(false);
  });

  it('data inválida não agrupa em vez de quebrar', () => {
    expect(shouldGroupWithPrevious(msg('u1', 'lixo'), msg('u1', base))).toBe(false);
    expect(shouldGroupWithPrevious(msg('u1', base), msg('u1', 'lixo'))).toBe(false);
  });
});
