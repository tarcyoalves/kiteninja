/**
 * Central de autorização e controle de acesso baseado em papéis (RBAC).
 *
 * Todas as regras de permissão devem passar por este módulo.
 * Nunca espalhe `if (user.role === 'admin')` solto pelas rotas: centralizar aqui
 * permite auditar a matriz de permissões e testar casos positivos e negativos
 * em lib/authz.test.ts.
 */

export type Role = 'admin' | 'moderator' | 'instructor' | 'rider';

export interface UserAuthContext {
  id: string;
  role: Role;
  /**
   * Liberação pontual para organizar downwind, independente do papel.
   * Existe porque organizar um downwind é uma responsabilidade operacional
   * (montar rota, saber quem está na água) que pode ser concedida a um
   * rider de confiança sem promovê-lo a instrutor/moderador/admin — os quais
   * já têm outros poderes que nada tem a ver com downwind. Opcional para não
   * quebrar quem já monta `UserAuthContext` sem esse campo.
   */
  pode_organizar_downwind?: boolean;
}

/** Verifica se o usuário tem privilégio de moderação global (admin ou moderador). */
export function canModerate(role: Role): boolean {
  return role === 'admin' || role === 'moderator';
}

/** Verifica se o usuário pode gerenciar contas, convites e suspensões (apenas admin). */
export function canManageUsers(role: Role): boolean {
  return role === 'admin';
}

/** Verifica se o usuário pode cadastrar eventos oficiais da comunidade. */
export function canCreateOfficialEvent(role: Role): boolean {
  return role === 'admin' || role === 'moderator' || role === 'instructor';
}

/** Verifica se o usuário pode apagar um post (próprio autor, moderador ou admin). */
export function canDeletePost(user: UserAuthContext, postAuthorId: string): boolean {
  if (user.id === postAuthorId) return true;
  return canModerate(user.role);
}

/** Verifica se o usuário pode apagar um comentário (próprio autor, moderador ou admin). */
export function canDeleteComment(user: UserAuthContext, commentAuthorId: string): boolean {
  if (user.id === commentAuthorId) return true;
  return canModerate(user.role);
}

/** Verifica se o usuário pode resolver/editar um alerta de segurança. */
export function canResolveAlert(user: UserAuthContext, alertAuthorId?: string): boolean {
  if (canModerate(user.role)) return true;
  return Boolean(alertAuthorId && user.id === alertAuthorId);
}

/** Verifica se o usuário pode editar/remover um anúncio no marketplace. */
export function canManageListing(user: UserAuthContext, listingAuthorId: string): boolean {
  if (user.id === listingAuthorId) return true;
  return canModerate(user.role);
}

/** Verifica se o usuário pode encerrar um SOS (próprio autor, moderador ou admin). */
export function canResolveSos(user: UserAuthContext, sosAuthorId: string): boolean {
  if (user.id === sosAuthorId) return true;
  return canModerate(user.role);
}

/** Motivo da recusa, para o route traduzir em status HTTP e mensagem. */
export type RecusaResposta =
  | 'sos_terminal'
  | 'autor_do_sos'
  | 'nao_elegivel';

/**
 * Decide se o usuário pode se declarar socorrista de um SOS.
 *
 * Existe porque `POST /api/sos/[id]/respond` não tinha autorização nenhuma:
 * qualquer conta autenticada inseria a própria linha em `sos_responders`, o
 * que (a) liberava a coordenada exata do acidentado pelo filtro `canSeePos` e
 * (b) permitia congelar a escalada mandando 'a_caminho'. Ver
 * docs/AUDITORIA-2026-08-23.md (P0-2) e docs/MAQUINA-ESTADOS-SOS.md.
 *
 * Três caminhos legítimos, qualquer um serve:
 *
 * 1. `foiNotificado` — o sistema escolheu essa pessoa por proximidade no
 *    disparo ou numa escalada. Caminho normal.
 * 2. `dentroDoRaio` — chegou na praia depois do disparo e abriu o app. A
 *    posição TEM que vir de `user_presence` (gravada pelo servidor), nunca do
 *    corpo do pedido: senão bastaria mentir a coordenada para entrar. Fechar
 *    este caminho impediria um velejador ao lado de ajudar, o que num sistema
 *    de vida é pior que o vazamento que ele fecha — e para passar por aqui o
 *    atacante precisa já estar fisicamente perto, que é justamente o dado que
 *    ele tentaria descobrir.
 * 3. `ehModerador` — coordenação de resgate.
 */
export function podeResponderSos(args: {
  user: UserAuthContext;
  sosAuthorId: string;
  statusSos: 'ativo' | 'em_atendimento' | 'resolvido' | 'cancelado' | 'falso_alarme';
  foiNotificado: boolean;
  dentroDoRaio: boolean;
}): { ok: true } | { ok: false; motivo: RecusaResposta } {
  if (
    args.statusSos === 'resolvido' ||
    args.statusSos === 'cancelado' ||
    args.statusSos === 'falso_alarme'
  ) {
    return { ok: false, motivo: 'sos_terminal' };
  }

  // O autor pede socorro, não se socorre. Deixar passar sujaria a contagem de
  // responsáveis vivos e ele congelaria a própria escalada sem querer.
  if (args.user.id === args.sosAuthorId) {
    return { ok: false, motivo: 'autor_do_sos' };
  }

  if (args.foiNotificado || args.dentroDoRaio || canModerate(args.user.role)) {
    return { ok: true };
  }

  return { ok: false, motivo: 'nao_elegivel' };
}

/**
 * Verifica se o usuário pode organizar um downwind: papéis que já carregam
 * autoridade de operação na comunidade (admin, moderador, instrutor), OU
 * liberação pontual via `pode_organizar_downwind` — para um rider de
 * confiança sem precisar promovê-lo a um papel com outros poderes.
 */
export function canOrganizeDownwind(user: UserAuthContext): boolean {
  if (user.role === 'admin' || user.role === 'moderator' || user.role === 'instructor') {
    return true;
  }
  return user.pode_organizar_downwind === true;
}

/**
 * Verifica se o usuário pode ler/escrever numa sala de DM (`dm:<a>:<b>`).
 * Só os dois participantes — DIFERENTE de canResolveSos/canManageListing
 * acima, moderação NÃO ganha acesso automático aqui: uma conversa privada
 * entre dois velejadores não é recurso de moderação, é conteúdo privado. Ver
 * app/api/chat/messages/route.ts.
 */
export function canAccessDm(userId: string, participanteA: string, participanteB: string): boolean {
  return userId === participanteA || userId === participanteB;
}
