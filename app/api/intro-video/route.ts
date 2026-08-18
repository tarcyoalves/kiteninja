import { handle } from '@/lib/api';
import { getIntroVideo } from '@/lib/settings';

/**
 * Abertura configurada, para a tela de splash.
 *
 * Rota pública de propósito: a abertura toca antes do login, então exigir
 * sessão aqui a tornaria invisível justamente para quem ela existe. Só expõe o
 * que já é público — a URL de um arquivo em storage público — e nada do usuário.
 */
export async function GET() {
  return handle(async () => {
    const video = await getIntroVideo();
    return { video };
  });
}

// A abertura muda raramente e é pedida por todo visitante novo. 5 min de cache
// na borda evita uma consulta ao Neon por visita, e o admin vê a troca rápido.
export const revalidate = 300;
