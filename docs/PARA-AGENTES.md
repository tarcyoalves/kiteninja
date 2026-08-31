# Leia isto antes de mexer no KiteNinja

Guia curto para quem chega neste repositório. Não repete o que está no
`AGENTS.md` (que trata do Next.js) — trata do que **já deu errado aqui** e de
como não repetir.

## 1. Verificação verde não é prova de nada

Os quatro comandos abaixo rodam depois de **toda** mudança:

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node node_modules/tsx/dist/cli.mjs scripts/verify-sql.ts
node node_modules/tsx/dist/cli.mjs scripts/verify-sos.ts
npx eslint .
DATABASE_URL='postgresql://ci:ci@localhost:5432/ci?sslmode=disable' npx next build
```

E ainda assim: **três bugs graves passaram por todos eles, verdes.**

| Bug | Sintoma real | O que passou verde |
|---|---|---|
| Mapa ao vivo (`/live`) consultava 6 colunas inexistentes | 500 para todo mundo, sempre — a tela nunca funcionou | build, tsc, 793 testes, 272 checks SQL, lint |
| Downwind privado invisível — não havia `GET /api/downwind` | quem criava não via o que criou | idem |
| Agenda ordenada por texto em português | eventos fora de ordem | idem |

O que os três têm em comum: **nenhum era código errado que falha.** Eram
código que nunca foi exercido, funcionalidade que nunca existiu, e ordenação
que ninguém conferiu. Verificação estática não faz essas perguntas.

## 2. Sonde a produção

Os três foram encontrados assim, não por varredura de código:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://kiteninja.vercel.app/api/<rota>
```

Um `500` onde deveria haver `404`, um `405` onde deveria haver uma lista. Dois
minutos de `curl` acharam o que semanas de teste verde não acharam.

**Faça isso ao mexer em qualquer rota.** As verificações locais respondem *"o
código é coerente consigo mesmo"*. Só o ambiente real responde *"isto
funciona"*.

## 3. As travas automáticas que existem — e por que

Não as contorne. Cada uma nasceu de um bug real que chegou em produção.

| Trava | Pega |
|---|---|
| `scripts/verify-sql.ts` → varredura de esquema | Todo `` sql`` `` de `app/api` roda `EXPLAIN` contra Postgres real. Coluna ou tabela inexistente falha aqui. Rota nova entra na cobertura **por existir**. |
| `lib/contextoConsumido.test.ts` | Campo exposto num contexto que nenhuma tela desestrutura de `useKiteData()`. Esta classe já apareceu **quatro vezes**. |
| `lib/sqlComposicao.test.ts` | `` ${sql`...`} `` aninhado. O driver HTTP da Neon **não compõe fragmentos** — o `sql` interno vira um *valor de parâmetro*, não SQL. |
| `lib/authz.test.ts` | Rota de mutação sem justificativa registrada. |

## 4. Armadilhas específicas desta base

**O driver da Neon não compõe SQL.** `${sql\`DEFAULT\`}` vira um objeto como
parâmetro. Precisa de duas queries completas escolhidas em JavaScript. Já
quebrou o registro de posição inteiro.

**`UPDATE`/`DELETE` sem `RETURNING` devolvem `[]`.** `result.length` é sempre
0. Se você precisa saber quantas linhas mudaram, use `RETURNING id`.

**O `CHECK` de `notifications.type` está em dois lugares** em `schema.sql`: o
inline e um bloco `DO $` mais abaixo que o sobrescreve. Mudar só o primeiro
não tem efeito nenhum.

**Backtick dentro de template literal fecha o template.** Não use crases em
comentários SQL dentro de `` sql`...` ``.

## 5. Convenções

**A decisão que pode quebrar mora numa função pura e testada**; o hook, a
rota ou o componente é a casca fina em volta. Exemplos:
`lib/cinematicaTrilha.ts`, `lib/dataEvento.ts`, `lib/downwindAcesso.ts`,
`lib/sosCandidates.ts` (`mesclarCamadas`).

**Teste mockado dá falsa confiança.** `lib/trackingToken.test.ts` afirmava
"devolve a contagem" com um mock que devolvia linhas que a query real nunca
devolveria. Quando a verdade está no banco, o teste vai em
`scripts/verify-*.ts`, contra Postgres de verdade.

**Verifique que o teste falha.** Reintroduza o bug e veja o teste ficar
vermelho. Um teste que nunca falhou não provou nada — a primeira versão de
`contextoConsumido.test.ts` passava com o defeito presente, e só foi
descoberto porque isso foi testado nas duas direções.

**React 19** roda as regras do compilador. Ver
`docs/REACT19-REGRAS-COMPILADOR.md`: ajuste síncrono de estado vai para o
render (`lib/useAoMudar.ts`, cuidado com `naMontagem` e com chave que precisa
ser primitiva), valor só do navegador vai para `useSyncExternalStore`,
componente nunca é definido dentro de outro componente.

## 6. Fluxo de git

Desenvolver em `main`, e espelhar na branch designada:

```bash
git push -u origin main
git checkout <branch-designada> && git merge --ff-only main && git push
git checkout main
```

⚠️ **A branch default do repositório no GitHub é `master`**, parada muito
atrás e sem os workflows. A Vercel faz deploy de `main` (verificado por
sondagem), mas **workflows com `schedule:` só disparam na branch default** —
é por isso que `cron-varredura.yml` nunca rodou, e a escalada de SOS e o
alerta de silêncio de downwind estão inertes. Trocar a default para `main` é
decisão do dono.

## 7. O que está aberto e depende do dono

- **Branch default → `main`** (acima). Destrava a varredura de 5 em 5 minutos.
- **Teste de rastreio num Android real.** O CI publica o APK de debug como
  artefato a cada push; o banner de diagnóstico na tela diz onde o fluxo para.

## Índice dos documentos

| Arquivo | Assunto |
|---|---|
| `BUG-MAPA-AO-VIVO-500.md` | A rota `/live` contra um schema que não existia |
| `BUG-DOWNWIND-INVISIVEL.md` | Downwind que ninguém via + a trava de contexto órfão |
| `REACT19-REGRAS-COMPILADOR.md` | As cinco classes de defeito do React 19 |
| `VARREDURA-2026-08-31.md` | Varredura de falhas + o CI vermelho por motivo próprio |
| `ANTIGRAVITY-STATUS.md` | Situação por achado da auditoria (ANT-001 fechado) |
| `CONFIGURACAO-SEGREDOS.md` | Passo a passo dos segredos |
| `INVESTIGACAO-RASTREIO-BACKGROUND.md` | Rastreio com o app fechado no Android |
