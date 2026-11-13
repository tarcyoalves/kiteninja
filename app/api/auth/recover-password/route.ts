import { handle, readJson } from '@/lib/api';
import { createPasswordResetToken } from '@/lib/auth';
import { emailConfigurado, emailDeRecuperacao, enviarEmail, urlDoApp } from '@/lib/email';
import { rateLimiters } from '@/lib/rateLimit';
import { email as parseEmail } from '@/lib/validation';

/**
 * Solicitação de recuperação de senha.
 *
 * Gera um token de uso único (expiração de 2h) guardado como hash no banco e,
 * quando o envio de e-mail está configurado (ver lib/email.ts), manda o link
 * para o endereço da conta.
 *
 * A resposta é a mesma exista ou não a conta, tenha ou não saído o e-mail —
 * dizer "enviado" só para e-mail cadastrado deixaria qualquer um descobrir
 * quem tem conta no app.
 *
 * SEM ENVIO CONFIGURADO NÃO SE CRIA TOKEN. Um token que ninguém vai receber
 * só ocupa linha no banco; e a tela, nesse caso, nem chama esta rota — ela
 * manda pedir o link ao administrador (app/recuperar-senha/page.tsx). A
 * exceção é fora de produção, onde os testes automatizados leem o token da
 * resposta.
 */
const VALIDO_POR_HORAS = 2;

export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    const email = parseEmail(body);

    await rateLimiters.passwordReset(email);

    const emProducao = process.env.NODE_ENV === 'production';
    const enviar = emailConfigurado();

    let token: string | null = null;
    if (enviar || !emProducao) {
      token = await createPasswordResetToken(email);
    }

    if (token && enviar) {
      // A origem vem SÓ de `APP_URL` (ver `urlDoApp`), nunca da requisição:
      // `emailConfigurado()` já garantiu que ela existe.
      const url = new URL(`/recuperar-senha/${token}`, urlDoApp()!).toString();
      // `enviarEmail` não lança; se falhar, a resposta segue uniforme e a
      // pessoa ainda tem o caminho do administrador.
      await enviarEmail(emailDeRecuperacao(email, url, VALIDO_POR_HORAS));
    }

    return {
      ok: true,
      message: 'Se o e-mail estiver cadastrado, enviamos um link para escolher uma senha nova.',
      // Em ambiente de desenvolvimento/teste, expõe o token para validação automatizada
      ...(!emProducao && token ? { resetToken: token } : {}),
    };
  });
}
