/**
 * Rate limiting com janela deslizante (sliding window), em dois sabores.
 *
 * `enforceRateLimit` guarda o estado num Map do processo — barato, e correto
 * só quando o alvo é um cliente em laço de erro. `enforceRateLimitCompartilhado`
 * guarda no Postgres, e é o que de fato barra força bruta na Vercel, onde cada
 * instância teria o seu próprio Map. Qual usar em cada rota está em
 * `rateLimiters`, no fim do arquivo, com o porquê de cada escolha.
 */
import { HttpError } from './errors';


interface RateLimitRecord {
  timestamps: number[];
}

const store = new Map<string, RateLimitRecord>();

// Limpeza periódica de entradas expiradas para não acumular memória
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, record] of store.entries()) {
    record.timestamps = record.timestamps.filter((t) => now - t < windowMs);
    if (record.timestamps.length === 0) {
      store.delete(key);
    }
  }
}

/**
 * Avalia o limite de taxa para uma chave.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  cleanup(windowMs);

  const record = store.get(key) || { timestamps: [] };
  // Filtra apenas requisições dentro da janela atual
  record.timestamps = record.timestamps.filter((t) => now - t < windowMs);

  if (record.timestamps.length >= maxRequests) {
    const oldest = record.timestamps[0];
    const resetMs = Math.max(0, windowMs - (now - oldest));
    return {
      allowed: false,
      remaining: 0,
      resetMs,
    };
  }

  record.timestamps.push(now);
  store.set(key, record);

  return {
    allowed: true,
    remaining: maxRequests - record.timestamps.length,
    resetMs: windowMs,
  };
}

/**
 * Exige cumprimento do rate limit; lança HttpError(429) se estourar o teto.
 */
export function enforceRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
  customMessage?: string
): void {
  const { allowed, resetMs } = checkRateLimit(key, maxRequests, windowMs);
  if (!allowed) {
    const minutes = Math.ceil(resetMs / 60000);
    throw new HttpError(
      429,
      customMessage ||
        `Muitas tentativas. Aguarde ${minutes} minuto(s) antes de tentar novamente.`
    );
  }
}

/**
 * Rate limit que vale para o app inteiro, não para uma instância serverless.
 *
 * POR QUE ESTA FUNÇÃO EXISTE, ALÉM DA DE CIMA
 *
 * `checkRateLimit` guarda as tentativas num `Map` do processo. Na Vercel isso
 * significa um contador por instância: requisições paralelas caem em
 * instâncias diferentes, cada uma começa do zero, e o teto de 5 tentativas de
 * login nunca é atingido por quem ataca em paralelo. O limite existia e não
 * protegia.
 *
 * Aqui o estado mora no Postgres, então o teto é do app. O custo é um
 * ida-e-volta ao banco — aceitável nas rotas de porta aberta, que são
 * esporádicas, e caro demais nas rotas por-usuário de alta frequência (uma
 * posição de GPS a cada 45s). Por isso as duas funções convivem: veja o
 * comentário de `rate_limit_tentativas` em lib/schema.sql para a divisão.
 *
 * TUDO EM UMA IDA SÓ: a CTE conta as tentativas vivas e só insere a nova se a
 * contagem ainda estiver abaixo do teto. Sem transação (o driver HTTP do Neon
 * não compõe), mas atômico dentro do statement. Duas requisições exatamente
 * simultâneas podem passar uma a mais que o teto; para barrar força bruta isso
 * é irrelevante — o que importa é que a 200ª tentativa não passe, e ela não
 * passa.
 *
 * FALHA ABERTA, DE PROPÓSITO: se a consulta der erro, cai no limitador em
 * memória em vez de estourar. Um erro transitório no banco não pode impedir
 * todo mundo de entrar no app — e a proteção degradada ainda é melhor que
 * nenhuma. Note que, se o banco estiver mesmo fora, o login falharia adiante
 * de qualquer jeito: ele precisa consultar `users`.
 */
export async function enforceRateLimitCompartilhado(
  key: string,
  maxRequests: number,
  windowMs: number,
  customMessage?: string
): Promise<void> {
  const expiraEm = new Date(Date.now() + windowMs);

  let permitido: boolean;
  try {
    // Import sob demanda: `lib/db.ts` estoura na carga do modulo quando
    // DATABASE_URL nao existe, e este arquivo tambem e usado por testes de
    // unidade do limitador em memoria, que rodam sem banco nenhum.
    const { sql } = await import('./db');
    const linhas = await sql`
      WITH atuais AS (
        SELECT COUNT(*)::int AS n
        FROM rate_limit_tentativas
        WHERE chave = ${key} AND expira_em > NOW()
      ),
      inserida AS (
        INSERT INTO rate_limit_tentativas (chave, expira_em)
        SELECT ${key}, ${expiraEm.toISOString()}
        FROM atuais
        WHERE atuais.n < ${maxRequests}
        RETURNING 1
      )
      SELECT EXISTS (SELECT 1 FROM inserida) AS permitido
    `;
    permitido = Boolean((linhas[0] as Record<string, unknown> | undefined)?.permitido);
  } catch {
    // Banco indisponível: degrada para o teto por instância em vez de barrar
    // todo mundo. Ver o parágrafo "FALHA ABERTA" acima.
    enforceRateLimit(key, maxRequests, windowMs, customMessage);
    return;
  }

  // Expurgo preguiçoso: a Vercel no plano Hobby não tem cron sub-diário, então
  // a limpeza pega carona numa requisição que já pagou a viagem ao banco. Roda
  // no máximo a cada CLEANUP_INTERVAL_MS e nunca bloqueia a resposta.
  if (Date.now() - ultimoExpurgoCompartilhado > CLEANUP_INTERVAL_MS) {
    ultimoExpurgoCompartilhado = Date.now();
    void import('./db')
      .then(({ sql }) => sql`DELETE FROM rate_limit_tentativas WHERE expira_em <= NOW()`)
      .catch(() => {});
  }

  if (!permitido) {
    const minutos = Math.ceil(windowMs / 60000);
    throw new HttpError(
      429,
      customMessage ||
        `Muitas tentativas. Aguarde ${minutos} minuto(s) antes de tentar novamente.`
    );
  }
}

let ultimoExpurgoCompartilhado = 0;

/** Helpers semânticos para as rotas sensíveis do KiteNinja */
export const rateLimiters = {
  // Os três primeiros são de porta aberta (sem sessão) e por isso usam o teto
  // compartilhado no banco: é neles que força bruta acontece.
  login: (identifier: string) =>
    enforceRateLimitCompartilhado(
      `login:${identifier.toLowerCase()}`,
      5,
      15 * 60 * 1000,
      'Muitas tentativas de login incorretas. Conta temporariamente bloqueada por 15 minutos para sua segurança.'
    ),

  invite: (ipOrToken: string) =>
    enforceRateLimitCompartilhado(
      `invite:${ipOrToken}`,
      10,
      60 * 60 * 1000,
      'Limite de validações de convite excedido. Tente novamente mais tarde.'
    ),

  passwordReset: (identifier: string) =>
    enforceRateLimitCompartilhado(
      `pwd_reset:${identifier.toLowerCase()}`,
      3,
      60 * 60 * 1000,
      'Limite de solicitações de recuperação de senha excedido. Aguarde 1 hora.'
    ),

  // Daqui para baixo, tudo exige sessão e o alvo é cliente em laço de erro,
  // não força bruta. Continuam em memória: barato e suficiente.
  sos: (userId: string) =>
    enforceRateLimit(
      `sos:${userId}`,
      3,
      60 * 60 * 1000,
      'Limite de chamadas SOS atingido. Aguarde 1 hora — ligue 193 (Bombeiros) ou 185 (Marinha) se precisar de socorro imediato.'
    ),

  // Atualização de posição de SOS ativo. Mais permissivo que criação (60/min)
  // porque o velejador deriva no mar e precisa poder atualizar coordenadas
  // sem ser bloqueado. Este limite só é atingido em loop de erro no cliente.
  sosUpdate: (userId: string) =>
    enforceRateLimit(
      `sos_update:${userId}`,
      60,
      60 * 1000,
      'Muitas atualizações de posição. Tente novamente em 1 minuto.'
    ),

  // "Entrei na água" (POST /api/velejos/inicio). Folgado de propósito: quem
  // protege os seguidores de aviso repetido é a janela de 3h em
  // lib/avisoVelejo.ts, não este teto. Aqui o alvo é outro — um cliente em
  // laço de erro batendo na rota. 10/h passa longe do uso real (ninguém entra
  // na água dez vezes por hora) e ainda assim tolera o velejador que tocou,
  // perdeu sinal e tocou de novo.
  velejoInicio: (userId: string) =>
    enforceRateLimit(
      `velejo_inicio:${userId}`,
      10,
      60 * 60 * 1000,
      'Muitos avisos de início. Tente novamente mais tarde.'
    ),

  // 120/min é ~40x a cadência normal de POST (a cada 45s — ver
  // lib/trilhaDownwind.ts): só pega cliente em loop de erro, nunca um
  // velejador de verdade.
  downwindPosicao: (userId: string) =>
    enforceRateLimit(`dw_pos:${userId}`, 120, 60 * 1000, 'Muitos envios de posição.'),

  downwindEntrar: (userId: string) =>
    enforceRateLimit(
      `dw_entrar:${userId}`,
      10,
      60 * 1000,
      'Muitas tentativas de entrar no downwind.'
    ),

  downwindCriar: (userId: string) =>
    enforceRateLimit(
      `dw_criar:${userId}`,
      5,
      60 * 60 * 1000,
      'Limite de criação de downwinds excedido. Aguarde 1 hora.'
    ),
};
