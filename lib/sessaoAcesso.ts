import { sql } from './db';
import { HttpError } from './auth';
import { podeVerSessao } from './social';

export const MSG_SESSAO_NAO_ENCONTRADA = 'Sessão não encontrada.';

export interface SessaoVisibilidade {
  autorId: string;
  isPublic: boolean;
}

interface SessaoRow {
  user_id: unknown;
  is_public: unknown;
}

/**
 * Carrega autor/visibilidade da sessão e garante que `viewerId` pode vê-la
 * (`lib/social.ts`, `podeVerSessao`) — lança 404 se não existir OU se existir
 * mas for privada de terceiro.
 *
 * Extraído de app/api/sessions/[id]/like/route.ts (onde nasceu) porque agora
 * tem 4 call-sites: curtir, GET de detalhe, GET e POST de comentários — o
 * limite em que duplicar deixa de valer a pena.
 *
 * Mensagem ÚNICA nos dois casos (não existe / existe mas é privada de
 * terceiro): sem isso, dava para usar a diferença de resposta como oráculo de
 * "esse id de sessão existe?" testando ids ao acaso.
 */
export async function exigirSessaoVisivel(id: string, viewerId: string): Promise<SessaoVisibilidade> {
  const rows = (await sql`
    SELECT user_id, is_public FROM sessions_log WHERE id = ${id} LIMIT 1
  `) as SessaoRow[];
  const row = rows[0];
  const visibilidade: SessaoVisibilidade | undefined = row
    ? { autorId: String(row.user_id), isPublic: Boolean(row.is_public) }
    : undefined;
  if (!visibilidade || !podeVerSessao(visibilidade, viewerId)) {
    throw new HttpError(404, MSG_SESSAO_NAO_ENCONTRADA);
  }
  return visibilidade;
}
