import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * "Já tenho uma sessão de convidado válida?" — checagem que a página
 * app/dw-motorista/[token]/page.tsx faz ANTES de pedir o nome de novo.
 *
 * Existe porque o cookie httpOnly de 12h sobrevive a um refresh da página,
 * mas o estado React da página (formulário de nome) não — sem isto, recarregar
 * a página faria o motorista digitar o nome de novo mesmo com a sessão ainda
 * válida. Deliberadamente PÚBLICA (sem `requireUser()`, que rejeitaria o
 * próprio convidado): lê a sessão com `getSessionUser()` direto e devolve
 * `{ downwind: null }` para qualquer coisa que não seja uma sessão de
 * convidado ainda válida — nunca vaza dado de uma conta normal por aqui.
 */
export async function GET() {
  return handle(async () => {
    const session = await getSessionUser();
    if (!session || !session.guestDownwindId) {
      return { downwind: null };
    }

    const rows = await sql`
      SELECT d.id, d.nome, d.status,
             ss.name AS saida_nome, ss.lat AS saida_lat, ss.lng AS saida_lng,
             sc.name AS chegada_nome, sc.lat AS chegada_lat, sc.lng AS chegada_lng
      FROM downwinds d
      LEFT JOIN spots ss ON ss.id = d.spot_saida
      LEFT JOIN spots sc ON sc.id = d.spot_chegada
      WHERE d.id = ${session.guestDownwindId}
      LIMIT 1
    `;
    if (rows.length === 0) return { downwind: null };
    const r = rows[0] as Record<string, unknown>;

    const status = String(r.status);
    // Downwind já terminou: nada ao vivo para mostrar, mesmo com a sessão
    // (de até 12h) ainda tecnicamente válida no cookie.
    if (status !== 'aberto' && status !== 'em_andamento') {
      return { downwind: null };
    }

    const ponto = (nome: unknown, lat: unknown, lng: unknown) =>
      lat !== null && lat !== undefined && lng !== null && lng !== undefined
        ? { nome: String(nome ?? ''), lat: Number(lat), lng: Number(lng) }
        : null;

    const meu = await sql`SELECT rider_id FROM users WHERE id = ${session.id} LIMIT 1`;

    return {
      downwind: {
        id: String(r.id),
        nome: String(r.nome),
        status,
        saida: ponto(r.saida_nome, r.saida_lat, r.saida_lng),
        chegada: ponto(r.chegada_nome, r.chegada_lat, r.chegada_lng),
      },
      meuNome: session.name,
      meuUserId: session.id,
      meuRiderId: meu.length > 0 ? String((meu[0] as Record<string, unknown>).rider_id) : session.id,
    };
  });
}
