import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { num } from '@/lib/validation';
import { rateLimiters } from '@/lib/rateLimit';
import { acompanhamentoAtivo } from '@/lib/apoioSolo';

export const dynamic = 'force-dynamic';

/**
 * O velejador manda a própria posição enquanto o acompanhamento está ligado.
 *
 * NÃO recebe o id da sessão do cliente: a sessão é resolvida pelo usuário
 * autenticado. Um id vindo do cliente seria uma chance de escrever na sessão
 * de outra pessoa, e não há ganho nenhum em aceitá-lo — o aparelho já sabe
 * quem é porque está logado.
 *
 * Sem sessão aberta, responde 409 em vez de gravar em lugar nenhum. O cliente
 * lê isso como "pare de mandar" (ver lib/useApoioSoloBeacon.ts): é o que
 * desliga a transmissão quando o velejo termina em outro aparelho, ou quando
 * as 12h vencem no meio da água.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    rateLimiters.downwindPosicao(user.id);

    const body = await readJson(request);
    const lat = num(body, 'lat', { min: -90, max: 90 });
    const lng = num(body, 'lng', { min: -180, max: 180 });
    const accuracyM = num(body, 'accuracyM', { optional: true, min: 0, max: 100_000 });

    const abertas = await sql`
      SELECT id, expira_em, encerrado_em
      FROM velejo_apoio_sessoes
      WHERE user_id = ${user.id} AND encerrado_em IS NULL
      ORDER BY criado_em DESC
      LIMIT 1
    `;
    if (abertas.length === 0) {
      throw new HttpError(409, 'Nenhum acompanhamento ativo.');
    }
    const s = abertas[0] as Record<string, unknown>;
    const ativa = acompanhamentoAtivo(
      {
        expiraEm: new Date(String(s.expira_em)).toISOString(),
        encerradoEm: s.encerrado_em ? String(s.encerrado_em) : null,
      },
      new Date()
    );
    if (!ativa) {
      // Venceu com o velejo ainda rolando: encerra de vez para o índice
      // parcial continuar significando "acompanhamento em curso".
      // Ver o mesmo cuidado em app/api/velejo-apoio/route.ts: o filtro por
      // usuário fica na query, não na confiança de que a linha veio filtrada.
      await sql`
        UPDATE velejo_apoio_sessoes
        SET encerrado_em = NOW()
        WHERE id = ${String(s.id)} AND user_id = ${user.id}
      `;
      throw new HttpError(409, 'O link de acompanhamento expirou.');
    }

    await sql`
      INSERT INTO velejo_apoio_posicoes (sessao_id, lat, lng, accuracy_m)
      VALUES (${String(s.id)}, ${lat}, ${lng}, ${accuracyM ?? null})
    `;

    return { ok: true };
  });
}
