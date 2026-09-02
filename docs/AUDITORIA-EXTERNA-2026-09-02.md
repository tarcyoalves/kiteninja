# Auditorias externas de 02/09/2026 — o que foi feito

Duas auditorias 360° chegaram no mesmo dia. Este documento registra, item a
item, **o que foi verificado contra o código real**, o que foi corrigido, e o
que depende de algo que um agente não tem (conta, chave, decisão de produto).

Regra que vale para quem ler isto depois: **auditoria não é diagnóstico**. Boa
parte dos achados das duas descrevia problemas que o código já não tinha, ou
descrevia a causa errada. Cada linha abaixo só entrou depois de conferida no
arquivo.

---

## 1. Cache de meteorologia distribuído entre instâncias — CORRIGIDO

**O que as auditorias disseram:** o cache do clima é um `Map` em memória, então
não escala; recomendaram Redis/Upstash como P0.

**O que era verdade:** a metade do diagnóstico. `lib/weather.ts` tinha, e ainda
tem, `const cache = new Map(...)`. Esse `Map` vive dentro de **uma** instância
serverless. A Vercel roda muitas instâncias em paralelo, e cada uma começa fria.
Com N usuários abrindo o mesmo spot ao mesmo tempo, a Open-Meteo levava N
chamadas mesmo com o cache "funcionando" — porque cada instância tinha o seu.

**Por que a recomendação delas foi recusada:** Redis resolve, mas cobra um
serviço externo, uma credencial nova em produção, e um ponto de falha a mais
num app onde o SOS precisa subir mesmo quando tudo o mais está fora do ar. O
Next já tem um cache compartilhado entre instâncias do mesmo deploy — o Data
Cache — e ele é acionado por uma opção no próprio `fetch`.

**O que foi feito** (`lib/weather.ts`):

```ts
const politicaDeCache: RequestInit = semCache
  ? { cache: 'no-store' }
  : ({ next: { revalidate: CACHE_TTL_SEGUNDOS } } as RequestInit);
```

- `CACHE_TTL_MS` virou derivado de `CACHE_TTL_SEGUNDOS` (600), para os dois
  níveis de cache não poderem divergir por edição descuidada.
- O `Map` **continua** — ele ainda evita reparsear o JSON e refazer todo o
  cálculo de maré/onda dentro de uma instância quente. Virou segundo nível.
- O `refresh=1` do usuário (`forceRefresh`) atravessa os dois níveis: volta a
  `cache: 'no-store'`, porque `cache` e `next.revalidate` são mutuamente
  exclusivos no fetch do Next.

**Por que isso funciona mesmo numa rota dinâmica** — a dúvida legítima, já que
`/api/spots` lê cookie antes de buscar o clima. Conferido no código do próprio
Next (`node_modules/next/dist/server/lib/patch-fetch.js`): o desligamento
automático do cache (`autoNoCache`) exige `hasNoExplicitCacheConfig`, que por
sua vez exige `currentFetchRevalidate == undefined`. Passar `revalidate: 600`
explicitamente derruba essa condição, e o `cacheReason` vira `revalidate: 600`.
O caminho automático não tem como apagar uma escolha explícita.

**E a resposta da rota, é cacheada por engano?** Não, por três motivos
independentes: a rota lê `cookies()` antes (fica dinâmica), `lib/api.ts` manda
`Cache-Control: no-store, must-revalidate` em toda resposta, e o `next build`
segue listando `/api/spots` como `ƒ (Dynamic)`. O que entra no Data Cache é a
resposta **da Open-Meteo**, não a do KiteNinja.

**O driver do banco não é afetado:** `@neondatabase/serverless` fala por
`method:"POST"`, e o Data Cache do Next só guarda GET.

**Teste que trava a regressão** (`lib/weather.test.ts`, "política de cache das
chamadas externas"): substitui `globalThis.fetch`, inspeciona o `init` de cada
chamada e exige `next.revalidate === 600` no caminho normal e
`cache: 'no-store'` no refresh explícito. Foi verificado nos dois sentidos —
com `no-store` de volta no código, o teste falha.

Essa regressão precisa de teste justamente porque é **invisível**: voltar para
`no-store` não quebra nenhuma tela, não derruba nenhum teste de UI, e só
aparece na fatura e no rate limit da Open-Meteo, onde ninguém está olhando.

---

## 2. Fila offline de GPS — CORRIGIDO (commit `bc01965`)

Ver `lib/filaPosicoes.ts`. Posição perdida por rede caída durante downwind é o
mesmo defeito recorrente deste app: **medir o dado certo e perdê-lo**.

---

## 3. Política de privacidade e assetlinks — CORRIGIDO (commit `bc01965`)

`/privacidade` público, sem login. `public/.well-known/assetlinks.json` com o
pacote correto e a impressão SHA-256 como marcador — só o dono do keystore pode
preenchê-la.

---

## 4. Itens que dependem do usuário, não de código

Não foram implementados de propósito. Implementar por cima de um palpite seria
pior do que deixar explícito:

| Item | O que falta | Por quê não dá para fazer daqui |
|---|---|---|
| Sentry / Crashlytics | DSN e conta | Nenhum agente pode criar a conta nem gravar variável de ambiente na Vercel |
| Impressão SHA-256 no assetlinks | keystore de release | Existe só na máquina do usuário, e é o que assina o app — não deve sair de lá |
| Data Safety do Play Console | preenchimento no console | Formulário externo, sob a conta do desenvolvedor |
| Declaração de localização em background + vídeo | gravação do fluxo real | Exige o app rodando no aparelho |
| Escalonamento de SOS por cron externo | conta no cron-job.org | Ver `docs/CRON-EXTERNO-SOS.md` |

## 5. Monetização — recusada por ora, com motivo

As duas auditorias pediram plano Pro, preço e paywall. Isso não é uma pendência
técnica: é decisão de produto, e o app tem ~5 usuários e ainda não está
publicado. Cobrar antes de existir uso não gera receita, gera trabalho de
manutenção (assinatura, cancelamento, reembolso, estado "expirado" em toda tela)
sobre uma base que ainda pode mudar de forma. Quando houver decisão de preço e
de **o que** é Pro, é uma tarefa direta.

---

## O que não mudou e por quê

O `Map` em memória continua em `lib/weather.ts`. Uma auditoria pediu para
removê-lo. Ele não é o problema — ele é uma economia real dentro de uma
instância quente, e agora está atrás de um cache compartilhado. Remover custaria
CPU sem devolver nada.
