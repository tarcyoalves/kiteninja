import { NextResponse } from 'next/server';
import { HttpError } from './auth';
import { headers } from 'next/headers';
import { registrarErro } from './observabilidade';

/**
 * Toda resposta de API sai como `no-store`.
 *
 * Antes daqui nenhuma rota mandava `Cache-Control` nenhum, e resposta sem
 * diretiva de cache fica à mercê do cache heurístico do navegador — que na
 * WebView do Android é notoriamente mais agressivo que no Chrome de desktop.
 * Isso é veneno para este app: são dados autenticados, por usuário, que mudam
 * o tempo todo (eventos, downwinds, feed, posições). Servir uma versão velha
 * é pior do que falhar, porque parece que funcionou.
 *
 * Sintoma real que motivou a mudança: o dono apagou dois downwinds e criou
 * um novo, e o outro usuário continuou vendo só os dois antigos — cada um
 * numa "versão" diferente do app. Ver docs/BUG-SINCRONIZACAO-DADOS.md.
 *
 * Fica no envelope e não rota a rota porque "esqueceram de pôr no-store" é
 * exatamente o tipo de erro que não aparece em teste nenhum e só se manifesta
 * no aparelho de outra pessoa. O manifest é o único que quer cache de
 * verdade, e ele não passa por aqui (monta a `Response` na mão).
 */
const SEM_CACHE = { 'Cache-Control': 'no-store, must-revalidate' } as const;

/**
 * Envelope padrão das rotas. Erros conhecidos (HttpError) viram resposta com a
 * mensagem; qualquer outro é logado no servidor e devolvido como 500 genérico —
 * nunca vazamos stack trace ou detalhe de query para o cliente.
 */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data ?? { ok: true }, { headers: SEM_CACHE });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status, headers: SEM_CACHE });
    }
    console.error('[api] erro não tratado:', err);
    // Persiste para o painel de erros. Sem await: a resposta do velejador
    // não espera o log, e `registrarErro` engole a própria falha.
    void capturarErroDeApi(err);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500, headers: SEM_CACHE });
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Corpo da requisição deve ser JSON válido.');
  }
}

/**
 * Igual ao readJson, mas corpo ausente vale como objeto vazio.
 *
 * Serve para POST em que todo campo é opcional — o heartbeat de presença é o
 * caso: "estou com o app aberto" é a mensagem inteira, e exigir `{}` só para
 * satisfazer o parser gastaria bytes no 4G da praia. Corpo presente e
 * malformado continua sendo erro: aí é bug de cliente, não economia.
 */
export async function readOptionalJson(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Corpo da requisição deve ser JSON válido.');
  }
}

/**
 * Descobre a rota do jeito possível e registra o erro.
 *
 * `handle()` não recebe a `Request`, e mudar a assinatura custaria tocar nas
 * 77 rotas do app para ganhar um campo. Então a rota sai do cabeçalho
 * `x-matched-path`, que a Vercel injeta, com o `referer` como segunda opção.
 * Quando nenhum dos dois vem, o erro entra como rota desconhecida — a
 * mensagem, que é o sinal principal, continua lá de qualquer jeito.
 */
async function capturarErroDeApi(err: unknown): Promise<void> {
  let rota: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    rota = h.get('x-matched-path') ?? h.get('referer');
    userAgent = h.get('user-agent');
  } catch {
    // Fora de contexto de requisição: segue sem rota.
  }
  await registrarErro({ origem: 'servidor', erro: err, rota, userAgent });
}
