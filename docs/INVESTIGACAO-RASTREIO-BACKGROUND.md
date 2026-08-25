# Investigação — "o downwind não rastreia com a tela apagada"

Registro forense do problema mais persistente do projeto: **três rodadas de
correção, três relatos de que continuava falhando.** Este documento existe
para que ninguém precise repetir a investigação nem refazer as hipóteses já
descartadas.

Escrito em 25/08/2026, consolidando as três rodadas.

## O relato, e como ele mudou

| Rodada | Relato do dono | O que foi corrigido | Resolveu? |
|---|---|---|---|
| 1 | *"no dw não está monitorando com o app fechado no android"* | `document.hidden` no beacon + Wake Lock na travessia inteira | **Não** — foi corrigido o cenário vizinho |
| 2 | (cobrança) *"vc viu isso e montou plano de correção?"* | Nada de código; plano escrito | **Não** — era plano |
| 3 | *"continua sem rastrear quando o app fecha a tela / app minimizado"* | Bug de SQL que derrubava todo POST do beacon web + diagnóstico na tela | **A verificar no aparelho** |

**A lição da rodada 1**, que vale registrar: "tela apagada", "app minimizado"
e "app fechado" **são três cenários diferentes com causas diferentes**, e de
fora parecem idênticos (o velejador some do mapa). Tratar os três como um só
foi o que fez a primeira correção parecer errada — ela consertou um problema
real, só não o que tinha sido testado.

| Cenário | O que roda | Quem cobre |
|---|---|---|
| App aberto, tela ligada | Tudo | Beacon web |
| Tela apagada, app vivo | JS congela em minutos | Beacon web + Wake Lock |
| App minimizado | JS congela mais rápido | Beacon web (frágil) + serviço nativo |
| **App fora dos recentes** | **Nada de JS** | **Só o Foreground Service nativo** |

---

## Todas as hipóteses levantadas e o veredito de cada uma

Esta é a parte que evita retrabalho. Cada linha foi verificada, não suposta.

| # | Hipótese | Como foi testada | Veredito |
|---|---|---|---|
| 1 | Beacon pausava com `document.hidden` | Leitura de `lib/useDownwindBeacon.ts` | ✅ **Confirmada** — corrigida em `2f586ad` |
| 2 | Tela apagando congelava a página | Wake Lock existia só no Modo Navegação | ✅ **Confirmada** — corrigida em `2f586ad` |
| 3 | Com app fechado não há JS nenhum | Modelo de execução (PWA/TWA/WebView) | ✅ **Confirmada** — limitação de plataforma, exige serviço nativo |
| 4 | `AndroidManifest` sem `foregroundServiceType` | Leitura do manifest | ❌ Descartada — está correto (`location`) |
| 5 | Plugin Capacitor não registrado | Leitura de `MainActivity.java` | ❌ Descartada — `registerPlugin()` antes de `super.onCreate()` |
| 6 | Falta `ACCESS_BACKGROUND_LOCATION` | Análise da política do Android/Play | ❌ Descartada — **desnecessária e indesejável** (ver abaixo) |
| 7 | Efeito do tracking não re-dispara | Leitura do array de dependências | ❌ Descartada — completo (`id`, `status`, `papel`, `estado`) |
| 8 | `RETURNING id` numa tabela sem `id` | Leitura de `lib/schema.sql` | ❌ Descartada — a coluna existe |
| 9 | Serviço nativo duplicando o beacon web | Cabeçalho de `lib/downwindTracker.ts` | ❌ Descartada — convivência deliberada, servidor guarda a mais recente |
| 10 | **`sql\`DEFAULT\`` aninhado quebrava o POST** | **Executado o template do Neon + PGlite** | ✅ **CONFIRMADA — era um bug real e grave** |
| 11 | Status nativo invisível impedia diagnóstico | `grep` por `statusTrackingNativo` nas views | ✅ **Confirmada** — nunca era renderizado |
| 12 | APK testado é anterior ao serviço nativo | Não verificável remotamente | ⏳ **Em aberto — pergunta ao dono** |
| 13 | Fabricante (Xiaomi/Samsung) matando o serviço | Não verificável remotamente | ⏳ **Em aberto** |
| 14 | Tabela de token não migrada em produção | `CREATE TABLE IF NOT EXISTS` + `migrate-on-build` no `npm run build` | ⏳ Provavelmente ok, não verificável sem `DATABASE_URL` |

---

## A falha principal encontrada (nº 10) — provada, não deduzida

`app/api/downwind/[id]/posicoes/route.ts` tinha:

```ts
VALUES (${id}, ${usuario.id}, ${lat}, ${lng}, ${accuracyM}, ${registradoEm ?? sql`DEFAULT`})
```

A intenção é clara e parece razoável: *"se não veio timestamp, usa o DEFAULT
da coluna"*. O TypeScript aceita, o build passa, nenhum teste reclamava.

**Mas o driver HTTP do Neon (`@neondatabase/serverless`) não compõe fragmentos
de SQL.** Diferente de bibliotecas como `postgres.js`, onde isso funcionaria,
aqui o `sql` aninhado é avaliado como objeto e entra como **valor de
parâmetro**. Executando o template real:

```
values: [1, {"queryData":{"strings":["DEFAULT"],"values":[]}}]
```

E o Postgres (verificado com PGlite) responde:

```
Invalid input for date type
```

### Por que este bug era tão difícil de enxergar

O app nativo **sempre** manda `registradoEm`. O beacon web **nunca** manda.

Então o defeito derrubava **exatamente um dos dois caminhos** — e justamente o
que cobre "tela apagada com a página ainda viva". Todo POST do beacon web
devolvia **500** e **nenhuma posição era gravada**, sem nada aparecer na tela
de quem estava na água. Um bug que parece intermitente e específico de
plataforma, mas era determinístico.

### A correção

Duas queries completas, escolhidas em JavaScript. Omitir a coluna deixa o
`DEFAULT NOW()` da tabela agir — que era a intenção original.

### A trava contra reincidência

`lib/sqlComposicao.test.ts` varre `app/`, `lib/` e `scripts/` procurando a
assinatura do defeito (um template `sql` dentro de `${...}`), ignorando linhas
de comentário — senão a própria explicação da correção seria acusada como
reincidência.

**A varredura foi validada de verdade:** o bug foi reintroduzido de propósito
(o teste acusou) e removido (o teste voltou a passar). Uma varredura que nunca
foi vista falhando não prova nada.

---

## A segunda falha (nº 11): não havia como diagnosticar

`statusTrackingNativo` era exposto pelo `DownwindContext` e **nunca renderizado
em lugar nenhum**. Consequência prática: quando o rastreio nativo não ligava,
nem o dono nem um agente conseguiam saber onde parava — se não era app nativo,
se `decidirTracking()` dava `false`, se o token falhava, se o plugin rejeitava,
ou se o serviço subia e morria depois.

Sem cabo USB e sem `logcat`, **um agente não tem nenhuma visibilidade do
aparelho**. Estávamos os dois adivinhando.

Agora a faixa de status do downwind mostra em que ponto o rastreio está e,
quando não liga, **qual condição barrou** (sessão, status do downwind, papel,
estado da participação). Mesma escolha já adotada para o diagnóstico do FCM.

> É o mesmo padrão de defeito de `latestIncomingDm`, encontrado antes nesta
> mesma base: valor exposto no contexto, populado corretamente, e sem nenhum
> consumidor. Vale como checagem de rotina — expor no contexto não é o mesmo
> que entregar ao usuário.

---

## Decisão de arquitetura que vale preservar (hipótese nº 6)

**Não pedir `ACCESS_BACKGROUND_LOCATION`, de propósito.**

Essa permissão dispara, desde o Android 11, um processo de revisão especial do
Google: formulário de declaração, vídeo demonstrando o uso e justificativa. É
lento e é motivo comum de rejeição na Play Store.

E ela **não é necessária** aqui: um Foreground Service com
`foregroundServiceType="location"` **iniciado enquanto o app está em primeiro
plano** continua recebendo localização depois que o app é fechado, usando só
`ACCESS_FINE_LOCATION`. Isso encaixa no fluxo real do downwind, porque o
velejador **sempre** abre o app para entrar na travessia.

Se alguém no futuro "resolver um problema" adicionando essa permissão, estará
trocando um ganho nulo por um risco real de rejeição.

---

## O que ainda está em aberto

### 1. O APK testado tem mesmo o serviço nativo? (hipótese 12)

**Esta é a pergunta que mais muda o diagnóstico.** O serviço nativo entrou na
`main` só no merge de 25/08. Um APK buildado antes disso não tem o serviço —
e nenhuma correção no servidor mudaria o resultado do teste.

### 2. Fabricantes agressivos (hipótese 13)

Xiaomi, Huawei, Oppo, Vivo e Samsung matam serviços em segundo plano de forma
muito mais agressiva que o Android puro, **mesmo Foreground Service**. É a
causa clássica de "funciona no Pixel, não funciona no Xiaomi" — e boa parte do
público de kite no Brasil usa exatamente esses aparelhos.

Mitigação: pedir isenção de otimização de bateria e instruir o usuário a
colocar o app em "Sem restrições". Ainda não implementado.

### 3. Falha menor achada de passagem — corrigida, e a lição vale mais que ela

`lib/trackingToken.ts`: `revogarTodosTokensDoDownwind`, `revogarTokensDoUsuario`
e `limparTokensExpirados` faziam `UPDATE`/`DELETE` **sem `RETURNING`** e
devolviam `result.length` — que nesse caso é **sempre 0**, porque o driver do
Neon devolve array vazio quando não há `RETURNING`. A operação acontecia de
verdade; só a contagem mentia. Corrigido com `RETURNING id` nas três.

**A lição:** `lib/trackingToken.test.ts` tinha testes verdes afirmando
exatamente o contrato quebrado —

```ts
sqlMock.mockResolvedValueOnce([{ id: '1' }, { id: '2' }]);
await expect(revogarTodosTokensDoDownwind('downwind-1')).resolves.toBe(2);
```

O mock devolve linhas que a query real nunca devolveria. **Teste mockado
verde não prova comportamento de banco** — prova só que o código lê o que o
mock entrega. É o mesmo tipo de confiança falsa que deixou o bug nº 10 passar
por build, typecheck e 727 testes.

Onde o comportamento importa de verdade, o projeto já tem a ferramenta certa:
`scripts/verify-sql.ts`, que roda contra Postgres real (PGlite).

---

## Como validar no aparelho (o teste que fecha a questão)

Com um APK buildado **a partir da `main` atual**:

1. Entrar num downwind e iniciar a travessia.
2. **Ler a faixa de status na tela do downwind.** Ela agora diz uma de três
   coisas, e cada uma leva a um caminho diferente:
   - *"Serviço nativo iniciado…"* → procurar a notificação **"Rastreando
     downwind"** na barra de status. Se ela aparece, o serviço está de pé.
   - *"Rastreio nativo não deve ligar agora: …"* → a frase nomeia a condição
     que barrou. Não é preciso adivinhar.
   - *"Falha ao iniciar o serviço nativo: …"* → traz o erro do plugin.
3. Apagar a tela. Acompanhar as posições em outro aparelho por vários minutos.
4. Minimizar o app. Idem.
5. Remover dos recentes. Idem — este é o teste que só o serviço nativo passa.
6. Encerrar a travessia e confirmar que a notificação some e o serviço para.

> Forçar parada nas configurações do Android sempre mata o serviço. Isso é
> limitação da plataforma, não defeito do app.

## Documentos relacionados

- `docs/PLANO-RASTREIO-BACKGROUND-ANDROID.md` — o plano de arquitetura
  (Foreground Service, token escopado, ponte FCM).
- `docs/RASTREIO-BACKGROUND-ANDROID-LIMITACOES.md` — limitações de plataforma.
- `docs/ANTIGRAVITY-FINDINGS.md` — ANT-003, o achado original de auditoria.
- `docs/CONFIGURACAO-SEGREDOS.md` — segredos que precisam existir para o FCM.
