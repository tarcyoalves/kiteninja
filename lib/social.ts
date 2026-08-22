/**
 * Regras puras do grafo social: quem pode seguir quem, o que "amigo" quer
 * dizer na UI (não é tabela — é derivado de seguir mútuo, ver seção 4.1 do
 * plano em docs/PLANO-REDE-SOCIAL.md) e quem pode ver a sessão de outro
 * velejador no feed.
 *
 * Mesmo princípio de lib/authz.ts e lib/downwindAcesso.ts: a regra mora aqui,
 * pura e testável em Node puro, e a rota só busca dado no banco e pergunta —
 * sem isso, "quem pode ver o quê" fica espalhado pelo feed, pela busca e pelo
 * perfil público, e diverge com o tempo.
 */

/**
 * Verifica se `euId` pode seguir `alvoId`. Falso só para auto-seguir.
 *
 * O CHECK de `user_follows` (lib/schema.sql) barra a mesma coisa no banco —
 * duas camadas, mesmo princípio de `salaDireta` recusar auto-DM em
 * lib/chat.ts: a checagem aqui dá o 400 com mensagem clara antes de gastar
 * uma ida ao banco só para descobrir a mesma constraint.
 */
export function podeSeguir(euId: string, alvoId: string): boolean {
  return euId !== alvoId;
}

export type RelacaoRider = 'amigos' | 'seguindo' | 'segue_voce' | 'nenhuma';

/**
 * "Amigo" não é uma tabela — `user_follows` só guarda seguir assimétrico
 * (Strava/Surfr, não pedido+aceite, ver seção 4.1 do plano). A UI mostra
 * "Amigos" quando os dois se seguem; esta função é o ÚNICO lugar que decide
 * isso, para a busca de velejadores, o perfil público e o feed (fases 3-5)
 * nunca divergirem sobre o que "amigo" significa.
 */
export function relacaoComRider(euSigo: boolean, meSegue: boolean): RelacaoRider {
  if (euSigo && meSegue) return 'amigos';
  if (euSigo) return 'seguindo';
  if (meSegue) return 'segue_voce';
  return 'nenhuma';
}

/**
 * Regra de visibilidade de UMA sessão de velejo (`sessions_log.is_public`):
 * o dono sempre vê a própria sessão, pública ou não — precisa continuar
 * enxergando um rascunho que marcou como privado. De uma sessão de
 * terceiro, só a pública entra no feed/perfil.
 *
 * Mesmo padrão de `canAccessDm` em lib/authz.ts: a checagem mora numa função
 * pura só, não repetida (e potencialmente divergente) em cada rota que lê
 * `sessions_log`.
 */
export function podeVerSessao(
  sessao: { autorId: string; isPublic: boolean },
  viewerId: string
): boolean {
  if (sessao.autorId === viewerId) return true;
  return sessao.isPublic;
}
