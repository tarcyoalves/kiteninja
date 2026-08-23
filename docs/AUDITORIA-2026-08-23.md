# Auditoria de pré-lançamento — 2026-08-23

Auditoria independente pedida pelo dono do produto, com foco no que pode
**machucar um velejador de verdade** ou **vazar dados** depois do lançamento.

Regra deste documento: só entra achado **verificado por execução ou leitura
direta do código**. Onde não deu para verificar, está escrito "não verificado".
Nada aqui foi corrigido ainda — este é o diagnóstico.

## Estado das barreiras de qualidade (medido hoje)

| Portão | Resultado |
|---|---|
| `npx tsc --noEmit` | limpo |
| `npx vitest run` | **635 passando, 36 arquivos** |
| `npx tsx scripts/verify-sql.ts` | **219 checagens, 0 falhas** (Postgres real via PGlite) |
| Env de produção | `DATABASE_URL`, `VAPID_*`, `BLOB_*`, `APP_URL` presentes |

As três barreiras estão verdes. Os achados abaixo são coisas que **nenhuma
delas cobre** — é por isso que passaram.

---

## P0 — Caminho de vida (SOS)

### P0-1. SOS sem GPS não notifica ninguém

O cliente foi **deliberadamente** escrito para disparar SOS sem coordenada.
Em `lib/useSosHold.ts:83-85`, se a geolocalização falha ou estoura o prazo de
3s, o comentário diz: *"Sem GPS é ok — o SOS sai de todo jeito"*.

Mas no servidor, `app/api/sos/route.ts:79`:

```ts
let candidatos = [];
if (lat !== null && lng !== null) {   // <-- sem coordenada, ninguém é selecionado
  candidatos = await selectSosCandidates({ ... });
}
```

O alerta é **gravado**, o `audit_log` é escrito, a resposta volta `200 OK` — e
`candidatos` fica vazio. Zero linhas em `sos_responders`, zero push. O
velejador vê "SOS enviado" e ninguém foi avisado.

A escalada não salva esse caso: `app/api/sos/active/route.ts:87` tem o mesmo
`if (lat !== null && lng !== null)`.

Agrava: sem GPS o `spot_id` também não é resolvido (`route.ts:54`), então nem
o fallback "quem declarou estar neste spot" entra.

Cenário real: celular no bolso do shorts, GPS frio, dentro da água, nublado —
exatamente a condição em que o SOS é apertado.

**Correção:** quando não houver coordenada, notificar por fallback (último
`at_spot_id` conhecido do autor, ou presença mais recente dele, ou — em último
caso — todos os presentes na janela). E o cliente precisa dizer a verdade:
"SOS enviado, mas sem sua posição" é diferente de "SOS enviado".

### P0-2. `POST /api/sos/[id]/respond` não tem autorização nenhuma

`app/api/sos/[id]/respond/route.ts` — o arquivo inteiro tem **zero** consultas
de verificação. Não checa se o SOS existe, se está ativo, nem se o usuário foi
notificado. Vai direto para o `INSERT`:

```ts
const state = oneOf(body, 'state', ['a_caminho','no_local','nao_posso']);
await sql`INSERT INTO sos_responders (sos_id, user_id, state, lat, lng, responded_at)
          VALUES (${sosId}, ${user.id}, ${state}, ...)`;
```

Duas consequências, ambas confirmadas por leitura:

**(a) Vazamento de posição.** `sos/active/route.ts:139` libera as coordenadas
para quem está em `sos_responders`:

```ts
const isResponder = responders.some(rr => rr.userId === user.id);
const canSeePos = isResponder || isAuthor || isMod;
```

Qualquer usuário autenticado faz `POST /api/sos/<id>/respond` com
`state: 'nao_posso'`, entra na tabela, e passa a ver a **posição GPS exata**
de um velejador em emergência. O filtro de privacidade está correto; o que
está errado é que o próprio atacante consegue se colocar do lado de dentro.

**(b) Escalada travada para sempre.** Enviar `state: 'a_caminho'` executa
`UPDATE sos_alerts SET status = 'em_atendimento'` (linhas 30-36). E
`lib/sos.ts:44` é explícito:

```ts
if (args.statusAtual && args.statusAtual !== 'ativo') return false;
```

O comentário no código confirma que isso é intencional e **irreversível**: um
SOS que virou `em_atendimento` nunca volta a escalar, nem se o socorrista
depois marcar `nao_posso`. Então um único POST de qualquer conta congela o raio
em 5km e cala o alerta — sem nunca ter ido a lugar nenhum.

**Correção:** exigir que exista linha prévia em `sos_responders` com
`state='notificado'` (ou que o usuário seja moderador) antes de aceitar a
resposta. `WHERE` de dono no `UPDATE` de status.

### P0-3. A escalada só acontece se alguém estiver com o app aberto

`app/api/sos/active/route.ts:65-66` documenta a escolha:

> *"Escalada preguiçosa — a Vercel não tem processo em background e o cron do
> plano gratuito não existe. Como quem está online consulta a cada poucos
> segundos, a escalada acontece naturalmente pela consulta de qualquer usuário online."*

Verificado: `deveEscalar` só é chamado em `app/api/sos/active/route.ts`, e não
existe `vercel.json` — **não há cron**. O polling é de 12s
(`context/KiteDataContext.tsx:922`).

Além disso a query da linha 23 filtra
`AND (sa.user_id = ${user.id} OR sr.user_id = ${user.id})`: só o autor e os já
notificados enxergam o alerta. Se os 5km iniciais não pegaram ninguém online, o
SOS não aparece para **ninguém** — e como só quem enxerga é que dispara a
escalada, ela nunca roda. O raio nunca chega a 15km ou 50km.

Cenário real: velejador sozinho num spot vazio numa terça de manhã. Ninguém
com o app aberto em 5km. O SOS morre em silêncio na tabela.

Combinado com P0-1 (SOS sem GPS não notifica), o pior caso é: nenhum
socorrista, nenhuma escalada, nenhum aviso — e um `200 OK` na tela.

**Correção:** cron externo (ou Vercel Cron no plano pago) chamando um endpoint
de escalada, independente de haver gente online. Enquanto não houver, isso
precisa estar escrito na cara do usuário: o SOS depende da comunidade online.

### P0-4. Coordenadas de SOS não têm validação de faixa

Comparação direta entre rotas:

| Rota | Validação |
|---|---|
| `app/api/chat/presence/route.ts:47` | `{ min: -90, max: 90 }` |
| `app/api/downwind/[id]/posicoes/route.ts:191` | `{ min: -90, max: 90 }` |
| `app/api/sos/route.ts:19` | `{ optional: true }` — **sem faixa** |
| `app/api/sos/[id]/respond/route.ts:16` | `{ optional: true }` — **sem faixa** |

As duas rotas onde uma coordenada errada manda socorro para o oceano errado são
justamente as que não validam. `lib/validation.ts:34` usa
`min = -Infinity, max = Infinity` por padrão, então `lat: 999` passa e vai para
o `boundingBox`/Haversine.

**Correção:** `{ min: -90, max: 90 }` e `{ min: -180, max: 180 }` nas duas.

### P0-5. Rate limit de SOS é cobrado antes da deduplicação

`app/api/sos/route.ts`, ordem de execução:

```
linha 16   rateLimiters.sos(user.id)     <-- cobra a cota
linha 24   SELECT ... WHERE status='ativo' AND created_at > NOW() - INTERVAL '5 minutes'
linha 36   UPDATE  (é o mesmo SOS, só atualiza posição)
linha 70   INSERT  (SOS novo)
```

O teto é **3 por hora** (`lib/rateLimit.ts:114-120`). Como a cobrança vem
antes do `SELECT`, um reenvio que apenas **atualiza a posição do mesmo SOS em
andamento** consome cota igual. Três toques — retry por rede instável, ou o
velejador tentando atualizar a posição enquanto deriva — e o quarto pedido é
recusado com "Aguarde 1 hora".

O `finally` do cliente (`useSosHold.ts:104-107`) devolve o botão ao estado
normal, então nada impede os toques repetidos.

**Correção:** cobrar a cota só no caminho que realmente cria SOS novo (depois
do `SELECT` de dedup), ou isentar o `UPDATE` de posição.

### P0-6. SOS duplicado sob concorrência — provado por execução

Não há `UNIQUE` que impeça dois SOS ativos do mesmo usuário. Confirmado no
schema: `sos_alerts` (linha 542+) tem só `PRIMARY KEY (id)` e o `CHECK` de
status; os índices `idx_sos_active` e `idx_sos_user` são **não-únicos**.

O padrão do código é check-then-insert (`SELECT` na linha 24, `INSERT` na 70)
sem transação nem constraint por trás. Rodei a prova em Postgres real (PGlite,
mesmo `lib/schema.sql`), simulando dois pedidos concorrentes que leem antes de
qualquer escrita:

```
req A viu 0 SOS ativo | req B viu 0 SOS ativo
SOS ativos do MESMO usuario: 2  -> DUPLICATA CRIADA
```

Resultado: dois alertas ativos para o mesmo velejador. Os socorristas recebem
dois push do mesmo afogamento, com dois raios escalando em paralelo, e
resolver um deixa o outro ativo.

O mesmo `UPDATE` de escalada (`sos/active/route.ts:79-83`) não tem guarda de
raio — `WHERE id = ${sosId}` e nada mais. Dois polls simultâneos escalam o
mesmo SOS duas vezes.

**Correção:** índice único parcial
(`UNIQUE ... WHERE status IN ('ativo','em_atendimento')`) + `ON CONFLICT`, e
`AND radius_km = ${radiusAtual}` no `UPDATE` da escalada.

### P0-7. `lib/sosCandidates.ts` não tem teste unitário

Verificado: existe `lib/sos.test.ts` (15 testes, cobre `deveEscalar`,
`proximoRaio`, `ordenarCandidatos`), mas **não existe** `lib/sosCandidates.test.ts`.

`selectSosCandidates` é a função que decide **quem é avisado** numa emergência:
resolve posição real vs. spot declarado, aplica bounding box, corta por janela
de presença de 15min e filtra por Haversine. Nenhuma linha dela é coberta por
teste, e `scripts/verify-sql.ts` também não a exercita.

Os 635 testes verdes não dizem nada sobre o caminho de vida.

---

## P1 — Segurança de plataforma

### P1-1. Nenhum header de segurança e nenhum middleware

`next.config.ts` não tem bloco `headers` — verificado por grep: nada de CSP,
HSTS, `X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options`,
`Permissions-Policy`. E não existe `middleware.ts`.

Atenuante real: não há **nenhum** `dangerouslySetInnerHTML` no projeto
(verificado), então o escape padrão do React cobre XSS refletido. O risco maior
aqui é clickjacking e vazamento de `Referer`.

Origens externas já mapeadas para a allowlist de CSP: `api.open-meteo.com`,
`marine-api.open-meteo.com`, `blob.vercel-storage.com`,
`server.arcgisonline.com`, `carto.com`, `wind-monitor.lhprovedor.com.br`,
`wa.me`, `maps.google.com`.

### P1-2. Rate limit é em memória — não sobrevive ao serverless

`lib/rateLimit.ts:14` usa `const store = new Map()` no processo. Em Vercel cada
instância tem o seu; instâncias reciclam a cada poucos minutos. O teto de 5
tentativas de login por 15min (linha 90) vira 5 **por instância**, e um
atacante que force novas instâncias reseta a contagem.

Não é falso: as 8 rotas protegidas (`login`, `invite`, `passwordReset`, `sos`,
`downwindPosicao`, `downwindEntrar`) estão lá e funcionam num processo só. Mas
a proteção é bem mais fraca do que o número sugere.

### P1-3. Zero observabilidade

Nenhuma ferramenta instalada (verificado no `package.json`: sem Sentry,
Datadog, Logtail, Axiom, pino, winston). O tratamento de erro é
`console.error('[api] erro não tratado:', err)` em `lib/api.ts:17`.

Consequência concreta para este produto: se um SOS falhar em produção,
**ninguém fica sabendo**. Não há alarme, não há agregação, e os logs da Vercel
têm retenção curta no plano atual.

---

## O que auditei e está correto

Vale registrar, porque restringe onde vale gastar esforço:

- **Autorização de DM.** `requireExistingRoom` (`app/api/chat/messages/route.ts:88-118`)
  é um portão único usado por GET **e** POST. Valida participação em downwind e
  membresia de DM via `canAccessDm` (`lib/authz.ts:91`), com teste de negação
  para terceiro (`lib/authz.test.ts:342`).
- **Privacidade de posição no SOS.** O filtro `canSeePos`
  (`sos/active/route.ts:139-142`) está corretamente escrito. O problema é o
  P0-2 permitir entrar na lista, não o filtro.
- **Sem escalonamento de privilégio.** `PATCH /api/profile` usa allowlist
  explícita de campos — `role` e `email` não são aceitos.
  `PATCH /api/admin/users/[id]` exige `requireAdmin`, valida `role` contra
  `ALLOWED_ROLES` e tem guarda anti-autobloqueio (linhas 36-37).
- **IDOR:** varri todas as rotas com `UPDATE`/`DELETE`. Os casos que meu grep
  inicial apontou (`notifications`, `riders/[id]/follow`, `alerts/[id]`,
  `sessions/[id]/comments/[commentId]`) foram lidos um por um e **todos** têm
  filtro de dono ou checagem de papel. O único furo de autorização real é o
  P0-2.
- **Push resiliente.** `lib/push.ts:119-122` envolve cada envio em try/catch
  individual: a falha de um socorrista não aborta os outros. VAPID configurado
  em produção, com a chave privada **sem** prefixo `NEXT_PUBLIC_` (correto).
- **Polling com cleanup.** `KiteDataContext.tsx:919-924` retorna
  `clearInterval` — sem vazamento de timer.
- **Cascatas de exclusão.** 219 checagens em `verify-sql.ts` cobrem
  `ON DELETE CASCADE`, inclusive `sos_alerts` e `push_subscriptions`.

---

## Ordem de correção sugerida

O SOS é o único subsistema onde um bug tem custo físico. Tudo em P0 é do SOS.

1. **P0-2** (autorização em `respond`) — é vazamento de dados *e* travamento de
   escalada num arquivo só. Maior retorno por linha mudada.
2. **P0-4** (faixa de lat/lng) — duas linhas, risco alto.
3. **P0-1** (SOS sem GPS) — precisa decidir a política de fallback.
4. **P0-5** (ordem do rate limit) — mover uma linha.
5. **P0-6** (unicidade + guarda de escalada) — migração idempotente.
6. **P0-7** (teste de `sosCandidates`) — trava as correções acima.
7. **P0-3** (cron de escalada) — depende de decisão de plano/infra.
8. P1-1, P1-2, P1-3.

Nada disso é corrigido neste commit: este documento é só o diagnóstico, para
que a ordem seja decidida antes de mexer no caminho de vida.
