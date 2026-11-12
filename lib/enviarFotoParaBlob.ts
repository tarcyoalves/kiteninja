import { upload } from '@vercel/blob/client';
import { MENSAGEM_BLOB_NAO_CONFIGURADO, PREFIXO_BLOB, type TipoDeFoto } from './fotosNoBlob';

/**
 * Sobe uma foto JÁ COMPRIMIDA (data URL de `compressImage`) direto para o
 * Vercel Blob e devolve a URL https — é ela, e não o base64, que vai para o
 * banco. Ver lib/fotosNoBlob.ts para o porquê.
 *
 * Quando falha, tenta descobrir a causa: o cliente do Blob só diz "falha ao
 * obter o token", o que não ajuda quem está em dev/preview sem
 * BLOB_READ_WRITE_TOKEN. Nunca cai em silêncio para base64 — isso encheria o
 * banco sem ninguém perceber.
 */
export async function enviarFotoParaBlob(dataUrl: string, tipo: TipoDeFoto): Promise<string> {
  try {
    // fetch + blob() converte data URL em binário sem decodificador à mão
    // (mesmo truque do logbook).
    const binario = await (await fetch(dataUrl)).blob();
    const nome = `${PREFIXO_BLOB[tipo]}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const enviado = await upload(nome, binario, {
      access: 'public',
      handleUploadUrl: '/api/fotos/token',
      contentType: 'image/jpeg',
    });
    return enviado.url;
  } catch {
    let configurado = true;
    try {
      const r = await fetch('/api/fotos/token');
      if (r.ok) configurado = Boolean((await r.json()).configurado);
    } catch {
      // Sem rede: a mensagem genérica abaixo é a verdadeira.
    }
    throw new Error(
      configurado ? 'Não foi possível enviar a foto. Tente de novo.' : MENSAGEM_BLOB_NAO_CONFIGURADO
    );
  }
}
