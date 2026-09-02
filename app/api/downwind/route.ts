import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser, requireDownwindOrganizer, HttpError } from '@/lib/auth';
import { rateLimiters } from '@/lib/rateLimit';
import { encerrarAbandonados } from '@/lib/downwindSilencio';
import { str } from '@/lib/validation';
import {
  VISIBILIDADE_PADRAO,
  normalizarVisibilidade,
} from '@/lib/downwindVisibilidade';
import { normalizarUf } from '@/lib/uf';

export const dynamic = 'force-dynamic';

/**
 * Lista os downwinds que este velejador pode ver.
 *
 * ESTA ROTA NÃO EXISTIA — e a falta dela era um buraco, não uma omissão de
 * escopo. `GET /api/downwind` devolvia 405. O único jeito de saber que um
 * downwind existia era receber um convite individual, e um downwind
 * `privado` não cria evento, então também não aparecia na aba Eventos.
 *
 * Um velejador criou um downwind, compartilhou o link, e **nem ele mesmo**
 * conseguia ver o que tinha criado. Do ponto de vista do app, o downwind não
 * existia.
 *
 * Quem entra na lista está em `podeListarDownwind` (lib/downwindAcesso.ts),
 * puro e testado: criador, participante, ou downwind da comunidade. As três
 * portas viram um `WHERE` só aqui — a regra em SQL e a regra em TypeScript
 * PRECISAM dizer a mesma coisa, e a função é a fonte da verdade.
 *
 * Não devolve posição nenhuma: isto é a lista, e ver onde as pessoas estão é
 * outra decisão, tomada por `podeVerPosicoes`/`podeVerReplayAoVivo` nas rotas
 * de item.
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();

    /*
     * Encerra as travessias abandonadas ANTES de listar.
     *
     * Isto existe porque depender só do cron não funciona na prática. O
     * `encerrarAbandonados` também roda em /api/cron/downwind-silencio, mas o
     * `schedule` do GitHub Actions entrega uma execução a cada ~4,3 h (medido
     * — ver docs/CRON-EXTERNO-SOS.md). Na vida real isso apareceu assim: um
     * downwind iniciado em 31/08 seguia marcado "Na água agora" no dia 02/09,
     * porque a varredura ainda não tinha passado.
     *
     * Aqui a varredura acontece no momento em que alguém abre a lista — que é
     * exatamente quando o dado errado seria visto. É o mesmo padrão preguiçoso
     * que a purga de trilha e a escalada de SOS já usam nesta base: sem cron
     * confiável no plano gratuito, quem passa pela porta faz a faxina.
     *
     * Não derruba a listagem se falhar: ver um downwind com status velho é
     * ruim, não ver downwind nenhum é pior.
     */
    try {
      await encerrarAbandonados();
    } catch (err) {
      console.error('[downwind] varredura preguiçosa de abandonados falhou', err);
    }

    /*
     * Convidado do link de 12h enxerga só o downwind ao qual foi escopado —
     * mesma trava das rotas de item. Sem isto, um link de apoio em terra
     * viraria uma janela para a lista inteira da comunidade.
     */
    if (user.guestDownwindId) {
      const rows = await sql`
        SELECT d.id, d.nome, d.status, d.visibilidade, d.previsto_para,
               d.iniciado_em, d.encerrado_em, d.criado_em, d.criado_por,
               d.event_id,
               ss.name AS spot_saida_nome, sc.name AS spot_chegada_nome,
               u.name AS criador_nome,
               (SELECT COUNT(*) FROM downwind_participantes dp WHERE dp.downwind_id = d.id)
                 AS participantes_count
        FROM downwinds d
        JOIN users u ON u.id = d.criado_por
        LEFT JOIN spots ss ON ss.id = d.spot_saida
        LEFT JOIN spots sc ON sc.id = d.spot_chegada
        WHERE d.id = ${user.guestDownwindId}
      `;
      return { downwinds: rows.map((r) => paraResumoDownwind(r, user.id)) };
    }

    const rows = await sql`
      SELECT d.id, d.nome, d.status, d.visibilidade, d.previsto_para,
             d.iniciado_em, d.encerrado_em, d.criado_em, d.criado_por,
             d.event_id,
             ss.name AS spot_saida_nome, sc.name AS spot_chegada_nome,
             u.name AS criador_nome,
             (SELECT COUNT(*) FROM downwind_participantes dp WHERE dp.downwind_id = d.id)
               AS participantes_count
      FROM downwinds d
      JOIN users u ON u.id = d.criado_por
      LEFT JOIN spots ss ON ss.id = d.spot_saida
      LEFT JOIN spots sc ON sc.id = d.spot_chegada
      WHERE d.criado_por = ${user.id}
         OR d.visibilidade = 'comunidade'
         OR EXISTS (
              SELECT 1 FROM downwind_participantes dp
              WHERE dp.downwind_id = d.id AND dp.user_id = ${user.id}
            )
      ORDER BY
        -- Em andamento primeiro: é a única categoria em que alguém está na
        -- água agora e a tela pode salvar uma travessia.
        CASE d.status WHEN 'em_andamento' THEN 0 WHEN 'aberto' THEN 1 ELSE 2 END,
        d.previsto_para DESC
      LIMIT ${MAX_DOWNWINDS_LISTADOS}
    `;

    return { downwinds: rows.map((r) => paraResumoDownwind(r, user.id)) };
  });
}

/**
 * Teto da lista. Sem ele, um app com centenas de downwinds da comunidade
 * mandaria a tabela inteira para um celular no meio da praia com 3G.
 */
const MAX_DOWNWINDS_LISTADOS = 100;

function paraResumoDownwind(row: unknown, userId: string) {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    nome: String(r.nome),
    status: String(r.status),
    visibilidade: String(r.visibilidade || 'privado'),
    previstoPara: r.previsto_para ? String(r.previsto_para) : null,
    iniciadoEm: r.iniciado_em ? String(r.iniciado_em) : null,
    encerradoEm: r.encerrado_em ? String(r.encerrado_em) : null,
    criadoEm: String(r.criado_em),
    criadoPorMim: String(r.criado_por) === userId,
    criadorNome: String(r.criador_nome),
    spotSaidaNome: r.spot_saida_nome ? String(r.spot_saida_nome) : null,
    spotChegadaNome: r.spot_chegada_nome ? String(r.spot_chegada_nome) : null,
    participantesCount: Number(r.participantes_count ?? 0),
    eventId: r.event_id ? String(r.event_id) : null,
  };
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson(request);

    const nome = str(body, 'nome', { min: 3, max: 100 });
    const spotSaida = str(body, 'spotSaida', { max: 100 });
    const spotChegada = str(body, 'spotChegada', { optional: true, max: 100 });
    const previstoParaRaw = str(body, 'previstoPara', { optional: true, max: 50 });
    const visibilidadeRaw = str(body, 'visibilidade', { optional: true, max: 20 });
    const visibilidade = visibilidadeRaw
      ? normalizarVisibilidade(visibilidadeRaw)
      : VISIBILIDADE_PADRAO;
    if (visibilidade === null) throw new HttpError(400, 'Visibilidade inválida.');

    if (visibilidade === 'comunidade') {
      await requireDownwindOrganizer();
    } else {
      rateLimiters.downwindCriar(user.id);
    }

    const spotSaidaRows = await sql`SELECT id, name, location, state FROM spots WHERE id = ${spotSaida} LIMIT 1`;
    if (spotSaidaRows.length === 0) throw new HttpError(400, 'Spot de saída inválido.');
    const spotSaidaObj = spotSaidaRows[0] as Record<string, unknown>;
    const spotSaidaName = String(spotSaidaObj.name);
    const spotSaidaLocation = String(spotSaidaObj.location || spotSaidaName);
    const uf = normalizarUf(spotSaidaObj.state);

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
      /*
       * O EVENTO É CRIADO SEMPRE — inclusive para downwind fechado.
       *
       * Antes só nascia quando `comunidade`, e a consequência apareceu na
       * tela do dono: como um downwind privado não tinha evento, precisou
       * existir uma SEGUNDA lista (`ListaDownwinds`) só para ele aparecer
       * para quem o criou. Com as duas listas na mesma aba, todo downwind de
       * comunidade passou a ser desenhado DUAS VEZES, um card em cada.
       *
       * Com evento sempre presente, a agenda vira a única superfície e a
       * segunda lista deixa de existir. A privacidade continua inteira: quem
       * filtra é o WHERE do GET (visibilidade = 'comunidade' OR criador OR
       * participante), não a ausência da linha. E `events` não tem rota de
       * leitura por id — só DELETE —, então a linha extra não abre porta
       * nenhuma.
       */
      const eventDate = previstoPara.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });

      const insertedEvent = await sql`
        INSERT INTO events (
          title, event_date, event_at, location, spot_name, type, description, organizer, uf
        )
        VALUES (
          ${nome}, ${eventDate}, ${previstoPara.toISOString()},
          ${spotSaidaLocation}, ${spotSaidaName}, 'Downwind',
          ${`Downwind organizado por ${user.name}`}, ${user.name}, ${uf}
        )
        RETURNING id
      `;
      eventId = String((insertedEvent[0] as Record<string, unknown>).id);

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