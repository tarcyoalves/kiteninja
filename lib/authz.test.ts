/**
 * Contrato de autorização das rotas de API.
 *
 * O app é fechado por convite, então "esconder a tela" não protege nada: sem
 * este teste, alguém adiciona uma rota nova, esquece o `requireUser()`, e o dado
 * passa a sair por GET direto sem ninguém notar. Aqui a lista de rotas públicas
 * é explícita — rota nova sem guarda quebra o teste, e incluir na lista pública
 * exige uma decisão consciente no diff.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const API_DIR = join(process.cwd(), 'app', 'api');

/**
 * Rotas que PRECISAM ser acessíveis sem sessão, com a justificativa.
 * Qualquer adição aqui é decisão de segurança e deve ser revisada.
 */
const PUBLICAS: Record<string, string> = {
  'auth/login/route.ts': 'é como a sessão nasce',
  'auth/logout/route.ts': 'encerrar sessão não pode depender de sessão válida',
  'auth/recover-password/route.ts': 'solicitação de redefinição para quem perdeu acesso',
  'auth/reset-password/route.ts': 'redefinição de senha com token de uso único',
  'invites/validate/route.ts': 'o convidado ainda não tem conta',
  'invites/accept/route.ts': 'cria a conta a partir do convite',
  'intro-video/route.ts':
    'a abertura toca antes do login; só devolve a URL de um arquivo em storage público, nada do usuário',
};

function listarRotas(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listarRotas(full));
    } else if (entry === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

const rotas = listarRotas(API_DIR).map((full) => ({
  rel: relative(API_DIR, full).split('\\').join('/'),
  src: readFileSync(full, 'utf8'),
}));

describe('autorização das rotas de API', () => {
  it('encontrou rotas para auditar', () => {
    expect(rotas.length).toBeGreaterThan(10);
  });

  it('toda rota exige sessão, exceto as públicas declaradas', () => {
    const desprotegidas = rotas
      .filter((r) => !(r.rel in PUBLICAS))
      .filter((r) => !/requireUser|requireAdmin|getSessionUser/.test(r.src))
      .map((r) => r.rel);

    expect(desprotegidas).toEqual([]);
  });

  it('as rotas públicas declaradas ainda existem', () => {
    const conhecidas = new Set(rotas.map((r) => r.rel));
    for (const p of Object.keys(PUBLICAS)) {
      expect(conhecidas.has(p), `${p} está na lista de públicas mas não existe`).toBe(true);
    }
  });

  it('rotas de admin usam requireAdmin, não só requireUser', () => {
    const falhas = rotas
      .filter((r) => r.rel.startsWith('admin/'))
      .filter((r) => !/requireAdmin/.test(r.src))
      .map((r) => r.rel);

    expect(falhas).toEqual([]);
  });

  it('/api/spots suporta sessão e acesso público aos dados de vento', () => {
    const spots = rotas.find((r) => r.rel === 'spots/route.ts');
    expect(spots).toBeDefined();
    expect(spots!.src).toMatch(/requireUser|getSessionUser/);
  });

  it('nenhuma rota devolve o hash de senha na resposta', () => {
    // Ler o hash (login) e gravar o hash (troca de senha, aceite de convite) é
    // legítimo. O que nunca pode acontecer é o valor sair no corpo da resposta,
    // porque hash vazado permite ataque de dicionário offline.
    const falhas: string[] = [];
    for (const r of rotas) {
      if (!/password_hash/.test(r.src)) continue;
      // SELECT * traz tudo, inclusive o hash: proibido em rota que devolve linha.
      if (/SELECT\s+\*\s+FROM\s+users/i.test(r.src)) {
        falhas.push(`${r.rel}: SELECT * em users`);
      }
      // `password_hash` dentro de um objeto de retorno.
      if (/return\s*\{[\s\S]{0,300}password_hash/.test(r.src)) {
        falhas.push(`${r.rel}: password_hash no retorno`);
      }
      // RETURNING trazendo o hash de volta para o handler.
      if (/RETURNING[^`;]*password_hash/i.test(r.src)) {
        falhas.push(`${r.rel}: password_hash no RETURNING`);
      }
    }
    expect(falhas).toEqual([]);
  });

  it('nenhuma rota expõe e-mail de terceiros em listagem pública do app', () => {
    // O feed e os comentários mostram nome e rider_id; e-mail é dado de contato
    // e não deve circular entre velejadores. riders/search/route.ts entra na
    // mesma disciplina (seção 4.5 do plano de rede social): uma busca aberta
    // de velejadores é exatamente onde esse vazamento aconteceria.
    const falhas: string[] = [];
    for (const rel of [
      'posts/route.ts',
      'posts/[id]/comments/route.ts',
      'alerts/route.ts',
      'riders/search/route.ts',
      'riders/[id]/route.ts',
    ]) {
      const r = rotas.find((x) => x.rel === rel);
      if (!r) continue;
      if (/u\.email|users\.email/.test(r.src)) falhas.push(rel);
    }
    expect(falhas).toEqual([]);
  });

  /**
   * Mutações que não filtram por `user_id` e por que são legítimas.
   * A chave é `arquivo::trecho-do-SQL`.
   */
  const MUTACOES_JUSTIFICADAS: Record<string, string> = {
    'auth/change-password/route.ts::UPDATE users':
      'filtra por id = user.id, que é a própria conta autenticada',
    'invites/accept/route.ts::DELETE FROM users':
      'remove a conta órfã que a própria requisição criou ao perder a corrida do convite',
    'alerts/[id]/route.ts::UPDATE safety_alerts':
      'resolver alerta é ação de moderação; a rota exige requireAdmin',
    'chat/messages/[id]/route.ts::DELETE FROM chat_messages':
      'moderação de sala pública: o ramo sem filtro é alcançável apenas com role admin, e o ramo do autor comum filtra por user_id',
    'sos/active/route.ts::UPDATE sos_alerts':
      'escalada preguiçosa de raio: sistema amplia a busca para novos socorristas sem expor dados privados',
    'sos/[id]/respond/route.ts::UPDATE sos_alerts':
      'socorrista a caminho: muda status de ativo para em_atendimento para cessar a escalada',
    'sos/[id]/route.ts::UPDATE sos_alerts':
      'encerramento de SOS: autorizado apenas para o próprio autor ou moderação via canResolveSos',
    'events/route.ts::DELETE FROM downwinds':
      'rollback manual de criação de downwind: desfaz o downwind que a própria requisição acabou de criar, pelo id retornado, se o passo seguinte (inserir o participante organizador) falhar',
    'events/route.ts::DELETE FROM events':
      'rollback manual de criação de downwind: desfaz o evento que a própria requisição acabou de criar, pelo id retornado, se downwinds/downwind_participantes falhar depois',
    'downwind/[id]/status/route.ts::UPDATE downwinds':
      'muda o status de UM downwind (WHERE id = ${id}), não dado de usuário; autorizado antes da query por lib/downwindAcesso.ts (podeIniciarDownwind/podeCancelarDownwind/podeEncerrarDownwindComoUsuario)',
    'downwind/[id]/status/route.ts::DELETE FROM downwind_posicoes':
      'purga preguiçosa de trilha de downwinds já encerrados/cancelados há mais de 7 dias (retenção, não dado ativo) — só roda depois que o encerramento, já autorizado, foi confirmado',
    'downwind/[id]/status/route.ts::DELETE FROM users':
      'purga preguiçosa das contas-convidadas do link de 12h (downwind_guest_of IS NOT NULL) com mais de 2 dias — nunca atinge conta normal (a coluna é NULL para todas), e não é dado de OUTRO usuário sendo apagado por alguém: é lixo de sessão descartável cuja janela de acesso real já fechou',
    'events/[id]/route.ts::DELETE FROM downwinds':
      'apaga UM downwind (WHERE id = ${downwindId}) vinculado ao evento que está sendo apagado; autorizado antes por canModerate ou pelo criado_por do próprio downwind',
    'events/[id]/route.ts::DELETE FROM events':
      'apaga UM evento (WHERE id = ${id}), não dado de usuário; mesma autorização acima',
    'downwind/convite/[token]/entrar/route.ts::UPDATE downwind_convites':
      'incrementa usos de UM convite (WHERE id = ${convite.id}), já validado (não revogado, não expirado, dentro do limite) por buscarConviteValido logo acima na mesma rota',
    'downwind/[id]/participantes/[userId]/route.ts::UPDATE downwinds':
      'auto-encerramento: quando alguém sai da água (encerrado/desistiu) e isso esvazia o quórum de velejadores, muda o status de UM downwind (WHERE id = ${id} AND status = \'em_andamento\'), não dado de usuário; usa a MESMA podeEncerrarDownwind (lib/downwind.ts) que autoriza o encerramento manual em status/route.ts — sem isto o downwind ficava travado em em_andamento pra sempre quando o único velejador encerrava a própria participação',
    'riders/[id]/follow/route.ts::DELETE FROM user_follows':
      'deixar de seguir filtra por follower_id = user.id, não por user_id — mas follower_id É o dono da linha nesta tabela (user_follows não tem coluna user_id nem id: a PK é (follower_id, following_id)). WHERE follower_id = ${user.id} garante que só a própria relação "eu sigo" pode ser apagada, nunca a de outro velejador.',
    'sessions/[id]/comments/[commentId]/route.ts::DELETE FROM session_comments':
      'apagar comentário: o filtro SQL é id + session_id (não user_id) porque moderador/admin precisam apagar comentário de TERCEIRO, não só o próprio — quem decide é canDeleteComment (lib/authz.ts) em código antes do DELETE, mesma família de "checagem em código substitui o filtro por dono" de chat/messages/[id]/route.ts::DELETE FROM chat_messages logo acima. Prova positiva em lib/authz.test.ts, describe("matriz RBAC"): canDeleteComment autoriza o autor do próprio comentário e moderadores/admins de um comentário de terceiro, e nega um estranho sem privilégio (rider comum tentando apagar comentário alheio) — exatamente os 3 casos que a rota precisa acertar.',
    'notifications/route.ts::UPDATE notifications':
      'marcar as próprias notificações como lidas filtra por recipient_id = user.id, não user_id — mas nesta tabela recipient_id É o dono da linha (quem recebe o aviso), mesmo papel que user_id cumpre nas demais tabelas. WHERE recipient_id = ${user.id} garante que só as próprias notificações podem ser marcadas como lidas, nunca as de outro velejador.',
  };

  it('mutação de dado do usuário filtra por user_id', () => {
    // UPDATE/DELETE sem user_id no WHERE permitiria um velejador editar a
    // sessão de outro. Exceções precisam estar declaradas acima com motivo.
    const falhas: string[] = [];
    for (const r of rotas) {
      if (r.rel.startsWith('admin/')) continue;
      const mutacoes = r.src.match(/(UPDATE|DELETE FROM)\s+\w+[\s\S]{0,400}?`/g) ?? [];
      for (const m of mutacoes) {
        if (/user_id\s*=/.test(m)) continue;
        const verbo = (m.match(/^(UPDATE|DELETE FROM)\s+\w+/) ?? [''])[0];
        if (`${r.rel}::${verbo}` in MUTACOES_JUSTIFICADAS) continue;
        falhas.push(`${r.rel}::${verbo}`);
      }
    }
    expect(falhas).toEqual([]);
  });

  /**
   * Uma exceção declarada não pode virar porta aberta: se um dia alguém remover
   * a checagem de papel e deixar a linha na lista de justificadas, o filtro
   * desaparece silenciosamente. Toda rota que dispensa `user_id` precisa provar
   * que exige admin.
   */
  it('mutação sem user_id só existe atrás de checagem de admin', () => {
    const falhas: string[] = [];
    for (const chave of Object.keys(MUTACOES_JUSTIFICADAS)) {
      const rel = chave.split('::')[0];
      const r = rotas.find((x) => x.rel === rel);
      if (!r) continue;

      /*
       * Casos que não dependem de papel, mas ainda precisam de alvo único: a
       * mutação atinge uma linha identificada por id, e esse id é a própria
       * conta autenticada (`${user.id}` no change-password), a conta órfã que
       * a própria requisição criou (`${userId}` no accept), ou o evento/
       * downwind que a própria requisição acabou de criar e está desfazendo
       * (`${eventId}`/`${downwindId}` no rollback manual de events/route.ts).
       * O que importa é existir `WHERE id = ${...}` — sem isso o
       * UPDATE/DELETE varreria a tabela.
       *
       * downwind/convite/[token]/entrar/route.ts é PÚBLICA de propósito (é o
       * onboarding do link de convidado sem conta) — não tem checagem de
       * papel para exigir. O `${c.id}` do UPDATE é o convite que a MESMA
       * requisição acabou de validar por token (não revogado, não expirado,
       * dentro do limite de usos) algumas linhas acima — mesma família de
       * "alvo que a própria requisição provou ser o certo" dos outros casos
       * desta lista.
       *
       * downwind/[id]/participantes/[userId]/route.ts (auto-encerramento):
       * o `${id}` do UPDATE downwinds é o MESMO downwind cuja participação
       * a rota acabou de mudar, autorizado por podeMudarEstadoDeParticipante
       * mais acima; e a mutação em si só dispara quando podeEncerrarDownwind
       * (regra pura de quórum, não papel) confirma que ninguém mais está na
       * água — não é checagem de admin porque a decisão não é "quem pode
       * mexer", é "o downwind já pode fechar sozinho".
       */
      if (
        rel === 'auth/change-password/route.ts' ||
        rel === 'invites/accept/route.ts' ||
        rel === 'events/route.ts' ||
        rel === 'downwind/[id]/status/route.ts' ||
        rel === 'downwind/[id]/participantes/[userId]/route.ts' ||
        rel === 'downwind/convite/[token]/entrar/route.ts' ||
        rel.startsWith('sos/')
      ) {
        expect(/WHERE\s+id\s*=\s*\$\{/.test(r.src)).toBe(true);
        continue;
      }

      /*
       * riders/[id]/follow/route.ts (deixar de seguir): mesma família de
       * "alvo que a própria requisição provou ser o certo" dos casos acima,
       * só que a coluna que identifica a linha se chama follower_id nesta
       * tabela (user_follows não tem coluna `id`; a PK é composta). WHERE
       * follower_id = ${user.id} É "a própria conta autenticada" — o mesmo
       * papel que ${user.id} cumpre em auth/change-password/route.ts.
       */
      if (rel === 'riders/[id]/follow/route.ts') {
        expect(/WHERE\s+follower_id\s*=\s*\$\{user\.id\}/.test(r.src)).toBe(true);
        continue;
      }

      /*
       * notifications/route.ts (marcar como lidas): mesma família de "coluna
       * de dono com outro nome" do caso acima, só que a coluna se chama
       * recipient_id nesta tabela (quem recebe o aviso). WHERE recipient_id
       * = ${user.id} É "a própria conta autenticada", o mesmo papel que
       * ${user.id} cumpre em auth/change-password/route.ts.
       */
      if (rel === 'notifications/route.ts') {
        expect(/WHERE\s+recipient_id\s*=\s*\$\{user\.id\}/.test(r.src)).toBe(true);
        continue;
      }

      /*
       * Vale a checagem crua (requireAdmin / role === 'admin') e também os
       * helpers de lib/authz, que decidem o papel no lugar da rota: foi
       * trocando a checagem inline por canResolveAlert que a rota de alertas
       * parou de devolver 403 para moderador.
       */
      const exigeAdmin =
        /requireAdmin/.test(r.src) ||
        /role\s*===\s*['"]admin['"]/.test(r.src) ||
        /can(?:Resolve|Moderate|Manage|Delete)\w*\(/.test(r.src);
      if (!exigeAdmin) falhas.push(rel);
    }
    expect(falhas).toEqual([]);
  });
});

import {
  canAccessDm,
  canCreateOfficialEvent,
  canDeleteComment,
  canDeletePost,
  canManageListing,
  canManageUsers,
  canModerate,
  canOrganizeDownwind,
  canResolveAlert,
  canResolveSos,
} from './authz';

describe('matriz RBAC (lib/authz.ts)', () => {
  const admin = { id: 'u-admin', role: 'admin' as const };
  const moderator = { id: 'u-mod', role: 'moderator' as const };
  const instructor = { id: 'u-inst', role: 'instructor' as const };
  const rider = { id: 'u-rider', role: 'rider' as const };
  const stranger = { id: 'u-stranger', role: 'rider' as const };

  it('canModerate autoriza apenas admin e moderator', () => {
    expect(canModerate('admin')).toBe(true);
    expect(canModerate('moderator')).toBe(true);
    expect(canModerate('instructor')).toBe(false);
    expect(canModerate('rider')).toBe(false);
  });

  it('canManageUsers autoriza estritamente admin', () => {
    expect(canManageUsers('admin')).toBe(true);
    expect(canManageUsers('moderator')).toBe(false);
    expect(canManageUsers('instructor')).toBe(false);
    expect(canManageUsers('rider')).toBe(false);
  });

  it('canCreateOfficialEvent autoriza admin, moderator e instructor', () => {
    expect(canCreateOfficialEvent('admin')).toBe(true);
    expect(canCreateOfficialEvent('moderator')).toBe(true);
    expect(canCreateOfficialEvent('instructor')).toBe(true);
    expect(canCreateOfficialEvent('rider')).toBe(false);
  });

  it('canOrganizeDownwind autoriza admin, moderator e instructor pelo role, independente da flag', () => {
    expect(canOrganizeDownwind({ id: 'x', role: 'admin', pode_organizar_downwind: false })).toBe(true);
    expect(canOrganizeDownwind({ id: 'x', role: 'moderator', pode_organizar_downwind: false })).toBe(true);
    expect(canOrganizeDownwind({ id: 'x', role: 'instructor', pode_organizar_downwind: false })).toBe(true);
  });

  it('canOrganizeDownwind: rider comum só com a liberação pontual pode_organizar_downwind', () => {
    expect(canOrganizeDownwind({ id: 'x', role: 'rider', pode_organizar_downwind: true })).toBe(true);
    expect(canOrganizeDownwind({ id: 'x', role: 'rider', pode_organizar_downwind: false })).toBe(false);
    expect(canOrganizeDownwind({ id: 'x', role: 'rider' })).toBe(false);
  });

  it('canAccessDm autoriza os dois participantes, nas duas posições', () => {
    expect(canAccessDm('u-a', 'u-a', 'u-b')).toBe(true);
    expect(canAccessDm('u-b', 'u-a', 'u-b')).toBe(true);
  });

  it('canAccessDm nega terceiro usuário — teste de negação exigido por docs/PLANO-CHAT-DIRETO.md', () => {
    expect(canAccessDm('u-terceiro', 'u-a', 'u-b')).toBe(false);
    // Nem admin/moderador entra aqui de graça: DM é conteúdo privado dos dois
    // participantes, não recurso de moderação (ver comentário na função).
  });

  it('canDeletePost autoriza o autor do post e moderadores/admins, mas não terceiros', () => {
    expect(canDeletePost(rider, 'u-rider')).toBe(true);
    expect(canDeletePost(rider, 'u-other')).toBe(false);
    expect(canDeletePost(moderator, 'u-other')).toBe(true);
    expect(canDeletePost(admin, 'u-other')).toBe(true);
  });

  it('canDeleteComment autoriza o autor do comentário e moderadores/admins', () => {
    expect(canDeleteComment(rider, 'u-rider')).toBe(true);
    expect(canDeleteComment(stranger, 'u-rider')).toBe(false);
    expect(canDeleteComment(moderator, 'u-rider')).toBe(true);
    expect(canDeleteComment(admin, 'u-rider')).toBe(true);
  });

  it('canResolveAlert autoriza admin, moderador ou o próprio autor', () => {
    expect(canResolveAlert(admin)).toBe(true);
    expect(canResolveAlert(moderator)).toBe(true);
    expect(canResolveAlert(rider, 'u-rider')).toBe(true);
    expect(canResolveAlert(rider, 'u-other')).toBe(false);
  });

  it('canManageListing autoriza o autor ou admin/moderador', () => {
    expect(canManageListing(rider, 'u-rider')).toBe(true);
    expect(canManageListing(rider, 'u-other')).toBe(false);
    expect(canManageListing(admin, 'u-other')).toBe(true);
    expect(canManageListing(moderator, 'u-other')).toBe(true);
  });

  it('canResolveSos autoriza o autor, moderador e admin, mas não instrutor/rider comum', () => {
    expect(canResolveSos(admin, 'u-other')).toBe(true);
    expect(canResolveSos(moderator, 'u-other')).toBe(true);
    expect(canResolveSos(rider, 'u-rider')).toBe(true);
    expect(canResolveSos(rider, 'u-other')).toBe(false);
    expect(canResolveSos(instructor, 'u-other')).toBe(false);
  });
});

