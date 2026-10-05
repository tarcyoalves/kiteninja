import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * As últimas 100 ações do administrador (ver `lib/auditoriaAdmin.ts`).
 *
 * Só linhas `admin.*`: a tabela também guarda o SOS (`sos.created`,
 * `sos.resolved`), que não é "o que o admin fez" e, num dia movimentado,
 * empurraria as ações do painel para fora das 100.
 *
 * Os nomes de quem fez e de quem sofreu a ação são lidos por JOIN na hora, e
 * não gravados no log: assim apagar uma conta (direito de eliminação, LGPD) não
 * deixa o nome da pessoa para sempre na auditoria — a linha passa a mostrar
 * "conta removida". O alvo só é procurado em `users` quando o `target_id` tem
 * cara de UUID: o CASE protege o cast, já que `target_id` é texto e para erros
 * é um número.
 *
 * Uma consulta, nenhum polling: o painel busca ao abrir a aba e no botão
 * atualizar (a auditoria é consultada de vez em quando, não vigiada).
 */
export async function GET() {
  return handle(async () => {
    await requireAdmin();

    const linhas = await sql`
      SELECT a.id, a.action, a.target_type, a.target_id, a.metadata, a.created_at,
             ator.name AS ator_nome,
             alvo.name AS alvo_nome
      FROM audit_logs a
      LEFT JOIN users ator ON ator.id = a.actor_id
      LEFT JOIN users alvo ON alvo.id = CASE
        WHEN a.target_type = 'user'
         AND a.target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN a.target_id::uuid
      END
      WHERE a.action LIKE 'admin.%'
      ORDER BY a.created_at DESC
      LIMIT 100
    `;

    return {
      acoes: linhas.map((r) => {
        const l = r as Record<string, unknown>;
        return {
          id: String(l.id),
          acao: String(l.action),
          alvoTipo: String(l.target_type),
          alvoId: l.target_id ?? null,
          alvoNome: l.alvo_nome ?? null,
          atorNome: l.ator_nome ?? null,
          detalhes: l.metadata ?? {},
          em: l.created_at,
        };
      }),
    };
  });
}
