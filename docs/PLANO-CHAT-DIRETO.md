# Plano — Chat direto (DM) e conserto do "Salve"

Status: **plano, nada implementado.** Escrito em 20/08/2026 a partir de um bug
relatado pelo dono: mandar um "salve" para um velejador específico, visto
online, na verdade postava no chat GERAL — visível para todos, não só para o
destinatário.

## O bug de origem, e por que não é "só" um bug

`views/ChatView.tsx:848` — o botão de "mandar um salve" para alguém da lista de
online chama `handleSend(`🤙 Salve ${userName}! Bons ventos!`)`, que é a MESMA
função que posta uma mensagem na sala atual (`geral`). Não existe destinatário
no dado — é uma mensagem pública que só *menciona* o nome de alguém.

Corrigir isso corretamente não é trocar uma função por outra: é o app não ter
**nenhum canal privado**. Todo o chat hoje é `chat_messages` com uma coluna
`room` (texto livre, tipicamente `'geral'`), sem conceito de "conversa entre
duas pessoas". Um "salve" de verdade exige que essa estrutura exista.

## Decisão de design: reaproveitar `chat_messages`, não criar tabela nova

A tentação é criar `direct_messages` do zero. Não vale a pena: `chat_messages`
já resolve validação de sala (`lib/chat.ts`), rate limit, sanitização de texto,
presença/heartbeat, e o padrão de polling inteiro em `views/ChatView.tsx`
(4s ativo, pausa em `document.hidden`). Recriar tudo isso para DM seria
duplicar código que já funciona.

**A saída:** uma conversa direta é só mais um `room`, com um formato
determinístico: `dm:<idA>:<idB>`, com os dois IDs sempre em ordem alfabética
(para `dm:A:B` e `dm:B:A` nunca virarem salas diferentes). O `room_id` sozinho
já autoriza quem pode ler/escrever: só os dois UUIDs presentes nele.

```
função salaDireta(userIdA, userIdB):
  [a, b] = ordenar([userIdA, userIdB])
  retorna `dm:${a}:${b}`
```

Isso é reaproveitável, testável isoladamente (função pura), e não exige
schema novo — `chat_messages.room` já é `TEXT`.

## O que muda em cada camada

### `lib/chat.ts`
- `isValidRoomName` precisa aceitar o formato `dm:<uuid>:<uuid>` além de
  `'geral'`/nomes de sala existentes. Adicionar validação de formato (dois
  UUIDs v4 válidos, separados por `:`, em ordem alfabética — rejeitar fora de
  ordem, é sinal de forjar sala de outra pessoa).
- Nova função pura `salaDireta(idA, idB): string`, testada exaustivamente:
  ordem trocada dá a mesma sala; IDs iguais (usuário mandando pra si mesmo)
  deveria ser rejeitado antes de chegar aqui, não silenciosamente aceito.

### `app/api/chat/messages/route.ts`
Autorização é o ponto crítico. Hoje (chat público) qualquer usuário autenticado
lê/escreve em `room=geral`. Para `room` no formato `dm:*`, a rota PRECISA
extrair os dois IDs do nome da sala e confirmar que `requireUser().id` é um
deles — senão qualquer pessoa lendo o nome da sala (visível no client) poderia
ler a conversa de outros dois. Escreva um teste que tenta ler `dm:X:Y` sendo
um terceiro usuário `Z` e espera 403/404.

### UI — `views/ChatView.tsx`
- O botão de "salve" para alguém da lista de online passa a abrir/mandar para
  `salaDireta(meuId, delId)`, não para `geral`.
- Precisa de uma lista de conversas diretas (quem já trocou mensagem comigo),
  não só a lista de "quem está online agora" — inbox básico. Ver se cabe
  reaproveitar a UI de lista de salas já existente, com `room` prefixado por
  `dm:` renderizando o nome da OUTRA pessoa em vez do texto literal da sala.
- Contagem de não lidos (`unreadChatCount` em `context/KiteDataContext.tsx`)
  precisa saber separar "não lidas do geral" de "não lidas de DM" — pelo menos
  a notificação (`Notification`) já deveria usar o nome de quem mandou, que já
  funciona hoje.

### Notificação push
Hoje mensagens de chat não disparam push do servidor (só notificação local do
navegador quando o app está aberto, em `context/KiteDataContext.tsx`). Uma DM
que chega com o app fechado merece push de verdade — reaproveitar
`lib/push.ts` (`sendPushToUser`), igual ao SOS já faz. Escopo mínimo: só DM
dispara push, chat geral continua sem (senão qualquer mensagem no geral vira
notificação para todo mundo online, ruído demais).

## O que NÃO fazer nesta primeira fase

- Sem grupos/DM em grupo. Só 1:1.
- Sem edição/apagar mensagem.
- Sem "digitando...", sem confirmação de leitura. O chat geral não tem, DM
  não precisa nascer com mais recurso que o geral.
- Sem migrar o `chat_messages.room` para uma FK/enum. Continua `TEXT` livre —
  o formato `dm:` é convenção de aplicação, validada em `lib/chat.ts`, não
  imposta pelo banco. Simplicidade compatível com o resto do schema (que já
  guarda enums como `CHECK`, não como coluna estruturada, sempre que possível).

## Fases

1. `lib/chat.ts`: `salaDireta` + validação de formato `dm:`, com testes
   exaustivos (ordem, IDs inválidos, usuário mandando pra si mesmo).
2. `app/api/chat/messages/route.ts`: autorização por participante da DM.
   **Escrever primeiro o teste de negação** (terceiro usuário não pode ler)
   antes de qualquer código — é o ponto que mais importa acertar.
3. `views/ChatView.tsx`: trocar o "salve" para abrir `salaDireta`, lista de
   conversas diretas, badge de não lidos separado.
4. `lib/push.ts` + rota de mensagem: disparar push em DM (SOS já é a
   referência de "push que não pode duplicar").

## Critérios de aceite

- `node node_modules/tsx/dist/cli.mjs scripts/verify-sql.ts` — se este plano
  não mexe em schema, o número de checks não muda; qualquer mudança de schema
  precisa justificar por que `chat_messages` não bastou.
- `node node_modules/vitest/vitest.mjs run` verde, com teste explícito de
  terceiro usuário sendo negado numa sala `dm:*` que não é dele.
- Mandar um "salve" (ou qualquer mensagem) para um velejador específico NUNCA
  aparece no chat geral — verificado por teste, não por inspeção visual.
