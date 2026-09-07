import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireUser } from '@/lib/auth';

/**
 * "Estou dentro de um downwind agora?"
 *
 * É a rota que decide se o app abre no mapa ao vivo ou nas abas normais, então
 * ela é chamada uma vez a cada abertura do app, por todo usuário. Por isso
 * responde só o cabeçalho da travessia — nenhuma posição de ninguém — e usa o
 * índice `idx_downwind_participantes_user`, que existe exatamente para esta
 * busca no sentido pessoa -> downwinds.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser();

    /*
     * `?id=` — QUAL downwind, em vez de deixar o servidor adivinhar.
     *
     * O BUG QUE ISTO CORRIGE, relatado duas vezes como "entrei no dw e não
     * prestou": esta rota devolvia UM downwind, escolhido por `ORDER BY ...
     * LIMIT 1`. Quem está em mais de um — e quem cria downwinds para testar
     * fica em vários, porque nada fecha os antigos sozinho — recebia sempre o
     * mesmo, que não era o que a pessoa acabou de abrir.
     *
     * Aí a tela não abria, e por um motivo que não aparecia em lugar nenhum:
     * o app pedia para mostrar o downwind X e o servidor respondia com o
     * downwind Y, então o pedido não casava com o downwind ativo e era
     * descartado em silêncio. Nenhum erro, nenhuma mensagem — só a aba Mapa
     * comum, como se o toque não tivesse feito nada.
     *
     * Com o id explícito o cliente para de depender de um palpite: quem entra
     * num downwind sabe em qual entrou, e diz.
     */
    const idPedido = new URL(request.url).searchParams.get('id');

    const rows = idPedido
      ? await sql`
          SELECT
            d.id, d.nome, d.status, d.previsto_para, d.iniciado_em,
            d.spot_saida, d.spot_chegada,
            ss.name AS saida_nome, ss.lat AS saida_lat, ss.lng AS saida_lng,
            sc.name AS chegada_nome, sc.lat AS chegada_lat, sc.lng AS chegada_lng,
            dp.papel, dp.estado, dp.eh_organizador, dp.apoio_user_id
          FROM downwind_participantes dp
          JOIN downwinds d ON d.id = dp.downwind_id
          LEFT JOIN spots ss ON ss.id = d.spot_saida
          LEFT JOIN spots sc ON sc.id = d.spot_chegada
          WHERE dp.user_id = ${user.id}
            AND d.id = ${idPedido}
            AND d.status IN ('aberto', 'em_andamento')
            AND dp.estado IN ('confirmado', 'navegando')
          LIMIT 1
        `
      : await sql`
          SELECT
            d.id, d.nome, d.status, d.previsto_para, d.iniciado_em,
            d.spot_saida, d.spot_chegada,
            ss.name AS saida_nome, ss.lat AS saida_lat, ss.lng AS saida_lng,
            sc.name AS chegada_nome, sc.lat AS chegada_lat, sc.lng AS chegada_lng,
            dp.papel, dp.estado, dp.eh_organizador, dp.apoio_user_id
          FROM downwind_participantes dp
          JOIN downwinds d ON d.id = dp.downwind_id
          LEFT JOIN spots ss ON ss.id = d.spot_saida
          LEFT JOIN spots sc ON sc.id = d.spot_chegada
          WHERE dp.user_id = ${user.id}
            AND d.status IN ('aberto', 'em_andamento')
            AND dp.estado IN ('confirmado', 'navegando')
          -- Sem id pedido, a ordem importa e a antiga escolhia mal.
          --
          -- Era: iniciado_em DESC NULLS LAST, previsto_para ASC. Entre
          -- downwinds agendados (todos com iniciado_em nulo) isso elegia o de
          -- data MAIS ANTIGA, ou seja, o downwind de teste esquecido de duas
          -- semanas atras ganhava do que a pessoa acabou de criar.
          --
          -- Agora: travessia EM ANDAMENTO na frente de tudo (tem gente na
          -- agua agora, isso vence qualquer plano); depois, o downwind em que
          -- a pessoa entrou por ultimo, que e o melhor palpite do que ela quer
          -- ver.
          ORDER BY
            (d.status = 'em_andamento') DESC,
            dp.entrou_em DESC
          LIMIT 1
        `;

    if (rows.length === 0) return { downwind: null };

    const r = rows[0] as Record<string, unknown>;

    // `spots.lat/lng` são NOT NULL no schema — o único jeito de vir nulo aqui
    // é o downwind não ter `spot_chegada` definido (ainda não decidiram onde
    // termina) ou `spot_saida/chegada` apontar para um spot removido do
    // catálogo (ON DELETE SET NULL). Nesses casos o ponto simplesmente some
    // da resposta, em vez de a UI tentar desenhar um pino sem coordenada.
    const ponto = (nome: unknown, lat: unknown, lng: unknown) =>
      lat !== null && lat !== undefined && lng !== null && lng !== undefined
        ? { nome: String(nome ?? ''), lat: Number(lat), lng: Number(lng) }
        : null;

    return {
      downwind: {
        id: String(r.id),
        nome: String(r.nome),
        status: String(r.status),
        previstoPara: r.previsto_para ? new Date(String(r.previsto_para)).toISOString() : null,
        iniciadoEm: r.iniciado_em ? new Date(String(r.iniciado_em)).toISOString() : null,
        saida: ponto(r.saida_nome, r.saida_lat, r.saida_lng),
        chegada: ponto(r.chegada_nome, r.chegada_lat, r.chegada_lng),
        minhaParticipacao: {
          papel: String(r.papel),
          estado: String(r.estado),
          ehOrganizador: Boolean(r.eh_organizador),
          apoioUserId: r.apoio_user_id ? String(r.apoio_user_id) : null,
        },
      },
    };
  });
}
