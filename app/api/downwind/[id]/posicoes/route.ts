import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { getSessionUser, HttpError } from '@/lib/auth';
import { num } from '@/lib/validation';
import { rateLimiters } from '@/lib/rateLimit';
import {
  MSG_DOWNWIND_NAO_ENCONTRADO,
  podeReportarPosicao,
  podeVerPosicoes,
  posicaoVisivel,
} from '@/lib/downwindAcesso';
import { buscarContexto, ehUuid } from '@/lib/downwindDb';
import { amostrarTrilha, MAX_PONTOS_DELTA_POR_PARTICIPANTE as LIMITE_DELTA, ultimoTimestamp } from '@/lib/trilhaDownwind';
import type { PontoTrilha } from '@/lib/trilhaDownwind';
import { validarTokenRastreio } from '@/lib/trackingToken';
import { resolverSilencio } from '@/lib/downwindSilencio';

/**
 * O coração do mapa ao vivo — o ÚNICO endpoint polled desta feature (a regra
 * de custo do docs/PLANO-DOWNWIND-MAPA.md: nunca uma requisição por
 * participante, um único GET devolve todo mundo).
 *
 * AUTORIZAÇÃO SEMPRE ANTES DE QUALQUER QUERY DE POSIÇÃO. É rastreamento de
 * pessoas em tempo real — ver lib/downwindAcesso.ts para o porquê de cada
 * decisão. Não-participante recebe 404, nunca 403.
 */
export const dynamic = 'force-dynamic';

/** Alvo de amostragem da carga inicial da própria trilha. */
const LIMITE_TRILHA_INICIAL = 120;

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Resolve o usuário aceitando também a sessão de convidado do link de 12h
 * (lib/auth.ts, `SessionUser.guestDownwindId`) — DESDE QUE escopada a ESTE
 * downwind. `requireUser()` não serve aqui: ela rejeita convidado por
 * padrão (o comportamento seguro para as outras ~30 rotas), e mapa+chat do
 * próprio downwind são exatamente os dois lugares que precisam aceitar.
 * Convidado de OUTRO downwind recebe 404, mesma regra de "não confirma
 * existência" de quem simplesmente não participa.
 *
 * Também aceita Bearer token de rastreio (lib/trackingToken.ts) — usado pelo
 * Foreground Service Android quando o app está fechado. O token é escopoado
 * ao downwind, então verificamos isso aqui.
 */
async function resolverUsuario(downwindId: string, bearerToken?: string | null) {
  // Se há Bearer token, tenta validar como token de rastreio
  if (bearerToken) {
    const tokenResult = await validarTokenRastreio(bearerToken, downwindId);
    if (tokenResult) {
      // Token válido: retorna ID do usuário do token
      return { id: tokenResult.userId, isTrackingToken: true };
    }
    // Token inválido: continua para tentar sessão normal
  }

  const user = await getSessionUser();
  if (!user) throw new HttpError(401, 'Não autenticado.');
  if (user.guestDownwindId && user.guestDownwindId !== downwindId) {
    throw new HttpError(404, MSG_DOWNWIND_NAO_ENCONTRADO);
  }
  return { id: user.id, isTrackingToken: false };
}

export async function GET(request: Request, ctx: Params) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!ehUuid(id)) throw new HttpError(404, 'Downwind não encontrado.');
    const usuario = await resolverUsuario(id);

    const { status, participacao } = await buscarContexto(id, usuario.id);
    const acesso = podeVerPosicoes({ statusDownwind: status, participacao });
    if (!acesso.permitido) throw new HttpError(acesso.status, acesso.mensagem);

    const url = new URL(request.url);
    const desdeRaw = url.searchParams.get('desde');
    const desdeMs = desdeRaw ? Date.parse(desdeRaw) : NaN;
    const desde = Number.isFinite(desdeMs) ? new Date(desdeMs) : null;

    if (!acesso.servePosicoes) {
      // Downwind existe e o solicitante participa, mas já acabou (ou ainda não
      // saiu do papel). Não é erro — é o caminho normal de "o organizador
      // encerrou enquanto eu estava com a tela aberta". O cliente desmonta o
      // takeover ao ver `servePosicoes: false`.
      return {
        downwind: { id, status, servePosicoes: false },
        euSou: participacao,
        participantes: [],
        trilha: [] as PontoTrilha[],
        cursor: null,
      };
    }

    // Participantes + última posição. LEFT JOIN LATERAL, não DISTINCT ON:
    // participante que NUNCA reportou tem que aparecer na lista (lat nulo),
    // não sumir dela — é o que faz "quem ainda não reportou" ser visível.
    const linhas = await sql`
      SELECT dp.user_id, u.name, u.avatar_url, dp.papel, dp.eh_organizador, dp.estado,
             dp.apoio_user_id, p.lat, p.lng, p.accuracy_m, p.registrado_em
      FROM downwind_participantes dp
      JOIN users u ON u.id = dp.user_id
      LEFT JOIN LATERAL (
        SELECT lat, lng, accuracy_m, registrado_em
        FROM downwind_posicoes
        WHERE downwind_id = dp.downwind_id AND user_id = dp.user_id
        ORDER BY registrado_em DESC LIMIT 1
      ) p ON TRUE
      WHERE dp.downwind_id = ${id}
    `;

    const meuApoioId = participacao?.apoioUserId ?? null;

    const participantes = linhas.map((row) => {
      const r = row as Record<string, unknown>;
      const userId = String(r.user_id);
      const estado = String(r.estado) as 'confirmado' | 'navegando' | 'encerrado' | 'desistiu';
      const visivel = posicaoVisivel(estado);
      return {
        userId,
        nome: String(r.name),
        avatarUrl: r.avatar_url ? String(r.avatar_url) : null,
        papel: r.papel as 'velejador' | 'apoio_terra',
        ehOrganizador: Boolean(r.eh_organizador),
        estado,
        // Posição de quem já saiu da água não é servida a ninguém — nem à
        // própria pessoa: ela vê seu último ponto de outro jeito (o Modo
        // Navegação, enquanto ainda estava navegando).
        lat: visivel && r.lat !== null ? Number(r.lat) : null,
        lng: visivel && r.lng !== null ? Number(r.lng) : null,
        accuracyM: visivel && r.accuracy_m !== null ? Number(r.accuracy_m) : null,
        registradoEm:
          visivel && r.registrado_em ? new Date(String(r.registrado_em)).toISOString() : null,
        // Calculado no servidor: o cliente não deveria montar esse cruzamento,
        // e centralizar evita a tela do velejador e a do motorista divergirem.
        ehMeuApoio: meuApoioId !== null && userId === meuApoioId,
        souApoioDele: String(r.apoio_user_id ?? '') === usuario.id,
      };
    });

    // Trilha: só a do PRÓPRIO solicitante. O dono decidiu não mostrar o
    // trajeto de terceiros no mapa — vinte trilhas cruzadas viram sopa visual
    // e escondem justamente quem está para trás, e uma faixa de texto já
    // responde "quem está mais atrás" sem precisar desenhar a rota de todo
    // mundo (ver DownwindFaixaInfo). Continua vindo aqui, e não de uma rota
    // separada, para caber no mesmo poll — ver lib/trilhaDownwind.ts sobre o
    // custo de um segundo endpoint no plano gratuito.
    let trilha: PontoTrilha[] = [];
    let cursor: string | null = null;

    if (posicaoVisivel(participacao!.estado)) {
      if (desde) {
        const delta = await sql`
          SELECT lat, lng, registrado_em
          FROM downwind_posicoes
          WHERE downwind_id = ${id} AND user_id = ${usuario.id} AND registrado_em > ${desde.toISOString()}
          ORDER BY registrado_em ASC
          LIMIT ${LIMITE_DELTA}
        `;
        trilha = delta.map((r) => {
          const row = r as Record<string, unknown>;
          return [Number(row.lat), Number(row.lng), Date.parse(String(row.registrado_em))] as PontoTrilha;
        });
      } else {
        const bruta = await sql`
          SELECT lat, lng, registrado_em
          FROM downwind_posicoes
          WHERE downwind_id = ${id} AND user_id = ${usuario.id}
          ORDER BY registrado_em ASC
        `;
        const pontos = bruta.map((r) => {
          const row = r as Record<string, unknown>;
          return [Number(row.lat), Number(row.lng), Date.parse(String(row.registrado_em))] as PontoTrilha;
        });
        trilha = amostrarTrilha(pontos, LIMITE_TRILHA_INICIAL);
      }

      const ultimo = ultimoTimestamp(trilha);
      cursor = ultimo !== null ? new Date(ultimo).toISOString() : desdeRaw;
    }

    return {
      downwind: { id, status, servePosicoes: true },
      euSou: participacao,
      participantes,
      trilha,
      cursor,
    };
  });
}

/**
 * Valida e normaliza timestamp de registro de posição.
 *
 * O POST aceita `registradoEm` opcional para permitir que o app nativo (foreground
 * service) reporte posições coletadas offline com o timestamp de quando foram
 * coletadas, não de quando a rede permitiu o envio.
 *
 * Rejeita:
 * - timestamp no futuro (relógio desconfigurado)
 * - timestamp mais velho que 9 horas (fora do teto nativo de 8h + margem de drenagem/relógio)
 *
 * Retorna Date válido ou null (usa default do banco).
 */
function validarRegistroEm(raw: unknown): Date | null {
  if (!raw) return null;

  if (typeof raw !== 'string' && typeof raw !== 'number') return null;

  let ts: number;
  if (typeof raw === 'number') {
    ts = raw;
  } else {
    ts = Date.parse(raw);
  }
  if (!Number.isFinite(ts)) return null;

  const agora = Date.now();
  // O serviço nativo pode coletar por até 8h sem rede. Uma hora adicional
  // cobre a drenagem e pequena divergência de relógio sem aceitar trilha antiga.
  const noveHorasMs = 9 * 60 * 60 * 1000;

  // Rejeita timestamp no futuro
  if (ts > agora) return null;
  // Rejeita pontos fora do teto operacional do rastreador
  if (agora - ts > noveHorasMs) return null;

  return new Date(ts);
}

export async function POST(request: Request, ctx: Params) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!ehUuid(id)) throw new HttpError(404, 'Downwind não encontrado.');

    // Extrai Bearer token do header Authorization
    const authHeader = request.headers.get('Authorization');
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    const usuario = await resolverUsuario(id, bearerToken);

    const { status, participacao } = await buscarContexto(id, usuario.id);
    const acesso = podeReportarPosicao({ statusDownwind: status, participacao });
    if (!acesso.permitido) throw new HttpError(acesso.status, acesso.mensagem);

    rateLimiters.downwindPosicao(usuario.id);

    const body = await readJson(request);
    const lat = num(body, 'lat', { min: -90, max: 90 });
    const lng = num(body, 'lng', { min: -180, max: 180 });
    const accuracyM = num(body, 'accuracyM', { optional: true, min: 0, max: 100000 });

    // registradoEm: timestamp opcional para o app nativo (foreground service)
    const registradoEm = validarRegistroEm((body as Record<string, unknown>)?.registradoEm);

    /*
     * Duas queries, e não uma com `${registradoEm ?? sql`DEFAULT`}`.
     *
     * O driver HTTP do Neon NÃO compõe fragmentos: um `sql\`DEFAULT\``
     * aninhado não vira SQL, vira VALOR de parâmetro — a query saía com
     * `values: [..., {queryData:{strings:['DEFAULT'],values:[]}}]` e o
     * Postgres respondia "Invalid input for date type". Ou seja: TODO POST
     * sem `registradoEm` (isto é, todo envio do beacon web) devolvia 500 e
     * NENHUMA posição era gravada — enquanto o app nativo, que sempre manda
     * o campo, passava pelo outro ramo e funcionava. Um bug que só aparecia
     * de um dos dois lados.
     *
     * Omitir a coluna deixa o DEFAULT NOW() da tabela agir (lib/schema.sql),
     * que é exatamente o comportamento pretendido.
     */
    const inserted = registradoEm
      ? await sql`
          INSERT INTO downwind_posicoes (downwind_id, user_id, lat, lng, accuracy_m, registrado_em)
          VALUES (${id}, ${usuario.id}, ${lat}, ${lng}, ${accuracyM}, ${registradoEm.toISOString()})
          RETURNING registrado_em
        `
      : await sql`
          INSERT INTO downwind_posicoes (downwind_id, user_id, lat, lng, accuracy_m)
          VALUES (${id}, ${usuario.id}, ${lat}, ${lng}, ${accuracyM})
          RETURNING registrado_em
        `;

    // Resolve silêncio ativo se houver (aposição foi recebida, o velejador voltou a reportar)
    // Fire-and-forget: não bloqueia a resposta se falhar
    resolverSilencio(id, usuario.id).catch((err) => {
      console.error('[downwind-posicoes] Erro ao resolver silêncio:', err);
    });

    return {
      ok: true,
      registradoEm: new Date(String((inserted[0] as Record<string, unknown>).registrado_em)).toISOString(),
    };
  });
}
