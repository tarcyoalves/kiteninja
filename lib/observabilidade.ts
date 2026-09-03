/**
 * Registro de erros de produção.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * O app não tinha rastreamento de erro nenhum. `handle()` fazia `console.error`
 * e a mensagem ia para o log da função na Vercel — retenção curta no plano
 * Hobby e ninguém abrindo. Quando um velejador tinha erro no mar, ninguém
 * ficava sabendo. As três auditorias externas apontaram isso, e o histórico do
 * projeto mostra por que dói: três bugs graves passaram por 900+ testes verdes
 * e só apareceram quando alguém sondou produção na mão.
 *
 * POR QUE NÃO SENTRY (ainda)
 *
 * Sentry é melhor nisto — agrupa por stack, resolve source map, dispara
 * alerta. Mas exige criar conta, guardar um DSN e somar um SDK grande ao
 * bundle de um app que roda no 4G da praia. Este módulo tira a cegueira hoje,
 * sem cadastro e sem dependência nova, usando o Postgres que já está pago. Se
 * o volume crescer a ponto de precisar de agrupamento por stack e alerta por
 * e-mail, aí Sentry passa a valer o preço.
 *
 * REGRA INEGOCIÁVEL: registrar erro nunca pode causar erro. Toda função aqui
 * engole a própria falha. Um problema no logger não pode derrubar a resposta
 * que o velejador está esperando.
 */

/** Nunca gravamos além disto: stack de WebView pode vir gigante. */
const MAX_STACK = 4000;
const MAX_MENSAGEM = 500;
const MAX_ROTA = 300;
const MAX_USER_AGENT = 300;

function cortar(valor: unknown, limite: number): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  if (limpo.length === 0) return null;
  return limpo.slice(0, limite);
}

/**
 * Impressão digital que agrupa ocorrências do mesmo erro.
 *
 * Sem isto, um cliente em laço geraria uma linha por falha e encheria o banco
 * do plano gratuito numa tarde. Com isto, a tabela cresce com o número de
 * erros DISTINTOS e o contador mostra o que está sangrando.
 *
 * A rota entra na chave porque o mesmo "Cannot read property of undefined"
 * vindo do feed e do mapa são bugs diferentes. Números são trocados por `#`
 * para que ids na URL (`/api/downwind/abc-123/live`) não criem uma linha nova
 * por downwind.
 */
export function impressaoDigital(origem: string, rota: string | null, mensagem: string): string {
  const rotaNormalizada = (rota ?? 'desconhecida')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '#id')
    .replace(/\d+/g, '#');
  return `${origem}|${rotaNormalizada}|${mensagem}`.slice(0, 900);
}

export interface ErroRegistravel {
  origem: 'servidor' | 'cliente';
  erro: unknown;
  rota?: string | null;
  userId?: string | null;
  userAgent?: string | null;
}

/**
 * Grava (ou incrementa) um erro. Não lança, não espera, não atrasa a resposta.
 *
 * Chame sem `await` quando estiver no caminho de uma resposta ao usuário: o
 * `void` já diz que o resultado não interessa. Só use `await` em teste.
 */
export async function registrarErro(args: ErroRegistravel): Promise<void> {
  try {
    const bruto = args.erro;
    const mensagem =
      cortar(bruto instanceof Error ? bruto.message : String(bruto), MAX_MENSAGEM) ??
      'Erro sem mensagem';
    const stack = cortar(bruto instanceof Error ? bruto.stack : null, MAX_STACK);
    const rota = cortar(args.rota, MAX_ROTA);
    const userAgent = cortar(args.userAgent, MAX_USER_AGENT);
    const impressao = impressaoDigital(args.origem, rota, mensagem);

    // Import sob demanda: lib/db.ts estoura na carga do módulo sem
    // DATABASE_URL, e este arquivo é importado por testes que rodam sem banco.
    const { sql } = await import('./db');

    await sql`
      INSERT INTO erros_registrados
        (impressao, origem, rota, mensagem, stack, user_agent, user_id)
      VALUES
        (${impressao}, ${args.origem}, ${rota}, ${mensagem}, ${stack},
         ${userAgent}, ${args.userId ?? null})
      ON CONFLICT (impressao) DO UPDATE SET
        ocorrencias  = erros_registrados.ocorrencias + 1,
        ultima_em    = NOW(),
        -- Um erro que voltou depois de resolvido precisa reaparecer na lista.
        resolvido_em = NULL
    `;
  } catch {
    // Silêncio proposital: ver "REGRA INEGOCIÁVEL" no topo do arquivo.
  }
}
