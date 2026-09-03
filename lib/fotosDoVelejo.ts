/**
 * Fotos de um velejo: quantas cabem, que formato, e em que ordem.
 *
 * POR QUE ESTAS REGRAS SÃO FUNÇÃO E NÃO ESTÃO SOLTAS NA ROTA
 *
 * Elas valem em três lugares que não se enxergam: o formulário do logbook (que
 * decide o que deixa escolher), a rota que emite o token de upload (que decide
 * o que o Blob aceita) e a rota que grava (que decide o que entra no banco).
 * Regra de limite duplicada em três lugares é regra que diverge — e divergir
 * aqui significa o velejador escolher seis fotos, ver as seis subirem, e
 * descobrir no fim que só quatro foram salvas.
 */

/**
 * Teto de fotos por velejo.
 *
 * Quatro, e não "quantas quiser": o carrossel é uma tira horizontal num card
 * de feed, e passar de meia dúzia de slides transforma navegação em garimpo.
 * O limite é de produto, não técnico — o Blob aguentaria muito mais.
 */
export const MAX_FOTOS_POR_VELEJO = 4;

/**
 * Teto por arquivo, antes da compressão do cliente.
 *
 * O mesmo 12 MB que o logbook já aceitava. Fotos de celular moderno passam
 * disso com frequência; o cliente comprime para ~1280px antes de subir, então
 * o que chega ao Blob é bem menor.
 */
export const MAX_BYTES_POR_FOTO = 12 * 1024 * 1024;

export const TIPOS_DE_FOTO_ACEITOS: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

/** Prefixo obrigatório no Blob. A rota do token recusa qualquer outro. */
export const PREFIXO_BLOB_VELEJO = 'velejos/';

/**
 * A URL pode ser guardada como foto de velejo?
 *
 * Aceita os DOIS formatos de propósito:
 *  - `https://` — o Blob, para tudo que for novo;
 *  - `data:image/` — as fotos antigas, que viviam em `sessions_log.photo_url`
 *    e foram copiadas para `session_photos` na migração sem serem convertidas.
 *
 * Converter aquelas exigiria baixar e re-subir bytes reais durante um build,
 * o que é risco desnecessário para ganho nenhum: elas já funcionam.
 *
 * Recusa qualquer outro esquema. `javascript:` num atributo `src` de imagem
 * não executa nos navegadores atuais, mas a mesma string vai parar em outros
 * lugares (compartilhamento, prévia de link), e validar na entrada custa uma
 * linha.
 */
export function urlDeFotoValida(valor: unknown): boolean {
  if (typeof valor !== 'string') return false;
  const v = valor.trim();
  if (v.length === 0 || v.length > 2_000_000) return false;
  return v.startsWith('https://') || v.startsWith('data:image/');
}

/**
 * Limpa a lista que veio do cliente: descarta inválida, tira repetida, corta
 * no teto.
 *
 * A ORDEM DE ENTRADA É A ORDEM FINAL, e é por isso que esta função existe em
 * vez de um `filter` solto na rota: várias fotos sobem em paralelo e as
 * promessas resolvem fora de sequência. Quem manda é a lista que o velejador
 * montou na tela, não quem chegou primeiro no Blob.
 *
 * Corta em vez de recusar: chegar com cinco fotos é erro de cliente
 * desatualizado, não do velejador. Perder o velejo inteiro por causa da quinta
 * foto seria a pior resposta possível — a sessão é o dado que importa.
 */
export function normalizarFotos(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const item of valor) {
    if (!urlDeFotoValida(item)) continue;
    const url = String(item).trim();
    if (vistas.has(url)) continue;
    vistas.add(url);
    saida.push(url);
    if (saida.length >= MAX_FOTOS_POR_VELEJO) break;
  }
  return saida;
}
