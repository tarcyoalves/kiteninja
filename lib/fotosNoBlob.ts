/**
 * Fotos de relato, avatar e anúncio no Vercel Blob (V01).
 *
 * POR QUE ISTO EXISTE
 *
 * Até 12/11/2026 essas três fotos eram gravadas como texto base64 DENTRO do
 * Postgres (`posts.photo_url`, `users.avatar_url`, `listing_photos.data_url`),
 * até ~1,5 MB cada. O Neon Free tem 0,5 GB: umas 300 fotos enchiam o banco, e
 * `GET /api/posts` devolvia até 100 relatos com a foto embutida (dezenas de MB
 * no 4G). As fotos de velejo já iam direto do celular para o Blob
 * (lib/fotosDoVelejo.ts); aqui o mesmo caminho vale para os outros três tipos.
 *
 * Mesmo arquivo para o cliente (que escolhe o prefixo) e para o servidor (rota
 * do token e rotas que gravam): regra duplicada diverge.
 */

export type TipoDeFoto = 'relato' | 'avatar' | 'anuncio';

/** Prefixo obrigatório do caminho no Blob. A rota do token recusa os outros. */
export const PREFIXO_BLOB: Record<TipoDeFoto, string> = {
  relato: 'relatos/',
  avatar: 'avatares/',
  anuncio: 'anuncios/',
};

/**
 * Teto do arquivo que SOBE ao Blob (já comprimido pelo cliente: algumas
 * centenas de KB). Folgado de propósito; serve para barrar abuso, não o uso
 * normal. Avatar é menor porque é redesenhado em 512 px.
 */
export const MAX_BYTES_BLOB: Record<TipoDeFoto, number> = {
  relato: 5 * 1024 * 1024,
  avatar: 2 * 1024 * 1024,
  anuncio: 5 * 1024 * 1024,
};

/** O cliente sempre comprime para JPEG; PNG/WebP ficam por compatibilidade. */
export const TIPOS_ACEITOS_NO_BLOB: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/** Qual tipo de foto este caminho do Blob representa (ou null se nenhum). */
export function tipoDoCaminho(pathname: string): TipoDeFoto | null {
  for (const tipo of Object.keys(PREFIXO_BLOB) as TipoDeFoto[]) {
    if (pathname.startsWith(PREFIXO_BLOB[tipo])) return tipo;
  }
  return null;
}

export const MENSAGEM_BLOB_NAO_CONFIGURADO =
  'Armazenamento de fotos não configurado neste ambiente (falta BLOB_READ_WRITE_TOKEN). Não foi possível enviar a foto.';

const TETO_URL = 2_000;

/**
 * A URL é de um arquivo do Vercel Blob? `https://<loja>.public.blob.vercel-storage.com/...`
 *
 * Mais estrita que `urlDeFotoValida` (velejos), que aceita qualquer https.
 * Para relato e anúncio vale a regra do marketplace: URL de host arbitrário
 * transformaria o feed num vetor de requisição a terceiros (quem abrisse o
 * feed entregaria IP e User-Agent ao host do autor). Só o nosso storage entra.
 *
 * Usa `new URL` e confere o hostname, e não um `startsWith` no texto inteiro:
 * `https://x.blob.vercel-storage.com.evil.com/` e
 * `https://evil.com/?.blob.vercel-storage.com` passariam num teste de texto.
 */
export function urlDoBlobValida(valor: unknown): boolean {
  if (typeof valor !== 'string') return false;
  const v = valor.trim();
  if (v.length === 0 || v.length > TETO_URL) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  return u.hostname.endsWith('.blob.vercel-storage.com');
}

/** Foto antiga: data URL de imagem rasterizada (nada de svg/html). */
const DATA_URL_IMAGEM = /^data:image\/(jpeg|jpg|png|webp);base64,/i;

/**
 * Foto de relato / anúncio aceita na ENTRADA.
 *
 * Aceita URL do Blob (caminho novo) E `data:image/` (cliente antigo).
 * Decisão de compatibilidade: abas abertas antes do deploy podem ainda mandar
 * base64 por alguns dias, e recusar derrubaria a publicação delas. Dá para
 * fechar depois — ver docs/diario/2026-11-12-V01-V02.md.
 */
export function fotoAceitaNaEntrada(valor: unknown, maxCharsDataUrl: number): boolean {
  if (typeof valor !== 'string' || valor.length === 0) return false;
  if (urlDoBlobValida(valor)) return true;
  return valor.length <= maxCharsDataUrl && DATA_URL_IMAGEM.test(valor);
}
