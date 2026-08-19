import { handle } from '@/lib/api';
import { getIntroVideoConfig, primeiroVideoAtivo } from '@/lib/settings';

/**
 * Abertura configurada, para a tela de splash.
 * Retorna a playlist completa e o vídeo principal para rotação do lado do cliente.
 * Uma única leitura do banco — o vídeo sai da config já carregada.
 */
export async function GET() {
  return handle(async () => {
    const config = await getIntroVideoConfig();
    return { config, video: primeiroVideoAtivo(config) };
  });
}

// A abertura muda raramente e é pedida por todo visitante novo.
export const revalidate = 60;

