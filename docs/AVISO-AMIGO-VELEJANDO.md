# Aviso "amigo entrou na água"

Push + notificação in-app quando alguém que o usuário segue começa um velejo
ou um downwind. Implementado em 26/08/2026 (commit `9351e18`).

## O que dispara

| Evento | Onde | Tipo de notificação |
|---|---|---|
| Downwind passa a `em_andamento` | `PATCH /api/downwind/[id]/status` | `downwind_iniciado` |
| Velejador toca "Iniciar velejo" | `POST /api/velejos/inicio` (rota nova) | `velejo_iniciado` |

Quem recebe: todo mundo que **segue** o velejador (`user_follows`), desde que
esteja com a conta ativa e com a preferência ligada.

## Decisões e o porquê de cada uma

### Só avisa — não cria estado de "velejo ao vivo"

Não existe tabela de sessão aberta, nem ciclo de vida a manter, nem nada a
encerrar. O logbook continua sendo registrado depois, como sempre
(`POST /api/sessions`).

**Consequência aceita:** o servidor não sabe quando o velejo termina. Para o
que a funcionalidade promete — "avise meus amigos que entrei na água" — não
precisa saber. Se um dia o produto quiser "quem está velejando agora" no mapa,
aí entra estado, e isso é uma decisão diferente, não um detalhe desta.

### Velejo solo precisou de uma rota nova; downwind não

Downwind já tinha evento de servidor. Velejo solo **não tinha nenhum**: tocar
em "Iniciar velejo" só trocava de aba no cliente, nada chegava ao servidor.
Sem um evento em que pendurar o aviso, não havia o que notificar — daí
`POST /api/velejos/inicio`.

### O aviso de downwind sai exatamente uma vez, sem trava em JavaScript

O gancho fica **depois** do `rows.length === 0` na rota de status. Isso não é
acaso: o `UPDATE ... WHERE id = $1 AND status = 'aberto'` já resolve **no
banco** a corrida de vários velejadores tocando Iniciar ao mesmo tempo. Só o
vencedor da corrida chega ao gancho.

Aproveitar uma garantia que o banco já dá é melhor que inventar uma segunda no
código — duas travas para o mesmo problema é onde nasce a divergência.

### Preferência por usuário, padrão ligado

Coluna `users.notificar_amigo_velejando`, interruptor em Preferências
(`views/PerfilView.tsx`).

- **Padrão ligado** porque a graça é justamente descobrir que tem gente na
  água. Nascendo desligado, o recurso ficaria invisível para quem nunca abre
  configurações.
- **Desligável** porque push que não se desliga é motivo comum de
  desinstalação — e aqui o volume cresce com o número de pessoas seguidas, ou
  seja, quem segue muita gente é exatamente quem mais precisa do interruptor.
- A preferência consultada é a de **quem recebe**, não a de quem entrou na
  água. Quem decide se quer ser avisado é quem é avisado.

Detalhe de implementação que evita um bug silencioso: o `PATCH /api/profile`
checa presença do campo antes de ler o valor, em vez de `Boolean(...)`. Com
`COALESCE`, `undefined` significa "não mexer" e `false` significa "desligar" —
convertendo direto, um PATCH que só muda o nome mandaria `false` e desligaria
a preferência sem ninguém pedir.

### Anti-repetição de 3 horas

`lib/avisoVelejo.ts`, função pura e testada. Nenhum segundo aviso do mesmo
tipo pelo mesmo velejador dentro da janela.

O caso não é hipotético: "Iniciar" é o botão mais fácil de tocar duas vezes
(voltou para a praia, reabriu o app, tocou sem pensar), e **cada toque
acordaria o celular de todo mundo que segue essa pessoa**. Um aviso repetido
custa pouco para quem manda e caro para dezenas que recebem — a assimetria é o
motivo de o padrão ser "não repetir".

Há também um rate limit de 10/h por usuário na rota. São coisas diferentes: a
janela protege os **seguidores** de aviso repetido; o rate limit protege o
**servidor** de um cliente em laço de erro.

### O fan-out é uma query só

```sql
INSERT INTO notifications (recipient_id, actor_id, type)
SELECT f.follower_id, $1, $2
FROM user_follows f
JOIN users u ON u.id = f.follower_id
WHERE f.following_id = $1
  AND u.is_active = TRUE
  AND u.notificar_amigo_velejando = TRUE
  AND f.follower_id <> $1
LIMIT 500
RETURNING recipient_id
```

A lista de destinatários **nunca passa pelo JavaScript como parâmetro** —
nada de montar array e confiar na serialização do driver. É a lição do
`sql\`DEFAULT\`` aplicada de propósito (ver
`docs/INVESTIGACAO-RASTREIO-BACKGROUND.md`): o driver HTTP do Neon tem
comportamento próprio com parâmetros, e a forma de não depender disso é deixar
o Postgres fazer o trabalho inteiro. O `RETURNING` devolve exatamente quem
recebeu, e é essa lista que vai para o push.

A query roda contra **Postgres real** em `scripts/verify-sql.ts`, não contra
mock.

O filtro `f.follower_id <> $1` é defesa em profundidade: o próprio
`user_follows` tem CHECK que recusa auto-seguir, então a linha não consegue
existir. Fica porque o custo é zero e a consequência de faltar seria
desproporcional — uma única linha assim violaria o CHECK de `notifications` e
derrubaria o INSERT **inteiro**, levando junto todos os avisos legítimos do
lote.

### Push é fire-and-forget

A notificação in-app é gravada de forma síncrona; o push sai sem `await`.
Quem tocou "Iniciar" está indo para a água — a resposta não pode esperar o
envio para dezenas de dispositivos. `avisarSeguidoresDeInicio` **nunca lança**:
falha de aviso não pode impedir alguém de entrar na água.

A rota devolve o resultado honesto (`{ avisados, motivo }`) em vez de um
`ok: true` genérico. Sem isso, "não recebi aviso nenhum" seria indistinguível
de "ninguém te segue" e de "você já tinha avisado há pouco" — o mesmo problema
de diagnóstico cego que o rastreio nativo teve.

## A armadilha encontrada no caminho

**A lista de tipos de notificação existe em DOIS lugares em `lib/schema.sql`:**

1. a `CHECK` inline do `CREATE TABLE notifications` (perto do início);
2. um bloco `DO $$ ... $$` bem mais abaixo, que derruba e recria a constraint.

**O bloco `DO` é o último a rodar, e portanto é o que vale.** Atualizar só a
`CHECK` inline não tem efeito nenhum num banco que já existe — nem num banco
novo, porque o `DO` recria por cima de qualquer forma.

Foi exatamente o erro cometido aqui: o schema parecia certo, e o `INSERT`
continuava sendo recusado com `violates check constraint
notifications_type_check`. Só apareceu porque `verify-sql.ts` roda contra
Postgres de verdade.

Deixei o aviso escrito ao lado do bloco `DO` para o próximo não perder tempo.

## Arquivos

| Arquivo | Papel |
|---|---|
| `lib/avisoVelejo.ts` | Regras puras: janela anti-repetição, teto de destinatários, textos do push |
| `lib/avisoVelejo.test.ts` | 11 testes das regras acima |
| `lib/notificacoes.ts` | `avisarSeguidoresDeInicio` — a query de fan-out e o disparo do push |
| `app/api/velejos/inicio/route.ts` | Rota nova do velejo solo |
| `app/api/downwind/[id]/status/route.ts` | Gancho do downwind |
| `app/api/profile/route.ts` | Grava a preferência |
| `app/api/auth/me/route.ts` | Devolve a preferência ao cliente |
| `views/PerfilView.tsx` | Interruptor |
| `components/NotificationCenterModal.tsx` | Texto e ícone dos dois tipos novos |
| `lib/schema.sql` | Coluna da preferência + tipos novos na CHECK |
| `scripts/verify-sql.ts` | 22 checagens contra Postgres real |

## Pré-requisito para o push funcionar de verdade

A notificação in-app (o sininho) funciona sozinha. **O push depende de
segredos que ainda faltam:**

- `GOOGLE_APPLICATION_CREDENTIALS_JSON` — FCM, para o app Android.
- Par VAPID (`NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY`) — Web Push.

Sem eles **nenhum push sai do servidor, e falha em silêncio** — nada quebra na
tela, ninguém é avisado. Passo a passo em `docs/CONFIGURACAO-SEGREDOS.md`.

## Como testar

Duas contas, A seguindo B, A com o interruptor ligado.

1. B toca "Iniciar velejo" → A recebe notificação no sininho (e push, se os
   segredos estiverem configurados).
2. B toca de novo em seguida → **A não recebe nada** (janela de 3h).
3. A desliga o interruptor em Preferências; B inicia um downwind → A não
   recebe.
4. A liga de volta; B inicia um downwind → A recebe, com texto de downwind.

Se nada chegar, o corpo da resposta de `POST /api/velejos/inicio` diz o
motivo: `sem_seguidores`, `repetido` ou `erro`.

## O que ficou de fora, de propósito

- **Estado de "velejo ao vivo"** — ver a primeira decisão acima.
- **Aviso de fim de velejo** — o servidor não sabe quando termina.
- **Granularidade por pessoa** ("avisar só destes amigos") — uma preferência
  global resolve o problema real (volume de push); por pessoa só faz sentido
  se alguém pedir.
- **Fila para fan-out grande** — o teto de 500 destinatários é o limite em que
  o disparo dentro do request ainda é razoável. Passando disso, vira caso para
  fila, não para um `for` mais longo.
