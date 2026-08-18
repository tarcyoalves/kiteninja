/**
 * Forma e validação do vídeo de abertura e playlist com rodízio.
 *
 * Vive separado de `lib/settings.ts` (que abre conexão com o banco) para poder
 * ser importado pelo cliente e testado sem banco nenhum: é validação pura de
 * dado que o admin edita e que governa a primeira tela do app.
 */

/** Chave do vídeo de abertura em `app_settings`. */
export const INTRO_VIDEO_KEY = 'intro_video';

/** Teto do trecho: abertura longa demais vira obstáculo, não boas-vindas. */
export const MAX_TRECHO_SEG = 15;
export const MIN_TRECHO_SEG = 1.5;

/**
 * Limite de tamanho de arquivo: 50MB permite vídeos em alta definição Full HD / 4K
 * nativos sem necessidade de compressão destrutiva externa prévia.
 */
export const MAX_BYTES_VIDEO = 50 * 1024 * 1024;

/** Formatos que todo navegador de celular toca sem plugin. */
export const TIPOS_VIDEO_ACEITOS = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

export interface IntroVideo {
  /** Identificador único do item na playlist. */
  id?: string;
  /** URL pública no Vercel Blob ou CDN. */
  url: string;
  /** Início do trecho, em segundos. */
  inicioSeg: number;
  /** Fim do trecho, em segundos. */
  fimSeg: number;
  /** Quadro de capa em data URL, exibido enquanto o vídeo carrega. */
  posterDataUrl?: string;
  /** Se falso, o item não entra na reprodução nem no rodízio. */
  ativo: boolean;
  /** Nome do arquivo original ou título do vídeo. */
  nomeArquivo?: string;
  /** Título customizado exibido no painel de administração. */
  titulo?: string;
  /** Duração total do arquivo, para o editor reabrir no lugar certo. */
  duracaoSeg?: number;
  /** Data em que o vídeo foi incluído na galeria. */
  criadoEm?: string;
}

export type ModoRodizio = 'rodizio' | 'aleatorio' | 'unico';

export interface IntroVideoConfig {
  modo: ModoRodizio;
  videos: IntroVideo[];
}

/**
 * Valida um único item de vídeo.
 */
export function validarItemVideo(raw: unknown): IntroVideo | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;

  if (typeof v.url !== 'string' || v.url.length === 0) return null;
  // Só aceitamos https: a abertura roda antes do login e uma URL javascript:
  // ou data: aqui seria conteúdo arbitrário executado na primeira tela.
  if (!v.url.startsWith('https://')) return null;

  const inicio = Number(v.inicioSeg);
  const fim = Number(v.fimSeg);
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return null;
  if (inicio < 0 || fim <= inicio) return null;

  const poster =
    typeof v.posterDataUrl === 'string' && v.posterDataUrl.startsWith('data:image/')
      ? v.posterDataUrl
      : undefined;

  return {
    id: typeof v.id === 'string' && v.id.length > 0 ? v.id : `vid-${Math.random().toString(36).slice(2, 9)}`,
    url: v.url,
    inicioSeg: inicio,
    fimSeg: fim,
    posterDataUrl: poster,
    ativo: v.ativo !== false,
    nomeArquivo: typeof v.nomeArquivo === 'string' ? v.nomeArquivo : undefined,
    titulo: typeof v.titulo === 'string' ? v.titulo : undefined,
    duracaoSeg: Number.isFinite(Number(v.duracaoSeg)) ? Number(v.duracaoSeg) : undefined,
    criadoEm: typeof v.criadoEm === 'string' ? v.criadoEm : undefined,
  };
}

/**
 * Valida a configuração completa (com suporte a múltiplos vídeos e retrocompatibilidade
 * com o formato legado de vídeo único).
 */
export function parseIntroVideoConfig(raw: unknown): IntroVideoConfig {
  if (raw === null || typeof raw !== 'object') {
    return { modo: 'rodizio', videos: [] };
  }

  const obj = raw as Record<string, unknown>;

  // Caso seja formato novo com array de vídeos
  if (Array.isArray(obj.videos)) {
    const modo: ModoRodizio =
      obj.modo === 'aleatorio' || obj.modo === 'unico' ? obj.modo : 'rodizio';
    const videos: IntroVideo[] = [];
    for (const item of obj.videos) {
      const v = validarItemVideo(item);
      if (v) videos.push(v);
    }
    return { modo, videos };
  }

  // Caso seja formato legado de vídeo único direto
  const videoLegado = validarItemVideo(raw);
  if (videoLegado) {
    return {
      modo: 'rodizio',
      videos: [videoLegado],
    };
  }

  return { modo: 'rodizio', videos: [] };
}

/**
 * Valida o JSONB vindo do banco. Devolve `null` quando não há vídeo utilizável
 * — nesse caso a tela cai na animação vetorial em vez de tentar tocar uma URL
 * inválida. Compatível com a assinatura anterior.
 */
export function parseIntroVideo(raw: unknown): IntroVideo | null {
  const config = parseIntroVideoConfig(raw);
  const ativos = config.videos.filter((v) => v.ativo);
  if (ativos.length === 0) return null;
  return ativos[0];
}

/**
 * Escolhe o próximo vídeo para exibição de acordo com o modo configurado (rodízio ou aleatório).
 */
export function escolherVideoParaExibicao(
  config: IntroVideoConfig,
  ultimoIdExibido?: string | null
): IntroVideo | null {
  const ativos = config.videos.filter((v) => v.ativo);
  if (ativos.length === 0) return null;
  if (ativos.length === 1) return ativos[0];

  if (config.modo === 'aleatorio') {
    // Sorteia um vídeo diferente do último exibido, se houver mais de um ativo
    const outros = ultimoIdExibido ? ativos.filter((v) => v.id !== ultimoIdExibido) : ativos;
    const lista = outros.length > 0 ? outros : ativos;
    const index = Math.floor(Math.random() * lista.length);
    return lista[index];
  }

  // Modo 'rodizio' (sequencial): pega o próximo após o último
  if (ultimoIdExibido) {
    const idx = ativos.findIndex((v) => v.id === ultimoIdExibido);
    if (idx !== -1) {
      const proximoIdx = (idx + 1) % ativos.length;
      return ativos[proximoIdx];
    }
  }

  return ativos[0];
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
