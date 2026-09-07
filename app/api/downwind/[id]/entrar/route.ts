import { sql } from '@/lib/db';
import { handle, readOptionalJson } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { oneOf } from '@/lib/validation';
import { rateLimiters } from '@/lib/rateLimit';
import { ehUuid } from '@/lib/downwindDb';
import { podeEntrarEmOutroDownwind } from '@/lib/downwindAcesso';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Entra num downwind — o ponto de entrada é o card do evento em
 * views/EventsAndAlertsView.tsx, não um convite (downwind_convites fica fora
 * de escopo por ora: o downwind nasce de um evento visível a todo o app, que
 * já é fechado por convite de conta).
 *
 * IDEMPOTENTE de propósito: reabrir o card e tocar de novo, ou uma rede
 * instável duplicando a requisição, não pode virar erro nem trocar o papel de
 * quem já está navegando.
 */
export async function POST(request: Request, ctx: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!ehUuid(id)) throw new HttpError(404, 'Downwind não encontrado.');

    rateLimiters.downwindEntrar(user.id);

    const downwinds = await sql`SELECT status FROM downwinds WHERE id = ${id} LIMIT 1`;
    if (downwinds.length === 0) throw new HttpError(404, 'Downwind não encontrado.');
    const status = String((downwinds[0] as Record<string, unknown>).status);
    if (status !== 'aberto' && status !== 'em_andamento') {
      throw new HttpError(409, 'Este downwind já foi encerrado ou cancelado.');
    }

    /*
     * UMA TRAVESSIA POR VEZ — e, sobretudo, DIZER quando não dá.
     *
     * Sem esta checagem, entrar num segundo downwind respondia 200 e não
     * acontecia nada: o app só segura um downwind ativo e sempre prefere o que
     * está `em_andamento`, então a tela voltava para o antigo na revalidação
     * seguinte. Os logs de produção mostraram sete toques em "Entrar", todos
     * 200, com o beacon de OUTRO downwind transmitindo no meio deles. Nenhuma
     * mensagem, nenhuma pista — foi relatado três vezes como "não prestou".
     *
     * Recusar e NOMEAR o downwind que está travando é o que devolve o
     * controle: a pessoa sabe onde está presa e o que precisa encerrar.
     */
    const emCurso = await sql`
      SELECT d.id, d.nome, dp.papel, dp.estado
      FROM downwind_participantes dp
      JOIN downwinds d ON d.id = dp.downwind_id
      WHERE dp.user_id = ${user.id}
        AND d.status = 'em_andamento'
        AND d.id != ${id}
      ORDER BY d.iniciado_em DESC NULLS LAST
      LIMIT 1
    `;

    if (emCurso.length > 0) {
      const t = emCurso[0] as Record<string, unknown>;
      const veredito = podeEntrarEmOutroDownwind({
        travessiaEmCurso: {
          id: String(t.id),
          nome: String(t.nome),
          papel: t.papel as 'velejador' | 'apoio_terra' | 'espectador',
          estado: t.estado as 'confirmado' | 'navegando' | 'encerrado' | 'desistiu',
        },
        downwindAlvoId: id,
      });
      if (!veredito.permitido) throw new HttpError(veredito.status, veredito.mensagem);
    }

    const body = await readOptionalJson(request);
    const papel = oneOf(
      body,
      'papel',
      ['velejador', 'apoio_terra', 'espectador'] as const,
      'velejador'
    );

    /*
     * "Só assistir" NÃO tira ninguém da água.
     *
     * Quem já está 'navegando' está com o celular no colete, no meio da
     * travessia. Se um toque em "só assistir" (dedo errado, tela no bolso,
     * reabrir o card) rebaixasse o papel para 'espectador', a pessoa sairia
     * do quórum de encerramento e pararia de transmitir posição — o grupo
     * fecharia o downwind com ela ainda na água e o mapa deixaria de
     * mostrá-la. É o pior desfecho possível deste arquivo, e é barato de
     * impedir: quem está navegando primeiro encerra a própria participação.
     *
     * Mesmo espírito da linha logo abaixo, que nunca rebaixa 'navegando'
     * para 'confirmado'.
     */
    if (papel === 'espectador') {
      const atual = await sql`
        SELECT estado FROM downwind_participantes
        WHERE downwind_id = ${id} AND user_id = ${user.id}
        LIMIT 1
      `;
      if (
        atual.length > 0 &&
        String((atual[0] as Record<string, unknown>).estado) === 'navegando'
      ) {
        throw new HttpError(
          409,
          'Você está navegando neste downwind. Encerre seu velejo antes de passar a só assistir.'
        );
      }
    }

    // Duas etapas em vez de um único ON CONFLICT com ação de escrita embutida:
    // o downwind já tem organizador inserido na criação (app/api/events/
    // route.ts), então o caso comum aqui É o conflito, não a exceção — e essa
    // ação embutida sem filtro explícito de participante escaparia da
    // varredura de lib/authz.test.ts que garante que toda mutação de dado de
    // usuário está filtrada. DO NOTHING resolve a corrida de dois toques
    // quase simultâneos no próprio banco (mesmo espírito do convite de uso
    // único, `WHERE used_at IS NULL`), sem escrever nada quando já existe.
    //
    // downwind_participantes tem PK composta (downwind_id, user_id), sem
    // coluna `id` — ver HANDOFF.md.
    const inserted = await sql`
      INSERT INTO downwind_participantes (downwind_id, user_id, papel)
      VALUES (${id}, ${user.id}, ${papel})
      ON CONFLICT (downwind_id, user_id) DO NOTHING
      RETURNING papel, estado, eh_organizador, apoio_user_id
    `;

    let rows = inserted;
    if (rows.length === 0) {
      // Já era participante: atualiza o papel e, se tinha desistido, volta
      // para 'confirmado' — a única volta permitida por lib/downwind.ts.
      // NUNCA rebaixa 'navegando' para 'confirmado': reabrir o card no meio
      // da travessia não pode tirar ninguém da água por engano.
      rows = await sql`
        UPDATE downwind_participantes
        SET papel = ${papel},
            estado = CASE WHEN estado = 'desistiu' THEN 'confirmado' ELSE estado END
        WHERE downwind_id = ${id} AND user_id = ${user.id}
        RETURNING papel, estado, eh_organizador, apoio_user_id
      `;
    }

    const r = rows[0] as Record<string, unknown>;
    return {
      minhaParticipacao: {
        papel: String(r.papel),
        estado: String(r.estado),
        ehOrganizador: Boolean(r.eh_organizador),
        apoioUserId: r.apoio_user_id ? String(r.apoio_user_id) : null,
      },
    };
  });
}
