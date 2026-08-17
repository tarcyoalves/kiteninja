import { NextResponse } from 'next/server';
import { HttpError } from './auth';

/**
 * Envelope padrão das rotas. Erros conhecidos (HttpError) viram resposta com a
 * mensagem; qualquer outro é logado no servidor e devolvido como 500 genérico —
 * nunca vazamos stack trace ou detalhe de query para o cliente.
 */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data ?? { ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[api] erro não tratado:', err);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
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
