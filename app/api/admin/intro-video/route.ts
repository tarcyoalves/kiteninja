import { put, del } from '@vercel/blob';
import { revalidatePath } from 'next/cache';
import { handle, readJson } from '@/lib/api';
import { HttpError, requireAdmin } from '@/lib/auth';
import { getIntroVideoRaw, setIntroVideo, clearIntroVideo } from '@/lib/settings';
import {
  erroDoTrecho,
  MAX_BYTES_VIDEO,
  MAX_TRECHO_SEG,
  MIN_TRECHO_SEG,
  TIPOS_VIDEO_ACEITOS,
  type IntroVideo,
} from '@/lib/introVideo';

/**
 * Vídeo de abertura do app: upload do arquivo e ajuste do trecho exibido.
 *
 * Só admin entra aqui — é escrita em storage público e troca a primeira tela
 * que todo mundo vê, então é a superfície mais sensível fora da autenticação.
 *
 * Não recortamos o arquivo no servidor: função serverless não tem ffmpeg, e
 * transcodificar 4MB dentro do limite de execução não caberia. Guardamos o
 * trecho como metadado e o player toca só aquele intervalo — assim o admin
 * também reajusta o corte depois sem subir o vídeo de novo.
 */

const TIPOS_ACEITOS = new Set<string>(TIPOS_VIDEO_ACEITOS);

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const atual = await getIntroVideoRaw();
    return {
      video: atual,
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
 * Recebe o arquivo como multipart. O corpo vem do próprio painel, mas ainda
 * validamos tipo e tamanho aqui: quem tem cookie de admin pode chamar a rota
 * direto, sem passar pela nossa tela.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const admin = await requireAdmin();

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
        `Vídeo de ${mb}MB excede o limite de ${MAX_BYTES_VIDEO / 1024 / 1024}MB. Corte antes de enviar.`
      );
    }
    if (!TIPOS_ACEITOS.has(arquivo.type)) {
      throw new HttpError(
        415,
        `Formato "${arquivo.type || 'desconhecido'}" não suportado. Use MP4, WebM ou MOV.`
      );
    }

    const inicioSeg = numeroDoForm(form, 'inicioSeg', 0);
    const fimSeg = numeroDoForm(form, 'fimSeg', 0);
    const duracaoSeg = numeroDoForm(form, 'duracaoSeg', 0);
    validarTrecho(inicioSeg, fimSeg);

    const poster = form.get('posterDataUrl');
    const posterDataUrl =
      typeof poster === 'string' && poster.startsWith('data:image/') && poster.length < 400_000
        ? poster
        : undefined;

    // Nome com sufixo aleatório: dois uploads do mesmo arquivo não podem
    // sobrescrever um ao outro enquanto o anterior ainda está sendo servido.
    const ext = extensaoDe(arquivo.type);
    const enviado = await put(`intro/abertura-${Date.now()}.${ext}`, arquivo, {
      access: 'public',
      contentType: arquivo.type,
      addRandomSuffix: true,
    });

    const anterior = await getIntroVideoRaw();

    const valor: IntroVideo = {
      url: enviado.url,
      inicioSeg,
      fimSeg,
      posterDataUrl,
      ativo: true,
      nomeArquivo: arquivo.name,
      duracaoSeg: duracaoSeg > 0 ? duracaoSeg : undefined,
    };
    await setIntroVideo(valor, admin.id);

    // O arquivo antigo só sai depois que o novo já está gravado: se a limpeza
    // falhar, sobra lixo no storage — barato. Na ordem inversa, uma falha
    // deixaria a abertura apontando para um arquivo já apagado.
    await removerArquivoAntigo(anterior?.url, enviado.url);

    // A rota pública é cacheada na borda; sem invalidar, o admin trocaria a
    // abertura e continuaria vendo a antiga por até 5 minutos.
    revalidatePath('/api/intro-video');
    return { ok: true, video: valor };
  });
}

/** Reajusta o trecho (ou liga/desliga) sem novo upload. */
export async function PATCH(request: Request) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = await readJson(request);
    const b = (body ?? {}) as Record<string, unknown>;

    const atual = await getIntroVideoRaw();
    if (!atual?.url) {
      throw new HttpError(404, 'Nenhum vídeo de abertura enviado ainda.');
    }

    const ativo = b.ativo === undefined ? atual.ativo : b.ativo === true;

    const inicioSeg = b.inicioSeg === undefined ? atual.inicioSeg ?? 0 : Number(b.inicioSeg);
    const fimSeg = b.fimSeg === undefined ? atual.fimSeg ?? 0 : Number(b.fimSeg);
    validarTrecho(inicioSeg, fimSeg);

    const valor: IntroVideo = {
      url: atual.url,
      inicioSeg,
      fimSeg,
      posterDataUrl: atual.posterDataUrl,
      ativo,
      nomeArquivo: atual.nomeArquivo,
      duracaoSeg: atual.duracaoSeg,
    };
    await setIntroVideo(valor, admin.id);

    // A rota pública é cacheada na borda; sem invalidar, o admin trocaria a
    // abertura e continuaria vendo a antiga por até 5 minutos.
    revalidatePath('/api/intro-video');
    return { ok: true, video: valor };
  });
}

/** Remove a abertura e volta o app para a animação vetorial. */
export async function DELETE() {
  return handle(async () => {
    await requireAdmin();

    const atual = await getIntroVideoRaw();
    await clearIntroVideo();
    await removerArquivoAntigo(atual?.url, undefined);

    // A rota pública é cacheada na borda; sem invalidar, o admin trocaria a
    // abertura e continuaria vendo a antiga por até 5 minutos.
    revalidatePath('/api/intro-video');
    return { ok: true };
  });
}

function numeroDoForm(form: FormData, campo: string, fallback: number): number {
  const v = form.get(campo);
  if (typeof v !== 'string' || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** A regra vive em lib/introVideo para o painel mostrar a mesma mensagem. */
function validarTrecho(inicioSeg: number, fimSeg: number): void {
  const erro = erroDoTrecho(inicioSeg, fimSeg);
  if (erro) throw new HttpError(400, erro);
}

function extensaoDe(mime: string): string {
  if (mime === 'video/webm') return 'webm';
  if (mime === 'video/quicktime') return 'mov';
  return 'mp4';
}

/**
 * Apaga o arquivo anterior no Blob. Nunca deixa a falha estourar: perder o
 * arquivo velho não é motivo para o admin achar que o upload deu errado.
 */
async function removerArquivoAntigo(
  urlAntiga: string | undefined,
  urlNova: string | undefined
): Promise<void> {
  if (!urlAntiga || urlAntiga === urlNova) return;
  try {
    await del(urlAntiga);
  } catch (err) {
    console.error('[intro-video] falha ao remover arquivo antigo:', err);
  }
}

export const runtime = 'nodejs';
