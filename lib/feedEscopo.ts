/**
 * De quem é o feed de velejos: da comunidade toda, ou só de quem eu sigo.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *
 * O feed tinha um escopo só, e era o mais estreito possível: `s.user_id = eu
 * OR (público E eu sigo o autor)`. Quem cria conta e ainda não segue ninguém
 * abre o feed e vê **nada** — ou, na melhor das hipóteses, os próprios velejos.
 *
 * Num app fechado por convite, com poucos usuários, isso é o pior arranjo
 * possível: a pessoa entra, não encontra ninguém, e não tem como descobrir
 * quem seguir a partir do feed, que é justamente onde ela procuraria.
 *
 * Os dois escopos coexistem de propósito, como no Woo e no Strava:
 *  - `comunidade`: tudo que é público. É onde se DESCOBRE gente.
 *  - `seguindo`: só quem eu escolhi acompanhar. É onde se ACOMPANHA gente.
 *
 * O padrão é `comunidade`: um feed vazio não ensina nada a quem chegou agora,
 * e quem já segue alguém troca de aba com um toque.
 */

export type EscopoFeed = 'comunidade' | 'seguindo';

export const ESCOPOS: readonly EscopoFeed[] = ['comunidade', 'seguindo'];

/** Ver o último parágrafo do bloco acima antes de trocar. */
export const ESCOPO_PADRAO: EscopoFeed = 'comunidade';

/**
 * Normaliza o que veio da query string.
 *
 * Valor desconhecido cai no padrão em vez de virar erro: escopo de feed é
 * preferência de leitura, não permissão — recusar a página inteira porque
 * `?escopo=todos` foi digitado à mão seria pior que mostrar a comunidade.
 * A privacidade NÃO depende disto: quem filtra o que é visível é
 * `podeVerNoFeed` abaixo, e ela vale nos dois escopos.
 */
export function normalizarEscopo(valor: unknown): EscopoFeed {
  if (typeof valor !== 'string') return ESCOPO_PADRAO;
  const limpo = valor.trim().toLowerCase();
  return (ESCOPOS as readonly string[]).includes(limpo)
    ? (limpo as EscopoFeed)
    : ESCOPO_PADRAO;
}

/**
 * A sessão entra no feed deste velejador?
 *
 * REGRA DE PRIVACIDADE, COMUM AOS DOIS ESCOPOS: sessão marcada como privada
 * só aparece para o próprio autor. Trocar de aba nunca revela nada a mais —
 * `comunidade` amplia QUEM aparece, jamais O QUE é visível.
 *
 * O próprio velejador se vê nos dois escopos: em `seguindo` porque o feed
 * ficaria vazio para quem ainda não segue ninguém (o defeito original), e em
 * `comunidade` porque some da lista o que você acabou de publicar é o tipo de
 * silêncio que faz o usuário achar que não salvou.
 */
export function podeVerNoFeed(args: {
  escopo: EscopoFeed;
  autorId: string;
  souEu: string;
  isPublic: boolean;
  euSigoOAutor: boolean;
}): boolean {
  const { escopo, autorId, souEu, isPublic, euSigoOAutor } = args;
  if (autorId === souEu) return true;
  if (!isPublic) return false;
  if (escopo === 'comunidade') return true;
  return euSigoOAutor;
}
