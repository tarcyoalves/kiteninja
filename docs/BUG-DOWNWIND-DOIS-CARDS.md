# Downwind invisível e duplicado — 02/09/2026

Dois relatos do dono, na mesma tela, com a **mesma causa raiz**:

1. "Criei um DW e não apareceu para outros usuários."
2. "Fica como se fosse dois cards, sem necessidade."

## A causa: dois caminhos de criação com regras diferentes

Havia duas rotas que criam downwind, e elas divergiram:

| | `POST /api/downwind` (modal do Mapa) | `POST /api/events` type=Downwind (botão da aba Eventos) |
|---|---|---|
| Pergunta a visibilidade? | Sim | **Não** |
| Grava `visibilidade`? | Sim | **Não — caía no `DEFAULT 'privado'`** |
| Cria linha em `events`? | Só se `comunidade` | Sempre |

O botão que as pessoas usam é o da aba Eventos. Ele inseria em `downwinds`
sem mencionar a coluna `visibilidade`, então **todo downwind criado por ali
nascia fechado** — e o `WHERE` de `GET /api/events`, que está correto,
corretamente o escondia de todo mundo.

Não havia bug de listagem. Não havia bug de permissão. O downwind era mesmo
privado, e não existia nenhum jeito na interface de criar um que não fosse.

## O segundo card

Como downwind `privado` não gerava evento, foi preciso criar uma segunda lista
(`components/activity/ListaDownwinds.tsx`) só para ele aparecer para quem o
criou — senão o organizador não via o que tinha acabado de criar.

Com as duas listas na mesma aba, todo downwind de comunidade passou a ser
desenhado **duas vezes**: uma no card da lista de downwinds, outra no card do
evento. Não era bug visual: eram duas fontes de verdade para a mesma coisa.

## O que foi feito

**Uma superfície só.** Todo downwind passa a ter evento — inclusive o fechado
(`POST /api/downwind` deixou de condicionar a criação do evento). Com isso a
agenda vira a única lista, e a `ListaDownwinds` foi removida. Quem filtra é o
`WHERE` do GET, não a ausência da linha; e `events` não tem rota de leitura por
id (só DELETE), então a linha extra não abre porta nenhuma.

**A escolha de visibilidade existe e é explícita.** O formulário pergunta
"Quem pode ver", com a consequência escrita em vez do nome interno do valor:

- **Comunidade** — aparece na agenda de todo mundo
- **Fechado** — só quem receber o link entra

O pré-marcado é `comunidade`, ao contrário do padrão do servidor. Os dois estão
certos: o servidor fecha por omissão porque campo ausente nunca pode publicar
localização de um grupo; o formulário abre por padrão porque a pessoa tocou
"Criar Downwind" **na aba de eventos**, e a intenção declarada ali é convidar.

**A visibilidade fica escrita no card.** "Aberto à comunidade" ou "Fechado — só
por convite". Era exatamente a informação que faltava para entender por que
"não apareceu nada".

**Avisar amigos.** `POST /api/downwind/[id]/notificar` manda push para os
seguidores do organizador (`user_follows`). Quatro condições, em
`podeNotificarSeguidores`: só organizador, só comunidade, só status aberto, e
**uma vez só**. A trava de disparo único é `downwinds.notificado_em` com
`UPDATE ... WHERE notificado_em IS NULL RETURNING` — no banco, não na tela,
porque estado de tela não atravessa aparelho.

A marca é gravada **antes** do envio: falha no meio troca "pode duplicar" por
"pode não enviar", e só a segunda é recuperável.

**Filtro por estado.** `events.uf` é copiado de `spots.state` na criação
(ninguém digita). A barra de filtros só aparece quando há mais de um estado na
agenda — com tudo no RN, um botão só é ruído. Ela nasce sozinha quando o app
chegar a Cumbuco e Búzios.

## Uma coisa que quase se perdeu

A varredura de downwind abandonado (`encerrarAbandonados`) pegava carona em
`GET /api/downwind`, que era o que alimentava a lista removida. Sem cuidado,
ela teria voltado a depender só do cron — que entrega uma execução a cada ~4,3h
e já deixou um downwind "Na água agora" por dois dias. Ela mudou junto, para
`GET /api/events`.

Também foi reposto no card o "Acompanhar de terra", que a lista removida
oferecia: ver o grupo atravessar **sem** virar participante (o que entraria no
quórum de encerramento). Só em downwind de comunidade em andamento, que é o que
`podeVerReplayAoVivo` libera para não participante.

## Por que nenhum teste pegava

O INSERT sem a coluna era **SQL válido**: o TypeScript compilava, a rota
respondia 200, o lint não tinha o que dizer. A varredura de esquema de
`scripts/verify-sql.ts` também não pegava, porque ela troca todo `${...}` por
`NULL` antes de validar — ela prova que a coluna existe, não que a rota a
preenche.

Foi preciso um teste que **lê o código-fonte da rota**
(`lib/downwindVisibilidade.test.ts`, "as rotas de criação preenchem a
visibilidade"). É feio de propósito. Verificado nos dois sentidos: com o INSERT
original de volta, reprova.

Mais nove checks em `scripts/verify-sql.ts` cobrem o comportamento contra
Postgres real: fechado escondido de terceiro, comunidade visível para todos,
criador vendo o próprio fechado, uma linha por downwind, filtro de UF nos dois
sentidos, e a corrida do disparo único.

---

# Adendo — a agenda voltou a sumir (02/09, 22:29)

O dono criou um downwind e não apareceu nada. Desta vez a causa foi minha, no
commit anterior, e é uma armadilha que vale documentar porque não é óbvia.

## O erro

Produção (Vercel runtime errors), rota `/api/events`:

```
NeonDbError: could not determine data type of parameter $5   (42P18)
```

`GET /api/events` devolvia 500 para todos. `loadFeedAndEvents` usa
`Promise.allSettled` e só aplica o resultado quando `fulfilled`, então a lista
de eventos ficava com o valor anterior — vazia. O downwind ERA criado (o POST
funcionava); a agenda é que não carregava.

## A causa: interpolação dentro de comentário SQL

```ts
sql`
  ...
  -- Filtro de estado. Sem filtro (${ufFiltro} IS NULL) tudo passa; com
  AND (${ufFiltro}::text IS NULL OR e.uf = ${ufFiltro})
`
```

Um comentário SQL **não é inerte dentro de um template literal**. O JavaScript
interpola antes de o Postgres ver qualquer coisa, então aquele `${ufFiltro}` do
comentário virou o parâmetro `$5` de verdade, enviado junto dos outros. O lexer
do Postgres descarta tudo depois de `--`, então `$5` chega declarado e **nunca
é usado** — sem contexto, não há como inferir tipo. 42P18.

O cast `::text` que eu tinha escrito com cuidado estava no `$6`. O parâmetro
sem tipo era o do comentário.

## Segunda armadilha, na própria correção

A primeira versão do comentário de correção usava **crases** em volta de `--`
para destacá-lo. Crase dentro de um template literal **encerra o template ali
mesmo**. O arquivo deixou de compilar, e — pior — a varredura nova passou
verde, porque o extrator parava na crase e nunca chegava aos parâmetros reais.

Foi só rodando `tsc` depois da correção que isso apareceu. A lição operacional:
**a contraprova de um teste novo não vale se o arquivo em que ela roda estiver
quebrado de outro jeito.**

## Por que nenhuma verificação pegava

`scripts/verify-sql.ts` troca todo `${...}` por `NULL` antes de validar. Isso
prova que tabelas e colunas existem, e é cego para tudo que dependa de tipo:
`NULL` literal se molda ao contexto, `$n` não. Com `-- ... (NULL IS NULL) ...`
o comentário fica inofensivo e o check passa.

## Duas verificações novas

1. **`varrerParametrosDasRotas`** — prepara TODA consulta com `$1..$n` no
   lugar, como o driver envia. Pega o sintoma exato: 217 consultas validadas,
   e com o bug de volta ela reprova com a mesma mensagem da produção.
2. **`varrerComentariosDosTemplates`** — pega a CAUSA direto: nenhum comentário
   SQL pode conter `${`. Cobre também o caso em que o parâmetro órfão por acaso
   tipa e o erro só apareceria depois, com outro dado.

Ambas verificadas nos dois sentidos.

## Regra para quem escrever SQL aqui

Dentro de um `` sql`...` ``, um comentário `--` não pode conter **nem `${` nem
crase**. As duas coisas são código, não texto.
