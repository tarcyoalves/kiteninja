# Ativar o e-mail de "esqueci minha senha" (T08)

O código já está no ar e **desligado**. Enquanto as duas variáveis abaixo não
existirem na Vercel, nada muda: a tela continua mandando pedir o link ao
administrador, e o painel admin continua gerando o link como sempre.

Ligar é só configuração. Não precisa de deploy de código.

## O que você precisa ter

Um **domínio seu** (por exemplo `kiteninja.com.br`). O Resend não envia para
outras pessoas a partir de `vercel.app` nem do endereço de teste dele — só de
um domínio que você provou ser seu. Sem domínio próprio, este recurso não
liga; o caminho pelo administrador continua sendo o que funciona.

## Passo a passo

1. Abra <https://resend.com> e crie a conta (plano gratuito: 100 e-mails por
   dia, 3.000 por mês — o app limita o pedido a 3 por hora por e-mail).
2. No menu **Domains**, clique em **Add Domain** e digite o seu domínio.
3. O Resend mostra alguns registros DNS (TXT e MX). Copie cada um para o
   painel onde o domínio foi registrado. Volte ao Resend e clique em
   **Verify**. Pode levar de minutos a algumas horas.
4. No menu **API Keys**, clique em **Create API Key**, permissão
   **Sending access**. Copie a chave (começa com `re_`). Ela aparece uma vez só.
5. Abra a Vercel → projeto **kiteninja** → **Settings** → **Environment
   Variables** e crie, em **Production**:

   | Nome | Valor |
   |---|---|
   | `RESEND_API_KEY` | a chave copiada no passo 4 |
   | `EMAIL_FROM` | `KiteNinja <nao-responda@SEUDOMINIO>` |
   | `APP_URL` | `https://kiteninja.vercel.app` (se ainda não existir) |

6. Vercel → **Deployments** → no último deploy, menu **⋯** → **Redeploy**.
   Variável nova só vale depois de um deploy.

## Como conferir

1. Abra <https://kiteninja.vercel.app/recuperar-senha>. Agora deve aparecer um
   campo de e-mail e o botão **Enviar link por e-mail**.
2. Digite o e-mail da sua conta e envie.
3. O e-mail chega em até alguns minutos (olhe o spam na primeira vez). Abra o
   link, escolha a senha nova e entre.

Se o campo não aparecer, uma das duas variáveis está faltando ou o redeploy
não foi feito. Se o campo aparece mas o e-mail não chega, olhe **Logs** no
Resend: domínio não verificado é a causa mais comum.

## O que o código garante

- A resposta é a mesma para e-mail com e sem conta (não revela quem tem conta).
- O link vale 2 horas e serve uma vez.
- Pedir o link por e-mail **não** invalida um link que o administrador já
  tenha mandado.
- Se o Resend estiver fora do ar, a tela não quebra; a pessoa ainda pode pedir
  o link ao administrador.

Testado em `lib/recuperarSenhaPorEmail.test.ts`, pelas rotas reais, com o
Resend simulado. **Não testado:** envio de verdade — depende da sua conta.
