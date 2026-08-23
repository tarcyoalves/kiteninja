import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { HttpError, requireUser } from '@/lib/auth';
import { podeSeguir, relacaoComRider } from '@/lib/social';
import { criarNotificacao } from '@/lib/notificacoes';

const UUID = /^[0-9a-f-]{36}$/i;

interface RelacaoRow {
  eu_sigo: unknown;
  me_segue: unknown;
}

/** Lê o estado atual da relação (nos dois sentidos) para devolver à UI sem outra ida ao banco. */
async function lerRelacao(euId: string, alvoId: string) {
  const rows = (await sql`
    SELECT
      EXISTS (
        SELECT 1 FROM user_follows WHERE follower_id = ${euId} AND following_id = ${alvoId}
      ) AS eu_sigo,
      EXISTS (
        SELECT 1 FROM user_follows WHERE follower_id = ${alvoId} AND following_id = ${euId}
      ) AS me_segue
  `) as RelacaoRow[];
  const r = rows[0];
  return relacaoComRider(Boolean(r.eu_sigo), Boolean(r.me_segue));
}

/** Confere que o alvo existe e está ativo — mesma mensagem para os dois casos de 404. */
async function exigirAlvoAtivo(id: string) {
  const rows = await sql`SELECT id FROM users WHERE id = ${id} AND is_active = TRUE LIMIT 1`;
  if (rows.length === 0) throw new HttpError(404, 'Velejador não encontrado.');
}

/**
 * Seguir um velejador (grafo social, seção 4.1 do plano). Sem pedido/aceite:
 * é um INSERT, e seguir de novo é no-op (ON CONFLICT DO NOTHING), não erro —
 * a UI pode chamar duas vezes seguidas (duplo toque, retry de rede) sem
 * precisar tratar 409.
 *
 * `RETURNING follower_id` distingue follow NOVO de re-follow ignorado pelo
 * `ON CONFLICT` — só o novo notifica quem foi seguido (Fase 6), senão um
 * duplo toque notificaria "novo seguidor" duas vezes para a mesma pessoa.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de velejador inválido.');
    if (!podeSeguir(user.id, id)) throw new HttpError(400, 'Você não pode seguir a si mesmo.');
    await exigirAlvoAtivo(id);

    const inserted = await sql`
      INSERT INTO user_follows (follower_id, following_id)
      VALUES (${user.id}, ${id})
      ON CONFLICT (follower_id, following_id) DO NOTHING
      RETURNING follower_id
    `;

    if (inserted.length > 0) {
      await criarNotificacao({
        recipientId: id,
        actorId: user.id,
        type: 'novo_seguidor',
      });
    }

    return { relacao: await lerRelacao(user.id, id) };
  });
}

/**
 * Deixar de seguir. Remover quem eu nunca segui também é no-op — mesmo
 * espírito do toggle de favorito em listings/[id]/favorite/route.ts.
 *
 * O DELETE filtra por `follower_id`, não por `user_id` (ver
 * lib/authz.test.ts, MUTACOES_JUSTIFICADAS): nesta tabela follower_id É o
 * dono da linha, então `follower_id = ${user.id}` já garante que só a própria
 * relação de "eu sigo" pode ser apagada — jamais a de outra pessoa.
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!UUID.test(id)) throw new HttpError(400, 'Identificador de velejador inválido.');
    if (!podeSeguir(user.id, id)) throw new HttpError(400, 'Você não pode deixar de seguir a si mesmo.');

    await sql`
      DELETE FROM user_follows
      WHERE follower_id = ${user.id} AND following_id = ${id}
    `;

    return { relacao: await lerRelacao(user.id, id) };
  });
}
