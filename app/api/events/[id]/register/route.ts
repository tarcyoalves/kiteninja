import { sql } from '@/lib/db';
import { handle, readOptionalJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { HttpError } from '@/lib/auth';

/**
 * Confirmar ou desmarcar presença num evento.
 *
 * POR QUE ACEITA O ESTADO DESEJADO, E NÃO SÓ ALTERNA
 *
 * Esta rota era um alternador cego: apagava a inscrição e, se nada saiu,
 * inseria. Atômica no banco, sim — mas atômica em cima da pergunta errada.
 * Dois toques rápidos no mesmo botão (o dedo repete quando a rede da praia
 * demora e nada muda na tela) mandavam DOIS POSTs. As duas requisições
 * chegavam, a segunda desfazia a primeira, e qual das duas respostas voltava
 * por último decidia o que a tela mostrava. Resultado possível: o card diz
 * "Presença Confirmada" e o banco não tem a linha, ou o contrário — sem erro
 * nenhum em lugar nenhum.
 *
 * O conserto não é atrasar o segundo clique. É o cliente dizer o que QUER
 * ("participar: true"), porque aí repetir a mesma intenção não muda nada:
 * inserir o que já existe e apagar o que não existe são operações
 * idempotentes. Repetir vira ruído de rede, não divergência de estado.
 *
 * O corpo continua opcional e a alternância continua valendo quando ele não
 * vem: um app instalado (PWA/WebView) roda JS de versão anterior por dias
 * depois do deploy, e quebrar a confirmação de presença para essa gente seria
 * pior que o defeito que estamos corrigindo.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new HttpError(400, 'Identificador de evento inválido.');
    }

    const body = await readOptionalJson(request);
    const pedido = (body as Record<string, unknown> | null)?.participar;
    if (pedido !== undefined && typeof pedido !== 'boolean') {
      throw new HttpError(400, 'O campo "participar" deve ser true ou false.');
    }

    // Check if event exists
    const eventExists = await sql`
      SELECT id FROM events WHERE id = ${id} LIMIT 1
    `;
    if (eventExists.length === 0) {
      throw new HttpError(404, 'Evento não encontrado.');
    }

    let inscrito: boolean;

    if (pedido === true) {
      await sql`
        INSERT INTO event_registrations (event_id, user_id)
        VALUES (${id}, ${user.id})
        ON CONFLICT (event_id, user_id) DO NOTHING
      `;
      inscrito = true;
    } else if (pedido === false) {
      await sql`
        DELETE FROM event_registrations
        WHERE event_id = ${id} AND user_id = ${user.id}
      `;
      inscrito = false;
    } else {
      // Chave composta (event_id, user_id), sem coluna `id`: a linha é o estado.
      // Remover-e-se-nada-saiu-inserir deixa o toggle atômico no banco.
      const removed = await sql`
        DELETE FROM event_registrations
        WHERE event_id = ${id} AND user_id = ${user.id}
        RETURNING event_id
      `;
      if (removed.length === 0) {
        await sql`
          INSERT INTO event_registrations (event_id, user_id)
          VALUES (${id}, ${user.id})
          ON CONFLICT (event_id, user_id) DO NOTHING
        `;
      }
      inscrito = removed.length === 0;
    }

    // Contagem lida DEPOIS da escrita, sempre: é o número que o card mostra, e
    // devolver a contagem de antes faria o botão e o contador discordarem.
    const count = await sql`
      SELECT COUNT(*)::int AS cnt FROM event_registrations WHERE event_id = ${id}
    `;
    return {
      isRegistered: inscrito,
      participantsCount: Number((count[0] as Record<string, unknown>).cnt),
    };
  });
}
