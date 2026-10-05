import { sql } from './db';
import { registrarErro } from './observabilidade';

/**
 * Trilha de auditoria das ações do administrador.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * A tabela `audit_logs` já existia, mas só o SOS escrevia nela. Nenhuma das
 * rotas do painel admin deixava rastro: suspender alguém, promover a admin,
 * gerar link de nova senha, revogar convite, mexer em chamado — nada ficava
 * registrado. Se a conta de admin fosse usada por outra pessoa (celular
 * emprestado, senha vazada), não havia como saber o que tinha sido feito com
 * ela. Um painel que consegue suspender qualquer conta e gerar o link que
 * entrega o acesso a ela precisa de um registro de quem fez o quê.
 *
 * O QUE NUNCA ENTRA AQUI
 *
 * O token de redefinição de senha e a URL que o carrega. Quem lê a auditoria é
 * o admin — mas o log vai parar em backup, em print, em colega de suporte, e
 * um link de uso único com 2 h de validade é, enquanto vale, a senha da conta.
 * `limparDetalhes` derruba por nome qualquer chave que pareça segredo e por
 * valor qualquer texto que pareça URL, de modo que um descuido futuro de quem
 * chamar esta função não vira vazamento.
 *
 * REGRA: registrar nunca pode impedir a ação. Mesmo padrão de
 * `lib/observabilidade.ts`: a função engole a própria falha. A ação do admin
 * já aconteceu quando chegamos aqui; derrubar a resposta por causa do log
 * deixaria o admin achando que ela falhou e repetindo — pior que um registro
 * faltando. Mas a falha NÃO é muda: vai para o painel de Erros, onde o dono vê.
 *
 * VOLUME E EXPURGO
 *
 * Ações de admin são raras (dezenas por mês, num app com um dono), cada linha
 * tem poucas centenas de bytes: anos de uso não chegam perto do 0,5 GB do
 * Neon gratuito. Por isso não há expurgo — diferente de posições e erros, que
 * crescem com o uso. Se um dia o volume mudar, o índice em `created_at` já
 * existe e um `DELETE ... WHERE created_at < NOW() - INTERVAL '1 year'` basta.
 */

/**
 * Cada ação conhecida e o tipo de alvo a que ela se refere. O prefixo
 * `admin.` separa estas linhas das do SOS (`sos.created`, `sos.resolved`) na
 * mesma tabela, e é por ele que a listagem do painel filtra.
 */
export const ACOES_ADMIN = {
  'admin.usuario.papel_alterado': 'user',
  'admin.usuario.suspenso': 'user',
  'admin.usuario.reativado': 'user',
  'admin.usuario.troca_senha_exigida': 'user',
  'admin.usuario.troca_senha_dispensada': 'user',
  'admin.usuario.link_senha_gerado': 'user',
  'admin.convite.criado': 'invite',
  'admin.convite.revogado': 'invite',
  'admin.chamado.status_alterado': 'chamado',
  'admin.chamado.parecer_alterado': 'chamado',
  'admin.erro.resolvido': 'erro',
  'admin.erro.reaberto': 'erro',
} as const;

export type AcaoAdmin = keyof typeof ACOES_ADMIN;

/** Chaves que parecem segredo: caem por nome, em qualquer profundidade. */
const CHAVE_SECRETA = /token|url|senha|password|hash|secret|cookie/i;
/** Valores que parecem link: caem por conteúdo, ainda que a chave seja inocente. */
const VALOR_DE_LINK = /^(https?:)?\/\//i;

/**
 * Devolve cópia de `detalhes` sem nada que se pareça com segredo ou link.
 * Pura e exportada para que o teste a exerça sem banco.
 */
export function limparDetalhes(detalhes: unknown, profundidade = 0): unknown {
  if (typeof detalhes === 'string') {
    return VALOR_DE_LINK.test(detalhes.trim()) ? undefined : detalhes.slice(0, 300);
  }
  if (Array.isArray(detalhes) && profundidade < 3) {
    return detalhes.map((x) => limparDetalhes(x, profundidade + 1)).filter((x) => x !== undefined);
  }
  if (detalhes && typeof detalhes === 'object' && profundidade < 3) {
    const saida: Record<string, unknown> = {};
    for (const [chave, valor] of Object.entries(detalhes)) {
      if (CHAVE_SECRETA.test(chave)) continue;
      const limpo = limparDetalhes(valor, profundidade + 1);
      if (limpo !== undefined) saida[chave] = limpo;
    }
    return saida;
  }
  if (typeof detalhes === 'number' || typeof detalhes === 'boolean' || detalhes === null) {
    return detalhes;
  }
  return undefined;
}

/** Primeiro IP de `x-forwarded-for` (o do cliente; os demais são proxies). */
function ipDaRequisicao(request?: Request): string | null {
  const bruto = request?.headers.get('x-forwarded-for') ?? request?.headers.get('x-real-ip');
  const ip = bruto?.split(',')[0]?.trim();
  return ip ? ip.slice(0, 64) : null;
}

/**
 * Registra uma ação do administrador. Não lança nunca.
 *
 * Use `await` (diferente de `registrarErro`, que roda solto): numa função
 * serverless, trabalho pendurado depois da resposta pode ser cortado, e perder
 * o rastro de uma ação de admin é justamente o que esta tabela quer evitar. O
 * custo é um INSERT por ação, numa rota que o admin dispara a mão.
 *
 * @param adminId  quem fez (a sessão, nunca algo vindo do corpo da requisição)
 * @param acao     uma das `ACOES_ADMIN`
 * @param alvoId   id do que foi mexido (usuário, convite, chamado, erro), ou
 *                 `null` quando não há como saber
 * @param detalhes dados curtos e sem segredo; passam por `limparDetalhes`
 * @param request  opcional: só para gravar o IP de quem fez
 * @returns `true` se gravou; `false` se falhou (a ação já foi feita mesmo assim)
 */
export async function registrarAcaoAdmin(
  adminId: string,
  acao: AcaoAdmin,
  alvoId: string | number | null,
  detalhes: Record<string, unknown> = {},
  request?: Request
): Promise<boolean> {
  try {
    const limpos = limparDetalhes(detalhes) ?? {};
    await sql`
      INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata, ip_address)
      VALUES (
        ${adminId},
        ${acao},
        ${ACOES_ADMIN[acao]},
        ${alvoId === null ? null : String(alvoId)},
        ${JSON.stringify(limpos)}::jsonb,
        ${ipDaRequisicao(request)}
      )
    `;
    return true;
  } catch (erro) {
    // Mudo para o admin, não para o dono: o erro vai para o painel de Erros.
    console.error('[auditoria] falha ao registrar ação do admin:', acao, erro);
    void registrarErro({ origem: 'servidor', erro, rota: 'lib/auditoriaAdmin', userId: adminId });
    return false;
  }
}
