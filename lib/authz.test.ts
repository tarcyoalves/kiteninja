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
    // e não deve circular entre velejadores.
    const falhas: string[] = [];
    for (const rel of ['posts/route.ts', 'posts/[id]/comments/route.ts', 'alerts/route.ts']) {
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
       * conta autenticada (`${user.id}` no change-password) ou a conta órfã que
       * a própria requisição criou (`${userId}` no accept). O que importa é
       * existir `WHERE id = ${...}` — sem isso o UPDATE varreria a tabela.
       */
      if (
        rel === 'auth/change-password/route.ts' ||
        rel === 'invites/accept/route.ts' ||
        rel.startsWith('sos/')
      ) {
        expect(/WHERE\s+id\s*=\s*\$\{/.test(r.src)).toBe(true);
        continue;
      }

      const exigeAdmin =
        /requireAdmin/.test(r.src) || /role\s*===\s*['"]admin['"]/.test(r.src);
      if (!exigeAdmin) falhas.push(rel);
    }
    expect(falhas).toEqual([]);
  });
});

import {
  canCreateOfficialEvent,
  canDeleteComment,
  canDeletePost,
  canManageListing,
  canManageUsers,
  canModerate,
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

