import { handle, readJson } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { getSessionUser } from '@/lib/auth';
import { registrarErro } from '@/lib/observabilidade';
import { enforceRateLimit } from '@/lib/rateLimit';

/**
 * Recebe erros de JavaScript acontecidos no aparelho do velejador.
 *
 * POR QUE ESTA ROTA É PÚBLICA
 *
 * Exigir sessão aqui deixaria de fora justamente a classe de erro mais cara:
 * a tela de entrada quebrada. Quem não consegue logar é quem mais precisa que
 * alguém saiba que quebrou — e é o único que não tem sessão para provar quem é.
 *
 * O que impede abuso não é a autenticação, são três outras coisas:
 *
 *  - A deduplicação por impressão digital em `erros_registrados`: mil envios
 *    do mesmo erro viram UMA linha com contador, então inundar a rota não
 *    enche o banco.
 *  - O teto por IP abaixo, que corta o volume de escrita.
 *  - O truncamento em `registrarErro`, que limita o tamanho de cada campo.
 *
 * O teto usa o limitador EM MEMÓRIA de propósito: aqui o alvo é um cliente em
 * laço de erro, não força bruta, e o custo de uma ida ao banco só para decidir
 * se vale registrar um erro seria maior que o problema.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'desconhecido';

    enforceRateLimit(`erro_cliente:${ip}`, 30, 60 * 1000, 'Muitos erros enviados.');

    const corpo = (await readJson(request)) as Record<string, unknown> | null;
    const mensagem = corpo?.mensagem;
    if (typeof mensagem !== 'string' || mensagem.trim().length === 0) {
      throw new HttpError(400, 'Informe a mensagem do erro.');
    }

    // Sessão é opcional: sem ela o erro entra sem dono, que é melhor que não
    // entrar. `getSessionUser` devolve null em vez de lançar quando não há.
    const user = await getSessionUser().catch(() => null);

    // Reconstitui um Error para que `registrarErro` extraia mensagem e stack
    // pelo mesmo caminho dos erros de servidor — um formato só na tabela.
    const erro = new Error(mensagem);
    if (typeof corpo?.stack === 'string') erro.stack = corpo.stack;

    await registrarErro({
      origem: 'cliente',
      erro,
      rota: typeof corpo?.rota === 'string' ? corpo.rota : null,
      userId: user?.id ?? null,
      userAgent: request.headers.get('user-agent'),
    });

    return { ok: true };
  });
}
