import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Download do APK do Android — ou a página de instalação, quando não há APK.
 *
 * O QUE ACONTECIA
 *
 * Sem `ANDROID_APK_URL` configurada, esta rota caía num endereço fixo de
 * release do GitHub. Só que o repositório é PRIVADO e não existe release
 * nenhuma publicada — então quem tocava em "Baixar Aplicativo Android" era
 * jogado no 404 do GitHub, com o caminho do repositório à mostra. Relatado por
 * um usuário, com print.
 *
 * O erro de fundo não foi o endereço estar errado: foi REDIRECIONAR PARA UM
 * LUGAR QUE NINGUÉM CONFIRMOU QUE EXISTE. Um palpite embutido em código vira
 * promessa para o usuário, e quando ele falha a culpa parece do app.
 *
 * Agora: só redireciona para fora se alguém DE FATO configurou um APK. Sem
 * isso, leva para `/instalar-android`, que ensina a instalar o app pela tela
 * inicial — que hoje é o único jeito real de instalar, e funciona.
 */
export async function GET(request: Request) {
  const apk = process.env.NEXT_PUBLIC_ANDROID_APK_URL || process.env.ANDROID_APK_URL;

  /*
   * `http(s)` explicitamente: uma variável mal preenchida com `javascript:` ou
   * `data:` viraria um redirecionamento aberto a partir de um endpoint público.
   * Valor inválido é tratado como ausente, não como erro — a pessoa quer
   * instalar o app, não ler uma mensagem sobre configuração.
   */
  const destino = (() => {
    if (!apk) return null;
    try {
      const url = new URL(apk);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
    } catch {
      return null;
    }
  })();

  if (destino) {
    return NextResponse.redirect(destino, {
      status: 302,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  }

  return NextResponse.redirect(new URL('/instalar-android', request.url), {
    status: 302,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}
