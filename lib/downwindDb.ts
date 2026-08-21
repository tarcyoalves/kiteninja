import 'server-only';

import { sql } from './db';
import { hashToken } from './auth';
import type { MinhaParticipacao } from './downwindAcesso';
import type { DownwindStatus } from './downwind';

/**
 * Consultas de downwind compartilhadas entre rotas.
 *
 * Existe para o chat da sala do downwind e as rotas do mapa fazerem a MESMA
 * pergunta de participação, com a mesma query. Duas versões da pergunta "esta
 * pessoa está neste downwind?" divergindo é como um canal privado vaza: basta
 * uma delas esquecer um filtro.
 *
 * Só queries. Toda decisão de acesso mora em lib/downwindAcesso.ts, que é puro
 * e testado.
 */

/** UUID de rota, validado antes de virar parâmetro de query. */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function ehUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && UUID_RE.test(valor);
}

/**
 * Status do downwind, ou null se ele não existe.
 *
 * `null` é deliberadamente o mesmo valor que a camada de acesso usa para
 * "não encontrado", para a rota não precisar distinguir os dois casos — e
 * assim não conseguir vazar a diferença por acidente.
 */
export async function buscarStatusDownwind(
  downwindId: string
): Promise<DownwindStatus | null> {
  if (!ehUuid(downwindId)) return null;
  const rows = await sql`SELECT status FROM downwinds WHERE id = ${downwindId} LIMIT 1`;
  if (rows.length === 0) return null;
  return String((rows[0] as Record<string, unknown>).status) as DownwindStatus;
}

/** A participação do usuário neste downwind, ou null se ele não participa. */
export async function buscarParticipacao(
  downwindId: string,
  userId: string
): Promise<MinhaParticipacao | null> {
  if (!ehUuid(downwindId)) return null;
  const rows = await sql`
    SELECT papel, estado, eh_organizador, apoio_user_id
    FROM downwind_participantes
    WHERE downwind_id = ${downwindId} AND user_id = ${userId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    papel: r.papel as MinhaParticipacao['papel'],
    estado: r.estado as MinhaParticipacao['estado'],
    ehOrganizador: Boolean(r.eh_organizador),
    apoioUserId: r.apoio_user_id ? String(r.apoio_user_id) : null,
  };
}

/**
 * Carrega downwind + participação numa ida só ao banco.
 *
 * As rotas do mapa precisam sempre dos dois juntos, e o Neon free suspende por
 * inatividade — cada round-trip a mais aparece como lentidão real na primeira
 * carga, justamente quando o velejador está abrindo o app na praia.
 */
export async function buscarContexto(
  downwindId: string,
  userId: string
): Promise<{ status: DownwindStatus | null; participacao: MinhaParticipacao | null }> {
  if (!ehUuid(downwindId)) return { status: null, participacao: null };

  const rows = await sql`
    SELECT d.status, dp.papel, dp.estado, dp.eh_organizador, dp.apoio_user_id
    FROM downwinds d
    LEFT JOIN downwind_participantes dp
      ON dp.downwind_id = d.id AND dp.user_id = ${userId}
    WHERE d.id = ${downwindId}
    LIMIT 1
  `;
  if (rows.length === 0) return { status: null, participacao: null };

  const r = rows[0] as Record<string, unknown>;
  // `papel` nulo significa que o LEFT JOIN não achou linha de participação —
  // a pessoa não está neste downwind.
  const participacao: MinhaParticipacao | null = r.papel
    ? {
        papel: r.papel as MinhaParticipacao['papel'],
        estado: r.estado as MinhaParticipacao['estado'],
        ehOrganizador: Boolean(r.eh_organizador),
        apoioUserId: r.apoio_user_id ? String(r.apoio_user_id) : null,
      }
    : null;

  return { status: String(r.status) as DownwindStatus, participacao };
}

export interface ConviteDownwindValido {
  id: string;
  downwindId: string;
  downwindNome: string;
}

/**
 * Valida o link de 12h para apoio em terra sem conta (ver lib/schema.sql,
 * `downwind_convites`) — usado tanto pelo Server Component da página pública
 * (app/dw-motorista/[token]/page.tsx, que pré-valida antes de renderizar
 * qualquer formulário, mesmo padrão de `findUsableInvite` em
 * app/convite/[token]/page.tsx) quanto pela rota que efetivamente cria a
 * conta-convidada. Uma função só, para as duas nunca poderem divergir sobre
 * o que conta como "válido".
 *
 * `null` cobre token errado, revogado, expirado, sem usos restantes, OU
 * downwind que já terminou — de propósito uma mensagem só para todos esses
 * casos no chamador, sem distinguir qual foi (não é privacidade aqui, é só
 * não complicar a UI com motivos que o convidado não pode fazer nada a
 * respeito de qualquer forma).
 */
export async function buscarConviteValido(token: string): Promise<ConviteDownwindValido | null> {
  const rows = await sql`
    SELECT c.id, c.downwind_id, d.nome, d.status
    FROM downwind_convites c
    JOIN downwinds d ON d.id = c.downwind_id
    WHERE c.token_hash = ${hashToken(token)}
      AND c.revogado_em IS NULL
      AND c.expira_em > NOW()
      AND (c.max_usos IS NULL OR c.usos < c.max_usos)
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0] as Record<string, unknown>;
  const status = String(r.status);
  if (status !== 'aberto' && status !== 'em_andamento') return null;
  return { id: String(r.id), downwindId: String(r.downwind_id), downwindNome: String(r.nome) };
}

/**
 * Todos os participantes, no formato que lib/downwind.ts consome.
 *
 * Usada pelo encerramento, onde uma lista vazia por falha de query seria
 * interpretada como "não há ninguém na água" — ver a guarda em
 * `podeEncerrarDownwindComoUsuario`.
 */
export async function listarParticipantes(downwindId: string) {
  const rows = await sql`
    SELECT user_id, papel, eh_organizador, estado
    FROM downwind_participantes
    WHERE downwind_id = ${downwindId}
  `;
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      userId: String(r.user_id),
      papel: r.papel as MinhaParticipacao['papel'],
      ehOrganizador: Boolean(r.eh_organizador),
      estado: r.estado as MinhaParticipacao['estado'],
    };
  });
}
