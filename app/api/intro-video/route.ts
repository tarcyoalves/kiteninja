import { handle } from '@/lib/api';
import { getIntroVideoConfig, getIntroVideo } from '@/lib/settings';

/**
 * Abertura configurada, para a tela de splash.
 * Retorna a playlist completa e o vídeo principal para rotação do lado do cliente.
 */
export async function GET() {
  return handle(async () => {
    const config = await getIntroVideoConfig();
    const video = await getIntroVideo();
    return { config, video };
  });
}

// A abertura muda raramente e é pedida por todo visitante novo.
export const revalidate = 60;

