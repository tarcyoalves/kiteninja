/**
 * Envio de e-mail (T08) — hoje só o link de "esqueci minha senha".
 *
 * Usa a API HTTP do Resend direto, sem SDK: é um POST, e uma dependência a
 * mais no bundle para isso não se paga. O plano gratuito do Resend dá 100
 * e-mails por dia / 3.000 por mês, e o pedido de recuperação já é limitado a
 * 3 por hora por e-mail em `rateLimiters.passwordReset` — não há como este
 * app estourar a cota em uso normal.
 *
 * DUAS VARIÁVEIS, E AS DUAS SÃO OBRIGATÓRIAS:
 *   RESEND_API_KEY  — a chave da conta.
 *   EMAIL_FROM      — remetente num domínio VERIFICADO no Resend, por exemplo
 *                     `KiteNinja <nao-responda@seudominio.com>`.
 *
 * Sem qualquer uma delas, `emailConfigurado()` é falso: nada é enviado, nada
 * quebra, e a tela "Esqueci minha senha" continua dizendo a verdade (peça ao
 * administrador). É de propósito que não exista remetente padrão: o endereço
 * de teste do Resend só entrega para o dono da conta, e uma tela que promete
 * "enviamos o link" sem entregar foi exatamente o defeito descrito em
 * docs/REDEFINIR-SENHA-NAO-PRESTOU.md.
 */

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 8000;

export function emailConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

export interface Email {
  para: string;
  assunto: string;
  texto: string;
  html: string;
}

/**
 * Devolve `true` só quando o Resend aceitou o envio. Nunca lança: quem chama
 * está no caminho de uma resposta que precisa ser uniforme exista ou não a
 * conta, e uma exceção aqui viraria um 500 que denuncia a diferença.
 */
export async function enviarEmail(email: Email): Promise<boolean> {
  if (!emailConfigurado()) return false;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM!.trim(),
        to: [email.para],
        subject: email.assunto,
        text: email.texto,
        html: email.html,
      }),
    });
    if (!res.ok) {
      // Só o status: o corpo da resposta pode ecoar o destinatário.
      console.error('[email] Resend recusou o envio:', res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] falha ao enviar:', err instanceof Error ? err.name : 'erro');
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** O e-mail do link de nova senha. Texto puro e HTML dizem a mesma coisa. */
export function emailDeRecuperacao(para: string, url: string, validoPorHoras: number): Email {
  const texto = [
    'Você pediu para escolher uma senha nova no KiteNinja.',
    '',
    `Abra este link (vale por ${validoPorHoras} horas e serve uma única vez):`,
    url,
    '',
    'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px;background:#0F172A;font-family:Arial,Helvetica,sans-serif;color:#E2E8F0">
<div style="max-width:440px;margin:0 auto;background:#1E293B;border-radius:16px;padding:24px">
<p style="margin:0 0 4px;font-size:12px;font-weight:bold;color:#22D3EE">KiteNinja</p>
<h1 style="margin:0 0 12px;font-size:20px;color:#FFFFFF">Escolher uma senha nova</h1>
<p style="margin:0 0 20px;font-size:14px;line-height:1.5">Você pediu para redefinir sua senha. O link vale por ${validoPorHoras} horas e serve uma única vez.</p>
<p style="margin:0 0 20px"><a href="${url}" style="display:inline-block;background:#06B6D4;color:#020617;font-weight:bold;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:12px">Escolher senha nova</a></p>
<p style="margin:0 0 8px;font-size:12px;color:#94A3B8">Se o botão não abrir, copie este endereço:</p>
<p style="margin:0 0 20px;font-size:12px;word-break:break-all;color:#94A3B8">${url}</p>
<p style="margin:0;font-size:12px;color:#94A3B8">Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>
</div></body></html>`;

  return { para, assunto: 'KiteNinja — escolher uma senha nova', texto, html };
}
