import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { ehUuid } from '@/lib/downwindDb';
import { sendPushToUsers } from '@/lib/push';
import {
  normalizarVisibilidade,
  podeNotificarSeguidores,
  textoDoAviso,
} from '@/lib/downwindVisibilidade';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Avisa os seguidores do organizador que existe um downwind novo.
 *
 * POR QUE ESTA ROTA EXISTE
 *
 * Criar um downwind de comunidade o punha na agenda, mas ninguém era
 * informado — ele ficava esperando que alguém abrisse a aba Eventos por
 * conta própria. Para um app com cinco usuários isso é o mesmo que não
 * existir: o organizador acabava avisando o grupo por WhatsApp, e o app
 * virava só o lugar onde o downwind é registrado depois.
 *
 * QUEM RECEBE: os seguidores do organizador (`user_follows`), não "todo
 * mundo". Push de desconhecido é spam, e spam é o caminho mais rápido para o
 * usuário desligar TODAS as notificações — inclusive as de SOS. Quando a base
 * crescer, o recorte natural para ampliar é a UF do evento (`events.uf`, ver
 * lib/uf.ts), não a lista inteira de usuários.
 *
 * As quatro condições de disparo moram em `podeNotificarSeguidores`
 * (lib/downwindVisibilidade.ts), testadas sem banco. Aqui só carregamos os
 * fatos e perguntamos.
 */
export async function POST(_request: Request, ctx: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!ehUuid(id)) throw new HttpError(404, 'Downwind não encontrado.');

    const rows = await sql`
      SELECT
        d.nome,
        d.status,
        d.visibilidade,
        d.notificado_em,
        d.previsto_para,
        d.criado_por,
        so.name AS spot_saida_nome,
        sc.name AS spot_chegada_nome
      FROM downwinds d
      LEFT JOIN spots so ON so.id = d.spot_saida
      LEFT JOIN spots sc ON sc.id = d.spot_chegada
      WHERE d.id = ${id}
      LIMIT 1
    `;
    if (rows.length === 0) throw new HttpError(404, 'Downwind não encontrado.');
    const dw = rows[0] as Record<string, unknown>;

    const visibilidade = normalizarVisibilidade(dw.visibilidade);
    if (visibilidade === null) {
      // Linha com valor fora do CHECK do schema só pode ser corrupção. Recusar
      // é a única resposta segura: o padrão silencioso seria assumir
      // 'comunidade' e transmitir um downwind que talvez fosse fechado.
      throw new HttpError(409, 'Downwind com visibilidade inconsistente.');
    }

    const veredicto = podeNotificarSeguidores({
      visibilidade,
      ehOrganizador: dw.criado_por !== null && String(dw.criado_por) === user.id,
      statusDownwind: String(dw.status),
      notificadoEm: dw.notificado_em ? String(dw.notificado_em) : null,
    });
    if (!veredicto.permitido) throw new HttpError(409, veredicto.motivo);

    /*
     * A MARCA VEM ANTES DO PUSH, de propósito.
     *
     * Se o disparo ficasse por último, uma falha no meio do envio (rede,
     * FCM fora) deixaria `notificado_em` nulo com metade dos seguidores já
     * notificados — e o próximo toque mandaria tudo de novo para quem já
     * recebeu. Marcar primeiro troca "pode duplicar" por "pode não enviar",
     * e entre as duas a segunda é a recuperável: o organizador percebe que
     * ninguém apareceu e chama pelo chat. Da duplicação ele não tem volta.
     *
     * O UPDATE é condicional (notificado_em IS NULL) e usa RETURNING: dois
     * toques simultâneos em aparelhos diferentes fazem o segundo voltar
     * vazio, e a corrida morre no banco em vez de virar dois pushes. O driver
     * HTTP do Neon devolve [] para UPDATE sem RETURNING, então o RETURNING
     * aqui não é enfeite — é o que torna a checagem possível.
     */
    const marcado = await sql`
      UPDATE downwinds
      SET notificado_em = NOW()
      WHERE id = ${id} AND notificado_em IS NULL
      RETURNING id
    `;
    if (marcado.length === 0) {
      throw new HttpError(409, 'A comunidade já foi avisada deste downwind.');
    }

    const seguidores = await sql`
      SELECT follower_id FROM user_follows WHERE following_id = ${user.id}
    `;
    const destinatarios = seguidores.map((r) =>
      String((r as Record<string, unknown>).follower_id)
    );

    if (destinatarios.length === 0) return { enviados: 0, seguidores: 0 };

    const trajeto = [dw.spot_saida_nome, dw.spot_chegada_nome]
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .join(' → ');
    const quando = dw.previsto_para
      ? new Date(String(dw.previsto_para)).toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

    const { titulo, corpo } = textoDoAviso({
      nomeDownwind: String(dw.nome),
      organizador: user.name,
      trajeto: trajeto || null,
      quando,
    });

    const enviados = await sendPushToUsers(destinatarios, {
      title: titulo,
      body: corpo,
      url: '/?tab=eventos',
      tag: `downwind-novo-${id}`,
    });

    return { enviados, seguidores: destinatarios.length };
  });
}
