/**
 * Forma e validação do vídeo de abertura.
 *
 * Vive separado de `lib/settings.ts` (que abre conexão com o banco) para poder
 * ser importado pelo cliente e testado sem banco nenhum: é validação pura de
 * dado que o admin edita e que governa a primeira tela do app.
 */

/** Chave do vídeo de abertura em `app_settings`. */
export const INTRO_VIDEO_KEY = 'intro_video';

/** Teto do trecho: abertura longa demais vira obstáculo, não boas-vindas. */
export const MAX_TRECHO_SEG = 12;
export const MIN_TRECHO_SEG = 1.5;

/** Acima disso a abertura pesa mais que o resto do app somado. */
export const MAX_BYTES_VIDEO = 12 * 1024 * 1024;

/** Formatos que todo navegador de celular toca sem plugin. */
export const TIPOS_VIDEO_ACEITOS = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

export interface IntroVideo {
  /** URL pública no Vercel Blob. */
  url: string;
  /** Início do trecho, em segundos. */
  inicioSeg: number;
  /** Fim do trecho, em segundos. */
  fimSeg: number;
  /** Quadro de capa em data URL, exibido enquanto o vídeo carrega. */
  posterDataUrl?: string;
  /** Se falso, o app volta a usar a animação vetorial. */
  ativo: boolean;
  /** Nome do arquivo original, só para o admin se orientar no painel. */
  nomeArquivo?: string;
  /** Duração total do arquivo, para o editor reabrir no lugar certo. */
  duracaoSeg?: number;
}

/**
 * Valida o JSONB vindo do banco. Devolve `null` quando não há vídeo utilizável
 * — nesse caso a tela cai na animação vetorial em vez de tentar tocar uma URL
 * inválida.
 */
export function parseIntroVideo(raw: unknown): IntroVideo | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;

  if (typeof v.url !== 'string' || v.url.length === 0) return null;
  // Só aceitamos https: a abertura roda antes do login e uma URL javascript:
  // ou data: aqui seria conteúdo arbitrário executado na primeira tela.
  if (!v.url.startsWith('https://')) return null;
  if (v.ativo === false) return null;

  const inicio = Number(v.inicioSeg);
  const fim = Number(v.fimSeg);
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return null;
  if (inicio < 0 || fim <= inicio) return null;

  const poster =
    typeof v.posterDataUrl === 'string' && v.posterDataUrl.startsWith('data:image/')
      ? v.posterDataUrl
      : undefined;

  return {
    url: v.url,
    inicioSeg: inicio,
    fimSeg: fim,
    posterDataUrl: poster,
    ativo: true,
    nomeArquivo: typeof v.nomeArquivo === 'string' ? v.nomeArquivo : undefined,
    duracaoSeg: Number.isFinite(Number(v.duracaoSeg)) ? Number(v.duracaoSeg) : undefined,
  };
}

/**
 * Confere se o trecho é utilizável. Compartilhada entre a rota e o painel para
 * que a mensagem de erro seja a mesma nos dois lados.
 */
export function erroDoTrecho(inicioSeg: number, fimSeg: number): string | null {
  if (!Number.isFinite(inicioSeg) || !Number.isFinite(fimSeg)) return 'Trecho inválido.';
  if (inicioSeg < 0) return 'O início do trecho não pode ser negativo.';
  const dur = fimSeg - inicioSeg;
  if (dur < MIN_TRECHO_SEG) return `O trecho precisa ter pelo menos ${MIN_TRECHO_SEG}s.`;
  if (dur > MAX_TRECHO_SEG) return `O trecho não pode passar de ${MAX_TRECHO_SEG}s.`;
  return null;
}
