# "Ao participar do evento, não dá pra ver a lista dos participantes"

Não era bug: **a funcionalidade não existia**.

## O que o código realmente fazia

`event_registrations` é gravada corretamente desde sempre. O problema é que as
**duas únicas consultas à tabela em todo o app** eram contagens:

```
app/api/events/route.ts:66   (SELECT COUNT(*) FROM event_registrations ...) AS participants_count
app/api/events/route.ts:68   SELECT 1 FROM event_registrations er   -- só para o "eu confirmei?"
app/api/events/[id]/register/route.ts   COUNT(*)  (duas vezes, no toggle)
```

Não havia rota que listasse quem confirmou, e o card mostrava
`{participantsCount} riders confirmados` como texto morto. Dava para saber que
cinco pessoas iam, e não existia lugar nenhum — nem tela, nem rota — que
dissesse quem eram.

É a mesma família de defeito que já apareceu meia dúzia de vezes nesta base: **o
dado é registrado direito e depois não chega a lugar nenhum.** Aqui dói porque
confirmar presença serve justamente para o grupo se organizar; sem os nomes, o
número é enfeite.

## A parte que exigiu cuidado: privacidade

Um evento pode ser um **downwind fechado**, e a lista de quem vai já diz onde um
grupo estará e quando. A rota nova recebe um id de evento arbitrário, então não
pode confiar em "o cliente só pede o que a listagem mostrou".

A regra de acesso existia só como `WHERE` inline em `GET /api/events`. Enquanto
apenas a listagem precisava dela, tudo bem — com uma segunda rota, virou regra
duplicada, e **regra de privacidade duplicada é regra que diverge**. Virou
`podeVerEvento` (pura, testada) em `lib/downwindVisibilidade.ts`.

Quem não pode ver recebe **404 com a mesma mensagem** de evento inexistente:
diferenciar as respostas confirmaria a existência do downwind fechado para um
estranho. Mesmo princípio de `MSG_DOWNWIND_NAO_ENCONTRADO`.

Campos devolvidos: os mesmos que `/api/riders/search` já trata como públicos —
nome, avatar, rider_id, bandeira, nível, home spot. **Nunca e-mail**: uma lista
de presença é o lugar mais fácil de vazar a base de contatos inteira.

## Uma decisão que parece descuido e não é

O `JOIN users` **não** filtra `is_active`. Uma conta suspensa depois de
confirmar presença continua sendo alguém que disse que vem; sumir da lista em
silêncio faria a contagem do card divergir da lista aberta a partir dele. O card
conta linhas de `event_registrations`, e esta consulta também.

## Verificações

Cinco checks novos em `scripts/verify-sql.ts`. O que importa não é cada regra
isolada — é que **as duas concordam**: para os três atores (terceiro num
downwind aberto, terceiro num fechado, criador do fechado), o `WHERE` da
listagem e o cabeçalho da rota de participantes dão a mesma resposta.

`podeVerEvento` tem teste em ambos os sentidos: afrouxando a regra para
`return true`, o teste "downwind fechado: estranho não vê" reprova.

A folha foi renderizada num Chromium a 390px com nomes longos: 390/390, sem
vazamento horizontal.
