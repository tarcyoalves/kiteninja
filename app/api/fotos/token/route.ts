import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { handle, readJson } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import {
  MAX_BYTES_BLOB,
  MENSAGEM_BLOB_NAO_CONFIGURADO,
  TIPOS_ACEITOS_NO_BLOB,
  tipoDoCaminho,
} from '@/lib/fotosNoBlob';

export const dynamic = 'force-dynamic';

/**
 * Token de upload direto ao Vercel Blob para foto de RELATO, AVATAR e ANÚNCIO.
 *
 * Mesmo desenho de `app/api/sessions/fotos` (leia o comentário de lá): esta rota
 * só autoriza, e o arquivo sai do celular direto para o storage — nada de
 * base64 dentro do Postgres. A diferença é que o prefixo do caminho decide o
 * tipo, e o tipo decide o tamanho máximo (avatar 2 MB, relato/anúncio 5 MB).
 *
 * Tipo de arquivo e tamanho são impostos pelo Blob no upload, com base no
 * token emitido aqui; o cliente pode mentir, o token não.
 */
export async function POST(request: Request) {
  return handle(async () => {
    await requireUser();

    const body = await readJson(request);

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new HttpError(503, MENSAGEM_BLOB_NAO_CONFIGURADO);
    }

    return handleUpload({
      body: body as HandleUploadBody,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // É este callback que de fato autoriza a emissão (ver sessions/fotos).
        await requireUser();

        const tipo = tipoDoCaminho(pathname);
        if (!tipo) throw new HttpError(400, 'Caminho de upload inválido.');

        return {
          allowedContentTypes: [...TIPOS_ACEITOS_NO_BLOB],
          maximumSizeInBytes: MAX_BYTES_BLOB[tipo],
          addRandomSuffix: true,
        };
      },
      // Sem onUploadCompleted, pelo mesmo motivo de sessions/fotos: não roda em
      // dev. Quem registra a URL é a rota que grava o relato/perfil/anúncio.
    });
  });
}

/**
 * O armazenamento está configurado neste ambiente?
 *
 * O cliente do Blob só sabe dizer "falha ao obter o token" quando o POST acima
 * devolve 503. Depois de uma falha, o cliente pergunta aqui para trocar a
 * mensagem genérica pela causa real (variável faltando em dev/preview).
 */
export async function GET() {
  return handle(async () => {
    await requireUser();
    return { configurado: Boolean(process.env.BLOB_READ_WRITE_TOKEN) };
  });
}
