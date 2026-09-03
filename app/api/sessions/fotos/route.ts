import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { handle, readJson } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import {
  MAX_BYTES_POR_FOTO,
  PREFIXO_BLOB_VELEJO,
  TIPOS_DE_FOTO_ACEITOS,
} from '@/lib/fotosDoVelejo';

export const dynamic = 'force-dynamic';

/**
 * Emite o token que deixa o navegador subir a foto do velejo direto para o
 * Vercel Blob.
 *
 * POR QUE O ARQUIVO NÃO PASSA POR AQUI
 *
 * O corpo de uma requisição serverless é limitado, e mandar a foto para o
 * servidor só para ele reenviar ao storage gasta banda duas vezes — a segunda
 * no 4G do velejador. O protocolo do `@vercel/blob/client` resolve isso: esta
 * rota autoriza, e o upload sai do celular direto para o Blob.
 *
 * Mesmo desenho de `app/api/admin/intro-video`, que já usa este fluxo para os
 * vídeos de abertura. A diferença é quem pode: lá é admin, aqui é qualquer
 * velejador com sessão — a foto é do velejo dele.
 *
 * A CHECAGEM DENTRO DE `onBeforeGenerateToken` NÃO É REDUNDANTE. É ela que
 * de fato autoriza a emissão; sem ela, quem descobrir esta URL consegue um
 * token válido e passa a subir arquivo no storage do projeto. O `requireUser`
 * no topo protege este handler, mas é este callback que o Blob consulta.
 *
 * O prefixo obrigatório existe pelo mesmo motivo: sem ele, um token emitido
 * aqui serviria para sobrescrever `intro/…`, que é conteúdo de admin.
 */
export async function POST(request: Request) {
  return handle(async () => {
    await requireUser();

    const body = await readJson(request);

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new HttpError(
        503,
        'Armazenamento de fotos não configurado. Falta BLOB_READ_WRITE_TOKEN no ambiente.'
      );
    }

    return handleUpload({
      body: body as HandleUploadBody,
      request,
      onBeforeGenerateToken: async (pathname) => {
        await requireUser();

        if (!pathname.startsWith(PREFIXO_BLOB_VELEJO)) {
          throw new HttpError(400, 'Caminho de upload inválido.');
        }

        return {
          allowedContentTypes: [...TIPOS_DE_FOTO_ACEITOS],
          maximumSizeInBytes: MAX_BYTES_POR_FOTO,
          addRandomSuffix: true,
        };
      },
      // Sem onUploadCompleted de propósito: a Vercel só chama esse callback
      // quando há URL pública de retorno, então ele não funciona em
      // desenvolvimento. Quem registra a foto é o próprio cliente, mandando as
      // URLs junto do velejo em POST /api/sessions — igual em dev e produção.
    });
  });
}
