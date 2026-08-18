import { put, del } from '@vercel/blob';
import { revalidatePath } from 'next/cache';
import { handle, readJson } from '@/lib/api';
import { HttpError, requireAdmin } from '@/lib/auth';
import {
  getIntroVideoConfig,
  setIntroVideoConfig,
  clearIntroVideo,
} from '@/lib/settings';
import {
  erroDoTrecho,
  MAX_BYTES_VIDEO,
  MAX_TRECHO_SEG,
  MIN_TRECHO_SEG,
  TIPOS_VIDEO_ACEITOS,
  type IntroVideo,
  type IntroVideoConfig,
  type ModoRodizio,
} from '@/lib/introVideo';

const TIPOS_ACEITOS = new Set<string>(TIPOS_VIDEO_ACEITOS);

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const config = await getIntroVideoConfig();
    return {
      config,
      // Retrocompatibilidade para clientes legados
      video: config.videos[0] ?? null,
      limites: {
        maxBytes: MAX_BYTES_VIDEO,
        maxTrechoSeg: MAX_TRECHO_SEG,
        minTrechoSeg: MIN_TRECHO_SEG,
        tiposAceitos: [...TIPOS_ACEITOS],
      },
    };
  });
}

/**
 * Adiciona um novo vídeo à playlist (via upload de arquivo ou URL direta).
 */
export async function POST(request: Request) {
  return handle(async () => {
    const admin = await requireAdmin();

    const contentType = request.headers.get('content-type') || '';

    // Caso 1: Envio de JSON (para cadastrar vídeo por URL direta)
    if (contentType.includes('application/json')) {
      const body = await readJson(request);
      const b = (body ?? {}) as Record<string, unknown>;
      const url = String(b.url || '').trim();
      if (!url.startsWith('https://')) {
        throw new HttpError(400, 'A URL do vídeo deve começar com https://');
      }

      const inicioSeg = Number(b.inicioSeg) || 0;
      const fimSeg = Number(b.fimSeg) || 6;
      validarTrecho(inicioSeg, fimSeg);

      const novoItem: IntroVideo = {
        id: `vid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        url,
        inicioSeg,
        fimSeg,
        ativo: b.ativo !== false,
        nomeArquivo: typeof b.nomeArquivo === 'string' ? b.nomeArquivo : undefined,
        titulo: typeof b.titulo === 'string' ? b.titulo : 'Vídeo Externo',
        duracaoSeg: Number(b.duracaoSeg) || undefined,
        posterDataUrl: typeof b.posterDataUrl === 'string' ? b.posterDataUrl : undefined,
        criadoEm: new Date().toISOString(),
      };

      const atual = await getIntroVideoConfig();
      const novaConfig: IntroVideoConfig = {
        modo: atual.modo || 'rodizio',
        videos: [novoItem, ...atual.videos],
      };

      await setIntroVideoConfig(novaConfig, admin.id);
      revalidatePath('/api/intro-video');
      return { ok: true, video: novoItem, config: novaConfig };
    }

    // Caso 2: Upload multipart de arquivo
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new HttpError(
        503,
        'Armazenamento de vídeo não configurado. Falta BLOB_READ_WRITE_TOKEN no ambiente.'
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, 'Envio inválido: esperado formulário com o arquivo.');
    }

    const arquivo = form.get('file');
    if (!(arquivo instanceof File)) {
      throw new HttpError(400, 'Nenhum arquivo de vídeo recebido.');
    }

    if (arquivo.size === 0) {
      throw new HttpError(400, 'O arquivo está vazio.');
    }
    if (arquivo.size > MAX_BYTES_VIDEO) {
      const mb = (arquivo.size / 1024 / 1024).toFixed(1);
      throw new HttpError(
        413,
        `Vídeo de ${mb}MB excede o limite de ${MAX_BYTES_VIDEO / 1024 / 1024}MB.`
      );
    }
    if (!TIPOS_ACEITOS.has(arquivo.type)) {
      throw new HttpError(
        415,
        `Formato "${arquivo.type || 'desconhecido'}" não suportado. Use MP4, WebM ou MOV.`
      );
    }

    const inicioSeg = numeroDoForm(form, 'inicioSeg', 0);
    const fimSeg = numeroDoForm(form, 'fimSeg', 6);
    const duracaoSeg = numeroDoForm(form, 'duracaoSeg', 0);
    const titulo = form.get('titulo');
    validarTrecho(inicioSeg, fimSeg);

    const poster = form.get('posterDataUrl');
    const posterDataUrl =
      typeof poster === 'string' && poster.startsWith('data:image/') && poster.length < 500_000
        ? poster
        : undefined;

    const ext = extensaoDe(arquivo.type);
    const enviado = await put(`intro/abertura-${Date.now()}.${ext}`, arquivo, {
      access: 'public',
      contentType: arquivo.type,
      addRandomSuffix: true,
    });

    const novoItem: IntroVideo = {
      id: `vid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url: enviado.url,
      inicioSeg,
      fimSeg,
      posterDataUrl,
      ativo: true,
      nomeArquivo: arquivo.name,
      titulo: typeof titulo === 'string' && titulo.trim() ? titulo.trim() : arquivo.name,
      duracaoSeg: duracaoSeg > 0 ? duracaoSeg : undefined,
      criadoEm: new Date().toISOString(),
    };

    const atual = await getIntroVideoConfig();
    const novaConfig: IntroVideoConfig = {
      modo: atual.modo || 'rodizio',
      videos: [novoItem, ...atual.videos],
    };

    await setIntroVideoConfig(novaConfig, admin.id);
    revalidatePath('/api/intro-video');
    return { ok: true, video: novoItem, config: novaConfig };
  });
}

/**
 * Atualiza modo de rodízio ou ajusta propriedades de um vídeo individual.
 */
export async function PATCH(request: Request) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = await readJson(request);
    const b = (body ?? {}) as Record<string, unknown>;

    const atual = await getIntroVideoConfig();

    // Atualiza o modo de rodízio se fornecido
    let novoModo: ModoRodizio = atual.modo;
    if (b.modo === 'rodizio' || b.modo === 'aleatorio' || b.modo === 'unico') {
      novoModo = b.modo;
    }

    // Se informou um ID específico para atualizar
    const videoId = typeof b.id === 'string' ? b.id : undefined;

    let novosVideos = [...atual.videos];

    if (videoId) {
      novosVideos = novosVideos.map((v) => {
        if (v.id !== videoId && v.url !== videoId) return v;

        const inicioSeg = b.inicioSeg !== undefined ? Number(b.inicioSeg) : v.inicioSeg;
        const fimSeg = b.fimSeg !== undefined ? Number(b.fimSeg) : v.fimSeg;
        validarTrecho(inicioSeg, fimSeg);

        return {
          ...v,
          inicioSeg,
          fimSeg,
          ativo: b.ativo !== undefined ? Boolean(b.ativo) : v.ativo,
          titulo: typeof b.titulo === 'string' ? b.titulo : v.titulo,
        };
      });
    } else if (b.inicioSeg !== undefined && b.fimSeg !== undefined && novosVideos.length > 0) {
      // Ajusta o primeiro vídeo se nenhum ID for passado
      const inicioSeg = Number(b.inicioSeg);
      const fimSeg = Number(b.fimSeg);
      validarTrecho(inicioSeg, fimSeg);
      novosVideos[0] = {
        ...novosVideos[0],
        inicioSeg,
        fimSeg,
        ativo: b.ativo !== undefined ? Boolean(b.ativo) : novosVideos[0].ativo,
      };
    }

    const novaConfig: IntroVideoConfig = {
      modo: novoModo,
      videos: novosVideos,
    };

    await setIntroVideoConfig(novaConfig, admin.id);
    revalidatePath('/api/intro-video');
    return { ok: true, config: novaConfig };
  });
}

/**
 * Remove um vídeo específico da playlist por ID, ou limpa tudo se nenhum ID for fornecido.
 */
export async function DELETE(request: Request) {
  return handle(async () => {
    const admin = await requireAdmin();

    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('id');

    if (!videoId) {
      // Limpa todos os vídeos
      const atual = await getIntroVideoConfig();
      await clearIntroVideo();
      for (const v of atual.videos) {
        await removerArquivoAntigo(v.url);
      }
      revalidatePath('/api/intro-video');
      return { ok: true };
    }

    const atual = await getIntroVideoConfig();
    const itemRemover = atual.videos.find((v) => v.id === videoId || v.url === videoId);
    const videosRestantes = atual.videos.filter((v) => v.id !== videoId && v.url !== videoId);

    const novaConfig: IntroVideoConfig = {
      modo: atual.modo,
      videos: videosRestantes,
    };

    await setIntroVideoConfig(novaConfig, admin.id);

    if (itemRemover?.url) {
      await removerArquivoAntigo(itemRemover.url);
    }

    revalidatePath('/api/intro-video');
    return { ok: true, config: novaConfig };
  });
}

function numeroDoForm(form: FormData, campo: string, fallback: number): number {
  const v = form.get(campo);
  if (typeof v !== 'string' || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function validarTrecho(inicioSeg: number, fimSeg: number): void {
  const erro = erroDoTrecho(inicioSeg, fimSeg);
  if (erro) throw new HttpError(400, erro);
}

function extensaoDe(mime: string): string {
  if (mime === 'video/webm') return 'webm';
  if (mime === 'video/quicktime') return 'mov';
  return 'mp4';
}

async function removerArquivoAntigo(url: string | undefined): Promise<void> {
  if (!url || !url.includes('blob.vercel-storage.com')) return;
  try {
    await del(url);
  } catch (err) {
    console.error('[intro-video] falha ao remover arquivo do storage:', err);
  }
}

export const runtime = 'nodejs';

