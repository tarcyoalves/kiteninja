import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { hashToken, HttpError } from '@/lib/auth';
import { motivoIndisponivel } from '@/lib/apoioSolo';
import { amostrarTrilha, type PontoTrilha } from '@/lib/trilhaDownwind';

export const dynamic = 'force-dynamic';

/** Mesmo teto da carga inicial da trilha própria no downwind. */
const LIMITE_PONTOS = 120;

interface Params {
  params: Promise<{ token: string }>;
}

/**
 * Leitura PÚBLICA do acompanhamento, pelo token — sem conta, sem sessão.
 *
 * É o que a página `/velejo-apoio/[token]` consome. Não exige login de
 * propósito: o motivo desta funcionalidade existir é o amigo que está no carro
 * e não usa o app.
 *
 * O QUE SAI DAQUI é o mínimo: nome e avatar do velejador, a trilha e a última
 * posição. Nunca e-mail, nunca id de usuário, nunca as outras sessões dele.
 * Quem tem o link tem exatamente o que o link promete — acompanhar ESTE velejo
 * — e nada além.
 *
 * Token inválido, expirado ou velejo encerrado recebem 404 com motivo. A
 * diferença entre "expirou" e "acabou" é dita porque muda o que quem está no
 * carro faz: pedir outro link, ou ir buscar a pessoa.
 */
export async function GET(_request: Request, ctx: Params) {
  return handle(async () => {
    const { token } = await ctx.params;
    if (!token) throw new HttpError(404, 'Link de acompanhamento inválido.');

    const rows = await sql`
      SELECT s.id, s.expira_em, s.encerrado_em, s.criado_em,
             u.name, u.avatar_url
      FROM velejo_apoio_sessoes s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ${hashToken(token)}
      LIMIT 1
    `;
    if (rows.length === 0) throw new HttpError(404, 'Link de acompanhamento inválido.');
    const s = rows[0] as Record<string, unknown>;

    const motivo = motivoIndisponivel(
      {
        expiraEm: new Date(String(s.expira_em)).toISOString(),
        encerradoEm: s.encerrado_em ? String(s.encerrado_em) : null,
      },
      new Date()
    );
    if (motivo !== null) {
      return {
        disponivel: false,
        motivo,
        velejador: { nome: String(s.name), avatarUrl: s.avatar_url ? String(s.avatar_url) : null },
      };
    }

    const pontos = await sql`
      SELECT lat, lng, registrado_em
      FROM velejo_apoio_posicoes
      WHERE sessao_id = ${String(s.id)}
      ORDER BY registrado_em ASC
    `;
    const trilhaBruta = pontos.map((p) => {
      const r = p as Record<string, unknown>;
      return [Number(r.lat), Number(r.lng), Date.parse(String(r.registrado_em))] as PontoTrilha;
    });
    const trilha = amostrarTrilha(trilhaBruta, LIMITE_PONTOS);
    const ultima = trilhaBruta.length > 0 ? trilhaBruta[trilhaBruta.length - 1] : null;

    return {
      disponivel: true,
      motivo: null,
      velejador: { nome: String(s.name), avatarUrl: s.avatar_url ? String(s.avatar_url) : null },
      iniciadoEm: new Date(String(s.criado_em)).toISOString(),
      trilha,
      ultimaPosicao: ultima
        ? { lat: ultima[0], lng: ultima[1], registradoEm: new Date(ultima[2]).toISOString() }
        : null,
    };
  });
}
