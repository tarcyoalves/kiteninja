# Redefinição de senha: por que "não prestou", com prova

Relato do dono, um mês depois da primeira correção: *"a parte de redefinir senha
do usuário não prestou"*. Sem log — a retenção do plano Hobby da Vercel já tinha
apagado a tentativa. Em vez de deduzir, o fluxo foi **reproduzido**: as rotas
reais (`admin gera link → velejador redefine → velejador entra`) rodando contra
um Postgres em memória (PGlite) com o `lib/schema.sql` de produção.
O teste é `lib/redefinirSenhaFluxo.test.ts` e ficou no repositório.

O caminho feliz funcionava. O caminho **real** quebrava em cinco pontos.

## Saída das rotas reais, antes da correção

```
A  senha de 8 caracteres          >> 400 "A senha precisa ter no mínimo 10 caracteres."
B  errou 5x, redefiniu, entra     >> 429 "Muitas tentativas de login incorretas"
C  6 logins CORRETOS seguidos     >> 200,200,200,200,200,429
D  "Esqueci minha senha" e depois
   o link que o admin mandou      >> 400 "Link de recuperação inválido, expirado ou já utilizado."
```

## Os cinco defeitos

**D — o mais grave: o "Esqueci minha senha" matava o link do admin.**
A tela pedia o e-mail e respondia *"Instruções enviadas! Você receberá o link"*.
Não existe envio de e-mail no projeto. E criar o token do autoatendimento
**invalidava todos os links anteriores da conta** — inclusive o que o admin
tinha acabado de mandar pelo WhatsApp. A pessoa esperava um e-mail que nunca
vinha, abria o link certo e lia "link inválido".

Correção: criar um link não invalida mais os outros; **usar** um invalida todos
(a garantia de segurança só mudou de lugar). E a tela parou de prometer e-mail:
agora diz que a recuperação é feita pelo administrador, que manda o link.

**B — redefinir a senha não destravava o login.** O limitador de login guardava
as tentativas erradas de antes do pedido de ajuda. A pessoa redefinia com
sucesso e a senha **nova** era recusada com 429. Correção: redefinir zera as
falhas da conta.

**C — o limitador contava login certo.** Registrava toda chamada antes de
conferir a senha. Cinco entradas corretas em 15 minutos (celular, tablet,
computador) bloqueavam a sexta com uma mensagem falsa de "tentativas
incorretas". Correção: só senha errada conta; entrar zera. Força bruta segue
barrada na sexta tentativa errada — há teste disso.

**A — a tela dizia 6, o servidor exigia 10.** Quem seguia a instrução da página
recebia erro. Correção: `lib/senhaRegras.ts` é a regra única, lida pelo
servidor e pelas três telas que definem senha (link, convite, troca forçada).

**UI do admin — o link nascia fora da tela, e os botões eram indistinguíveis no
celular.** O painel com o link aparecia no topo da página; quem tocava numa
linha mais abaixo não via nada acontecer. E os dois botões (cadeado e chave)
eram só ícones com `title`, que não aparece em tela de toque — e o da chave não
serve para quem esqueceu a senha. Correção: rótulos visíveis ("Nova senha" /
"Exigir troca"), link e erro dentro da própria linha, e botão **Enviar** que
abre o compartilhamento do celular com o texto pronto para o WhatsApp.

## Contraprovas

Cada correção desfeita fez o teste certo ficar vermelho: login contando toda
tentativa (C), reset sem limpar falhas (B), gerar link matando os anteriores
(D), usar link sem matar os outros (D, segunda asserção).

Uma contraprova saiu **verde** na primeira tentativa — a âncora usada
(`const token = newToken();`) existe três vezes em `lib/auth.ts` e o patch caiu
em `createSession`, não no token de senha. Refeita na função certa, ficou
vermelha. Registro porque é o tipo de engano que faz uma contraprova "provar"
o que não provou.

## O que continua faltando

Envio de e-mail de verdade (Resend ou similar). Até lá, o único caminho que
entrega um link é o painel admin — e a tela de "Esqueci minha senha" diz isso.
Está no plano de agentes.
