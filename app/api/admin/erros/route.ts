import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { HttpError, requireAdmin } from '@/lib/auth';

/**
 * Lista os erros de produção para o painel.
 *
 * Sem esta rota o registro em `erros_registrados` seria só um depósito que
 * ninguém abre — e o problema apontado pelas auditorias não era falta de
 * `console.error`, era não haver onde olhar.
 *
 * A ordenação é por última ocorrência, não por contagem: o que quebrou agora
 * importa mais que o que quebrou muito no mês passado. Resolvidos ficam fora
 * por padrão, e voltam sozinhos se o erro reaparecer — o `ON CONFLICT` de
 * `registrarErro` zera `resolvido_em` quando a impressão digital retorna.
 */
export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();

    const url = new URL(request.url);
    const incluirResolvidos = url.searchParams.get('resolvidos') === '1';

    const linhas = incluirResolvidos
      ? await sql`
          SELECT e.id, e.origem, e.rota, e.mensagem, e.stack, e.user_agent,
                 e.ocorrencias, e.primeira_em, e.ultima_em, e.resolvido_em,
                 u.name AS usuario
          FROM erros_registrados e
          LEFT JOIN users u ON u.id = e.user_id
          ORDER BY e.ultima_em DESC
          LIMIT 100
        `
      : await sql`
          SELECT e.id, e.origem, e.rota, e.mensagem, e.stack, e.user_agent,
                 e.ocorrencias, e.primeira_em, e.ultima_em, e.resolvido_em,
                 u.name AS usuario
          FROM erros_registrados e
          LEFT JOIN users u ON u.id = e.user_id
          WHERE e.resolvido_em IS NULL
          ORDER BY e.ultima_em DESC
          LIMIT 100
        `;

    return { erros: linhas };
  });
}

/**
 * Marca um erro como resolvido, ou o reabre.
 *
 * "Resolvido" aqui é um gesto humano — alguém olhou e tratou. Se o mesmo erro
 * acontecer de novo, `registrarErro` limpa a marca e ele reaparece na lista
 * sozinho, porque um erro que voltou não está resolvido.
 */
export async function PATCH(request: Request) {
  return handle(async () => {
    await requireAdmin();
    const corpo = (await readJson(request)) as Record<string, unknown> | null;

    const id = Number(corpo?.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'Informe o id do erro.');
    }
    const resolvido = corpo?.resolvido !== false;

    const linhas = resolvido
      ? await sql`UPDATE erros_registrados SET resolvido_em = NOW() WHERE id = ${id} RETURNING id`
      : await sql`UPDATE erros_registrados SET resolvido_em = NULL WHERE id = ${id} RETURNING id`;

    if (linhas.length === 0) throw new HttpError(404, 'Erro não encontrado.');
    return { ok: true };
  });
}
