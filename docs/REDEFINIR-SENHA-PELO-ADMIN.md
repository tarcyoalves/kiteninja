# Redefinir a senha de um velejador pelo painel admin

**Relato:** *"O usuário alysson esqueceu a senha. Eu cliquei para redefinir no
painel admin, mas ele tentou e só dá erro de credencial."*

O relato estava certo, e o botão estava errado.

## O que o botão fazia

O único botão de chave no painel mandava isto:

```ts
updateUser(u.id, { mustChangePassword: true }, ...)
```

E o `PATCH /api/admin/users/[id]` faz só isto com esse campo:

```sql
must_change_password = COALESCE(${mustChangePassword}, must_change_password)
```

**A senha nunca era tocada.** `must_change_password` é a flag que *exige a
troca no próximo login* — ela serve para forçar alguém que ainda consegue
entrar a escolher uma senha nova. Para quem esqueceu a senha ela não vale
nada: a pessoa não chega ao próximo login. Ela continua batendo em
"credencial inválida", exatamente como o velejador relatou.

O nome do botão ("redefinir") prometia uma coisa; o código fazia outra. O
admin clicava, via o feedback verde de sucesso, e ia embora achando que tinha
resolvido.

## Por que o autoatendimento também não salvava

`POST /api/auth/recover-password` cria um token de recuperação válido — mas
**não existe envio de e-mail em lugar nenhum deste projeto**. O token é
gerado, guardado como hash, e só é devolvido na resposta quando
`NODE_ENV !== 'production'`. Em produção ele nasce e morre sem chegar a
ninguém. Ou seja: nem o caminho do admin nem o do próprio usuário devolviam
o acesso.

## O que passou a existir

`POST /api/admin/users/[id]/senha` — só admin. Ela:

1. confere que a conta existe e **não está suspensa** (se estiver, devolve 409
   dizendo isso, em vez de um erro genérico que faria o admin tentar de novo);
2. chama `createPasswordResetToken` — a **mesma** máquina do fluxo de
   autoatendimento, então não há um segundo mecanismo para divergir depois:
   token guardado como hash, tokens anteriores invalidados, validade de 2h,
   uso único;
3. derruba as sessões abertas do velejador (`invalidateAllUserSessions`) — se
   a pessoa perdeu o acesso, uma sessão ainda viva em outro aparelho é
   justamente o que não deveria seguir de pé;
4. devolve o **link pronto** (`/recuperar-senha/<token>`), absoluto, para o
   admin colar no WhatsApp.

No painel: um botão ciano de cadeado, separado do botão de chave. Ao clicar,
aparece um painel com o link e um botão *Copiar*. O botão de chave continua
existindo — ele tem uso legítimo — mas o `title` agora diz em voz alta
"**não serve para quem esqueceu a senha**".

## Por que link e não senha temporária

Uma senha temporária precisa ser dita à pessoa por WhatsApp, e aí ela mora
para sempre naquela conversa — e como quase ninguém troca depois, ela vira a
senha real da conta, em texto puro, num histórico de mensagens.

O link expira em 2 horas, serve uma única vez, e quem escolhe a senha é o dono
da conta. A senha nunca existe em texto puro em lugar nenhum. Se o link
expirar antes do uso, o admin gera outro — custa um clique.

Quando a senha é redefinida, `reset-password` já limpa
`must_change_password = FALSE`, então o fluxo fecha sozinho mesmo se alguém
tiver apertado o botão da chave antes.

## O teste que segura isso

`lib/redefinirSenhaAdmin.test.ts` lê os dois arquivos e verifica que a rota
existe, exige admin, gera token, devolve link, derruba sessões e recusa conta
suspensa — e que o painel **liga o botão à rota**.

Esse último ponto quase passou batido. A primeira versão do teste checava só
`expect(src).toMatch(/gerarLinkSenha/)`. Na contraprova eu desliguei o botão
(troquei o `onClick` de volta pelo `mustChangePassword`) **e o teste continuou
verde** — porque a *declaração* da função ainda estava no arquivo e casava com
o nome. Um teste que passa com o bug de volta não é um teste. A asserção
agora exige a ligação: `onClick={() => gerarLinkSenha(`.

Contraprovas rodadas, todas vermelhas como deviam: botão desligado, rota sem
`invalidateAllUserSessions`, rota inexistente.

## O que o dono precisa fazer

Nada no banco — a tabela `password_reset_tokens` já existia e é a mesma. Para
o alysson: abrir o painel, clicar no cadeado ciano na linha dele, copiar o
link e mandar. Ele escolhe a senha nova e entra.
