import { del } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
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
 * Adiciona um novo vídeo à playlist (via upload direto para o Blob ou URL direta).
 *
 * ATENÇÃO — por que esta rota NUNCA deve voltar a ler `request.formData()`:
 * a Vercel limita o corpo de uma requisição de função serverless a 4,5MB. Um
 * vídeo de poucos segundos já passa disso, então um `await request.formData()`
 * aqui seria rejeitado pela PLATAFORMA antes da função sequer rodar — sem
 * lançar erro no código, sem log nenhum (foi exatamente esse o bug original:
 * nada aparecia em `get_runtime_errors`/`get_runtime_logs` porque a
 * requisição nunca chegava a executar este arquivo).
 *
 * Por isso o navegador sobe o arquivo DIRETO para o Vercel Blob, sem passar
 * por esta função, usando `upload()` de `@vercel/blob/client`
 * (app/admin/IntroVideoManager.tsx). Esta rota só faz duas coisas, as únicas
 * que cabem dentro do limite de corpo de requisição:
 *   Caso 1 — emite o token de autorização do upload (`handleUpload`);
 *   Caso 2 — registra a URL final (já no Blob, ou uma URL externa colada
 *            pelo admin) na playlist.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const admin = await requireAdmin();

    const body = await readJson(request);
    const b = (body ?? {}) as Record<string, unknown>;

    // Caso 1: protocolo do @vercel/blob client — o navegador está pedindo um
    // token para subir o arquivo direto para o Blob (upload() -> handleUploadUrl).
    if (b.type === 'blob.generate-client-token') {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        throw new HttpError(
          503,
          'Armazenamento de vídeo não configurado. Falta BLOB_READ_WRITE_TOKEN no ambiente.'
        );
      }

      return handleUpload({
        body: body as HandleUploadBody,
        request,
        onBeforeGenerateToken: async (pathname) => {
          // O ponto mais importante desta rota: sem checar admin AQUI dentro,
          // qualquer pessoa que descubra esta URL consegue um token válido e
          // sobe arquivo no storage do projeto — é este callback que de fato
          // autoriza a emissão do token, então a checagem no topo do POST
          // (que também protege, mas é deste mesmo handler) não é o bastante
          // por si só: repetir aqui é o padrão documentado do @vercel/blob e
          // sobrevive mesmo se este trecho um dia for extraído para outra rota.
          await requireAdmin();

          if (!pathname.startsWith('intro/')) {
            throw new HttpError(400, 'Caminho de upload inválido.');
          }

          return {
            allowedContentTypes: [...TIPOS_ACEITOS],
            maximumSizeInBytes: MAX_BYTES_VIDEO,
            addRandomSuffix: true,
          };
        },
        // Sem onUploadCompleted/callbackUrl de propósito: esse callback só é
        // chamado pela Vercel quando existe URL pública de callback — NÃO
        // funciona em localhost (a Vercel precisa conseguir chamar de volta).
        // Quem registra o vídeo na playlist é o próprio cliente, chamando
        // este mesmo POST com {url,...} assim que upload() resolve (Caso 2
        // abaixo) — funciona igual em dev e em produção.
      });
    }

    // Caso 2: cadastro do vídeo na playlist por URL — tanto um vídeo externo
    // colado pelo admin quanto o vídeo que acabou de subir direto para o
    // Blob (o cliente chama este POST de novo com a URL que upload() devolveu).
    const url = String(b.url || '').trim();
    if (!url.startsWith('https://')) {
      throw new HttpError(400, 'A URL do vídeo deve começar com https://');
    }

    const inicioSeg = Number(b.inicioSeg) || 0;
    const fimSeg = Number(b.fimSeg) || 6;
    validarTrecho(inicioSeg, fimSeg);

    const posterDataUrl =
      typeof b.posterDataUrl === 'string' &&
      b.posterDataUrl.startsWith('data:image/') &&
      b.posterDataUrl.length < 500_000
        ? b.posterDataUrl
        : undefined;

    const duracaoSeg = Number(b.duracaoSeg);

    const novoItem: IntroVideo = {
      id: `vid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url,
      inicioSeg,
      fimSeg,
      ativo: b.ativo !== false,
      nomeArquivo: typeof b.nomeArquivo === 'string' ? b.nomeArquivo : undefined,
      titulo: typeof b.titulo === 'string' && b.titulo.trim() ? b.titulo.trim() : 'Vídeo Externo',
      duracaoSeg: Number.isFinite(duracaoSeg) && duracaoSeg > 0 ? duracaoSeg : undefined,
      posterDataUrl,
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

function validarTrecho(inicioSeg: number, fimSeg: number): void {
  const erro = erroDoTrecho(inicioSeg, fimSeg);
  if (erro) throw new HttpError(400, erro);
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

