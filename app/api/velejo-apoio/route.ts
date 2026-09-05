import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser, newToken, hashToken } from '@/lib/auth';
import { rateLimiters } from '@/lib/rateLimit';
import { VALIDADE_APOIO_HORAS, devoReaproveitar } from '@/lib/apoioSolo';

export const dynamic = 'force-dynamic';

/**
 * Abre (ou reaproveita) a sessão de acompanhamento do velejo solo.
 *
 * Devolve o token em claro UMA vez — o banco guarda só o hash, mesmo padrão de
 * `downwind_convites`. A partir daqui o aparelho passa a subir posição; antes
 * disso, não sobe nada (ver ACOMPANHAMENTO_NUNCA_LIGA_SOZINHO em
 * lib/apoioSolo.ts).
 *
 * REAPROVEITA a sessão aberta em vez de criar outra. Sem isso, cada toque em
 * "Convidar apoio" geraria um link novo apontando para uma sessão diferente —
 * e o amigo que recebeu o primeiro veria uma trilha parada para sempre
 * enquanto a pessoa velejava na outra. É o mesmo defeito que o botão
 * "Convidar" do downwind teve, com consequência pior.
 *
 * O token da sessão reaproveitada NÃO pode ser recuperado (só existe o hash),
 * então quem reaproveita recebe `token: null` e a tela usa o link que já
 * guardou. Se ela não tiver mais o link, encerra e abre outra.
 */
export async function POST() {
  return handle(async () => {
    const user = await requireUser();
    rateLimiters.downwindCriar(user.id);

    const abertas = await sql`
      SELECT id, expira_em, encerrado_em
      FROM velejo_apoio_sessoes
      WHERE user_id = ${user.id} AND encerrado_em IS NULL
      ORDER BY criado_em DESC
      LIMIT 1
    `;

    const agora = new Date();
    const atual = abertas.length > 0 ? (abertas[0] as Record<string, unknown>) : null;
    const sessaoAtual = atual
      ? {
          expiraEm: new Date(String(atual.expira_em)).toISOString(),
          encerradoEm: atual.encerrado_em ? String(atual.encerrado_em) : null,
        }
      : null;

    if (atual && devoReaproveitar(sessaoAtual, agora)) {
      return {
        sessaoId: String(atual.id),
        token: null,
        expiresAt: sessaoAtual!.expiraEm,
        reaproveitada: true,
      };
    }

    /*
     * Sessão vencida que ficou aberta é encerrada aqui, não deixada para trás.
     * Sem isto, a consulta acima devolveria para sempre a mesma linha morta e
     * o `WHERE encerrado_em IS NULL` deixaria de significar "acompanhamento em
     * curso" — que é justamente o que o índice parcial promete.
     */
    if (atual) {
      // `user_id` no WHERE mesmo com o id em mãos: a linha veio de uma
      // consulta filtrada por usuário um instante atrás, mas depender disso é
      // deixar a segurança a dois passos de distância. Aqui ela se lê na
      // própria query — que é o que a guarda de lib/authz.test.ts cobra.
      await sql`
        UPDATE velejo_apoio_sessoes
        SET encerrado_em = NOW()
        WHERE id = ${String(atual.id)} AND user_id = ${user.id} AND encerrado_em IS NULL
      `;
    }

    const token = newToken();
    const expiraEm = new Date(Date.now() + VALIDADE_APOIO_HORAS * 3_600_000);

    const criada = await sql`
      INSERT INTO velejo_apoio_sessoes (user_id, token_hash, expira_em)
      VALUES (${user.id}, ${hashToken(token)}, ${expiraEm.toISOString()})
      RETURNING id
    `;

    return {
      sessaoId: String((criada[0] as Record<string, unknown>).id),
      token,
      expiresAt: expiraEm.toISOString(),
      reaproveitada: false,
    };
  });
}

/**
 * Encerra o acompanhamento — o velejador saiu da água.
 *
 * Encerra TODAS as sessões abertas do usuário, não uma por id: se sobrou mais
 * de uma por qualquer caminho, deixar uma viva significaria continuar
 * transmitindo a posição de alguém que já está no carro.
 */
export async function DELETE() {
  return handle(async () => {
    const user = await requireUser();
    await sql`
      UPDATE velejo_apoio_sessoes
      SET encerrado_em = NOW()
      WHERE user_id = ${user.id} AND encerrado_em IS NULL
    `;
    return { ok: true };
  });
}
