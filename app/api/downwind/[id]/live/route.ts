import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { HttpError, getSessionUser } from '@/lib/auth';
import { canModerate } from '@/lib/authz';
import { ehUuid, buscarContexto } from '@/lib/downwindDb';
import {
  MSG_DOWNWIND_NAO_ENCONTRADO,
  podeVerReplayAoVivo,
  type DownwindVisibilidade,
} from '@/lib/downwindAcesso';
import { corDoUsuario } from '@/lib/downwindCores';
import {
  amostrarPontos,
  MAX_PONTOS_DELTA_POR_PARTICIPANTE,
  MAX_PONTOS_TRILHA_PROPRIA,
  proximoCursor,
} from '@/lib/trilhaDownwind';

/**
 * Ponto do mapa ao vivo: `[lat, lng, velocidade, tsMs]`. Difere de
 * `PontoTrilha` (3 elementos) porque esta tela colore a trilha por velocidade.
 * O timestamp fica no índice 3 — é o que se passa aos helpers genéricos.
 */
type PontoLive = [lat: number, lng: number, speedKnots: number, tsMs: number];
const TS = (p: PontoLive) => p[3];

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, ctx: Params) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!ehUuid(id)) throw new HttpError(404, 'Downwind não encontrado.');

    // 1. Busca dados do downwind e spots de origem/destino
    const dwRows = await sql`
      SELECT 
        d.id, d.nome, d.status, d.visibilidade, d.iniciado_em, d.encerrado_em,
        d.distancia_estimada_km,
        s_origem.name AS origem_spot_nome, s_origem.lat AS origem_lat, s_origem.lng AS origem_lng,
        s_destino.name AS destino_spot_nome, s_destino.lat AS destino_lat, s_destino.lng AS destino_lng
      FROM downwinds d
      LEFT JOIN spots s_origem ON s_origem.id = d.origem_spot_id
      LEFT JOIN spots s_destino ON s_destino.id = d.destino_spot_id
      WHERE d.id = ${id}
      LIMIT 1
    `;

    if (dwRows.length === 0) {
      throw new HttpError(404, 'Downwind não encontrado.');
    }

    const dw = dwRows[0] as Record<string, unknown>;

    /*
     * Trava de visibilidade. Precisa vir ANTES de qualquer query de posição:
     * daqui para baixo tudo que se lê é rastro de gente real.
     *
     * Esta rota era pública sem checagem nenhuma — lia `visibilidade`,
     * devolvia o valor no payload e nunca o verificava. Ver o comentário de
     * `podeVerReplayAoVivo` em lib/downwindAcesso.ts para o achado completo.
     *
     * 404 e não 403 para quem não pode ver: mesma regra do resto do domínio de
     * downwind — a resposta não confirma que o downwind existe.
     */
    const visibilidade = (String(dw.visibilidade || 'privado') === 'comunidade'
      ? 'comunidade'
      : 'privado') as DownwindVisibilidade;

    if (visibilidade !== 'comunidade') {
      const user = await getSessionUser();
      if (!user) throw new HttpError(404, MSG_DOWNWIND_NAO_ENCONTRADO);

      // Convidado do link de 12h só enxerga o downwind ao qual foi escopado.
      if (user.guestDownwindId && user.guestDownwindId !== id) {
        throw new HttpError(404, MSG_DOWNWIND_NAO_ENCONTRADO);
      }

      const { participacao } = await buscarContexto(id, user.id);
      const permitido = podeVerReplayAoVivo({
        visibilidade,
        participacao,
        ehModerador: canModerate(user.role),
      });
      if (!permitido) throw new HttpError(404, MSG_DOWNWIND_NAO_ENCONTRADO);
    }

    // 2. Busca participantes
    const partRows = await sql`
      SELECT 
        dp.user_id, dp.papel, dp.estado, dp.distancia_km, dp.velocidade_max_nos,
        u.name AS user_name, u.avatar_url AS user_avatar_url
      FROM downwind_participantes dp
      JOIN users u ON u.id = dp.user_id
      WHERE dp.downwind_id = ${id}
      ORDER BY dp.criado_em ASC
    `;

    /*
     * 3. Posições — carga inicial amostrada OU delta incremental.
     *
     * Antes esta rota devolvia TODAS as posições da travessia a cada chamada,
     * e o viewer faz poll de 5 em 5 segundos. Numa travessia de 3h com 10
     * velejadores reportando a cada 45s isso dá ~2.400 linhas por resposta,
     * 720 vezes por hora POR ESPECTADOR — e o payload cresce ao longo da
     * travessia, ficando maior justamente no fim, quando mais gente assiste.
     *
     * A rota irmã (`/posicoes`) já resolvia isso com cursor `desde` e teto; a
     * tela nova reimplementou o problema sem reaproveitar a solução ao lado.
     * Agora as duas usam o mesmo lib/trilhaDownwind.ts.
     */
    const url = new URL(request.url);
    const desdeRaw = url.searchParams.get('desde');
    const desdeMs = desdeRaw ? Date.parse(desdeRaw) : NaN;
    const desde = Number.isFinite(desdeMs) ? new Date(desdeMs) : null;

    const totalParticipantes = Math.max(1, partRows.length);
    // Teto do delta proporcional ao grupo: o limite existe por participante,
    // mas a query traz todo mundo de uma vez.
    const tetoDelta = MAX_PONTOS_DELTA_POR_PARTICIPANTE * totalParticipantes;

    const posRows = desde
      ? await sql`
          SELECT
            user_id, lat, lng, velocidade_nos, direcao_graus, bateria_pct,
            EXTRACT(EPOCH FROM registrado_em) * 1000 AS ts_ms,
            registrado_em
          FROM downwind_posicoes
          WHERE downwind_id = ${id} AND registrado_em > ${desde.toISOString()}
          ORDER BY registrado_em ASC
          LIMIT ${tetoDelta}
        `
      : await sql`
          SELECT
            user_id, lat, lng, velocidade_nos, direcao_graus, bateria_pct,
            EXTRACT(EPOCH FROM registrado_em) * 1000 AS ts_ms,
            registrado_em
          FROM downwind_posicoes
          WHERE downwind_id = ${id}
          ORDER BY registrado_em ASC
        `;

    // O delta bateu no teto: sobraram pontos por entregar. O cursor não pode
    // saltar para "agora" — ver proximoCursor em lib/trilhaDownwind.ts.
    const parcial = desde !== null && posRows.length >= tetoDelta;

    /*
     * Última posição por participante vem de query PRÓPRIA, não do lote de
     * posições acima.
     *
     * Isto é obrigatório desde que a rota virou incremental: num delta só
     * aparecem os participantes que reportaram naquele intervalo, então
     * derivar a última posição do lote deixaria todo mundo que ficou quieto
     * com `ultimaPosicao: null` — e o marcador dessas pessoas SUMIRIA do mapa
     * a cada poll, justamente de quem parou de reportar, que é quem mais
     * importa vigiar numa travessia.
     *
     * LEFT JOIN LATERAL devolve exatamente uma linha por participante (ou
     * nenhuma posição, com nulos) — mesmo padrão de /api/downwind/[id]/posicoes.
     */
    const ultimasRows = await sql`
      SELECT dp.user_id, p.lat, p.lng, p.velocidade_nos, p.direcao_graus,
             p.bateria_pct, p.registrado_em
      FROM downwind_participantes dp
      LEFT JOIN LATERAL (
        SELECT lat, lng, velocidade_nos, direcao_graus, bateria_pct, registrado_em
        FROM downwind_posicoes
        WHERE downwind_id = dp.downwind_id AND user_id = dp.user_id
        ORDER BY registrado_em DESC LIMIT 1
      ) p ON TRUE
      WHERE dp.downwind_id = ${id}
    `;

    // Agrupa trilhas do lote (carga inicial ou delta)
    const trilhas: Record<string, PontoLive[]> = {};
    const ultimasPosicoes: Record<
      string,
      {
        lat: number;
        lng: number;
        speedKnots: number;
        heading: number | null;
        registradoEm: string;
        bateriaPct?: number;
      }
    > = {};

    for (const p of posRows as Record<string, unknown>[]) {
      const uId = String(p.user_id);
      const lat = Number(p.lat);
      const lng = Number(p.lng);
      const speed = Number(p.velocidade_nos || 0);
      const ts = Number(p.ts_ms);

      if (!trilhas[uId]) trilhas[uId] = [];
      trilhas[uId].push([lat, lng, speed, ts]);
    }

    for (const r of ultimasRows as Record<string, unknown>[]) {
      if (r.lat === null || r.lng === null) continue;
      ultimasPosicoes[String(r.user_id)] = {
        lat: Number(r.lat),
        lng: Number(r.lng),
        speedKnots: Number(r.velocidade_nos || 0),
        heading: r.direcao_graus !== null ? Number(r.direcao_graus) : null,
        registradoEm: String(r.registrado_em),
        bateriaPct: r.bateria_pct !== null ? Number(r.bateria_pct) : undefined,
      };
    }

    /*
     * Na carga inicial a trilha inteira é amostrada por participante. O
     * espectador não perde a forma do trajeto (a amostragem é uniforme e
     * SEMPRE preserva o ponto mais recente, que é o que encosta no marcador),
     * e o payload deixa de crescer sem limite com a duração da travessia.
     * No delta não se amostra: são poucos pontos e todos importam.
     */
    if (!desde) {
      for (const uId of Object.keys(trilhas)) {
        trilhas[uId] = amostrarPontos(trilhas[uId], MAX_PONTOS_TRILHA_PROPRIA, TS);
      }
    }

    let maiorTs: number | null = null;
    for (const pontos of Object.values(trilhas)) {
      for (const p of pontos) if (maiorTs === null || TS(p) > maiorTs) maiorTs = TS(p);
    }
    const cursor = proximoCursor(desdeRaw, maiorTs);

    const participantes = (partRows as Record<string, unknown>[]).map((p, idx) => {
      const uId = String(p.user_id);
      return {
        userId: uId,
        name: String(p.user_name),
        avatarUrl: p.user_avatar_url ? String(p.user_avatar_url) : null,
        papel: String(p.papel),
        estado: String(p.estado),
        corHex: corDoUsuario(uId),
        distanciaKm: Number(p.distancia_km || 0),
        velocidadeMaxNos: Number(p.velocidade_max_nos || 0),
        ultimaPosicao: ultimasPosicoes[uId] || null,
      };
    });

    return {
      downwind: {
        id: String(dw.id),
        nome: String(dw.nome || 'Downwind'),
        status: String(dw.status),
        visibilidade: String(dw.visibilidade || 'privado'),
        iniciadoEm: dw.iniciado_em ? String(dw.iniciado_em) : null,
        encerradoEm: dw.encerrado_em ? String(dw.encerrado_em) : null,
        origemSpotNome: dw.origem_spot_nome ? String(dw.origem_spot_nome) : null,
        destinoSpotNome: dw.destino_spot_nome ? String(dw.destino_spot_nome) : null,
        origemLat: dw.origem_lat !== null ? Number(dw.origem_lat) : null,
        origemLng: dw.origem_lng !== null ? Number(dw.origem_lng) : null,
        destinoLat: dw.destino_lat !== null ? Number(dw.destino_lat) : null,
        destinoLng: dw.destino_lng !== null ? Number(dw.destino_lng) : null,
        distanciaEstimadaKm: dw.distancia_estimada_km !== null ? Number(dw.distancia_estimada_km) : null,
      },
      participantes,
      trilhas,
      /** `true` = resposta parcial; o cliente deve pedir de novo já. */
      parcial,
      /** Devolver em `?desde=` no próximo poll para receber só o que é novo. */
      cursor,
      /** `true` quando esta resposta é um delta (o cliente precisa MESCLAR, não substituir). */
      incremental: desde !== null,
    };
  });
}