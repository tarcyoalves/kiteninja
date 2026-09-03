import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import {
  MSG_EVENTO_NAO_ENCONTRADO,
  normalizarVisibilidade,
  podeVerEvento,
} from '@/lib/downwindVisibilidade';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Quem confirmou presença num evento.
 *
 * POR QUE ESTA ROTA NÃO EXISTIA
 *
 * `event_registrations` era gravada corretamente desde sempre e **só era
 * contada**: as duas únicas consultas à tabela em todo o app eram
 * `COUNT(*)`. O card mostrava "5 riders confirmados" como texto morto e não
 * havia nenhum jeito, em lugar nenhum, de saber QUEM eram os cinco.
 *
 * É a mesma família de defeito que já apareceu meia dúzia de vezes nesta base:
 * o dado é registrado direito e depois não chega a lugar nenhum. Aqui dói
 * porque confirmar presença serve justamente para o grupo se organizar — saber
 * quem vai é o motivo de existir o botão.
 *
 * PRIVACIDADE
 *
 * A rota recebe um id de evento ARBITRÁRIO, então não pode confiar em "o
 * cliente só pede o que a listagem mostrou". Um evento pode ser um downwind
 * fechado, e a lista de quem vai já diz onde um grupo estará e quando.
 *
 * A decisão fica em `podeVerEvento` (função pura, testada), a mesma regra que
 * `GET /api/events` aplica no WHERE. Quem não pode ver recebe **404 com a
 * mesma mensagem** de evento inexistente — diferenciar as duas respostas
 * confirmaria a existência do downwind fechado para um estranho.
 *
 * Os campos devolvidos são os mesmos que /api/riders/search já trata como
 * públicos (nome, avatar, rider_id, bandeira, nível). NUNCA e-mail: uma lista
 * de presença é o lugar mais fácil de vazar a base de contatos inteira.
 */
export async function GET(_request: Request, ctx: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new HttpError(404, MSG_EVENTO_NAO_ENCONTRADO);
    }

    const cabecalho = await sql`
      SELECT
        e.id,
        e.title,
        d.visibilidade AS downwind_visibilidade,
        (d.criado_por = ${user.id}) AS sou_criador,
        EXISTS (
          SELECT 1 FROM downwind_participantes dp
          WHERE dp.downwind_id = d.id AND dp.user_id = ${user.id}
        ) AS sou_participante
      FROM events e
      LEFT JOIN downwinds d ON d.event_id = e.id
      WHERE e.id = ${id}
      LIMIT 1
    `;
    if (cabecalho.length === 0) throw new HttpError(404, MSG_EVENTO_NAO_ENCONTRADO);
    const ev = cabecalho[0] as Record<string, unknown>;

    const liberado = podeVerEvento({
      visibilidadeDoDownwind: ev.downwind_visibilidade
        ? normalizarVisibilidade(ev.downwind_visibilidade)
        : null,
      souCriadorDoDownwind: Boolean(ev.sou_criador),
      souParticipanteDoDownwind: Boolean(ev.sou_participante),
    });
    if (!liberado) throw new HttpError(404, MSG_EVENTO_NAO_ENCONTRADO);

    /*
     * `u.is_active` fica DE FORA do filtro de propósito: uma conta suspensa
     * depois de confirmar presença continua sendo alguém que disse que vem, e
     * sumir da lista silenciosamente faria a contagem do card divergir da
     * lista. O card conta linhas de event_registrations; esta consulta também.
     */
    const linhas = await sql`
      SELECT
        u.id,
        u.name,
        u.avatar_url,
        u.rider_id,
        u.country_flag,
        u.rider_level,
        u.home_spot,
        er.created_at
      FROM event_registrations er
      JOIN users u ON u.id = er.user_id
      WHERE er.event_id = ${id}
      ORDER BY er.created_at ASC
    `;

    const participantes = linhas.map((linha) => {
      const r = linha as Record<string, unknown>;
      return {
        id: String(r.id),
        name: String(r.name),
        avatarUrl: r.avatar_url ? String(r.avatar_url) : null,
        riderId: String(r.rider_id ?? ''),
        countryFlag: String(r.country_flag ?? ''),
        riderLevel: String(r.rider_level ?? ''),
        homeSpot: r.home_spot ? String(r.home_spot) : null,
        confirmadoEm: String(r.created_at),
        souEu: String(r.id) === user.id,
      };
    });

    return { eventTitle: String(ev.title), participantes };
  });
}
