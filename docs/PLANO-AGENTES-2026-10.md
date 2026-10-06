# Plano de melhorias — para agentes executarem

Auditoria de 05/10/2026. Cada tarefa abaixo é **autocontida**: um agente sem
contexto nenhum desta conversa deve conseguir executá-la lendo só este arquivo
e o código. Todas as evidências citadas foram **medidas**, não deduzidas — o
comando ou a saída real está junto.

> **Leia a seção 0 inteira antes de qualquer tarefa.** As regras ali custaram
> caro para aprender; a maioria virou bug em produção antes de virar regra.

---

## Já feito nesta auditoria (não refazer)

| Commit | O quê |
|---|---|
| `671e52e` | Redefinição de senha: cinco defeitos provados com as rotas reais — ver `docs/REDEFINIR-SENHA-NAO-PRESTOU.md` |
| `5ec6998` | Next 16.3.1 → 16.3.8 (três alertas **críticos** de execução remota de código) |
| `34344ed` | Painel admin testado função por função contra Postgres; conta suspensa não entra mais; id inválido dá 400 e não 500 |

Também nasceu a ferramenta que a seção 0 manda usar:
**`test/rotasComPglite.ts`** — roda rotas reais do App Router contra um Postgres
em memória com o `lib/schema.sql` de produção, com cookie de sessão real.

---

## Painel

| ID | Prio | Tarefa | Esforço | Quem | Estado |
|---|---|---|---|---|---|
| T01 | 🔴 P0 | Escalada do SOS roda a cada 3–6 h, não a cada 5 min | M | agente + dono | ✅ `a928a56` — T01b: ver aviso do Neon abaixo |
| T02 | 🔴 P0 | CI vermelho: job Android quebrou com a depreciação do Node 20 | P | agente | ⏳ `5ee5317` — CI ainda não validou (falha de runner do GitHub) |
| T03 | 🔴 P0 | Projeto Vercel duplicado (`kiteninja1`): 6 builds por commit e 2ª "produção" no ar | P | **dono** | ⬜ dono |
| T04 | 🟠 P1 | Posições do link de apoio em terra guardadas para sempre | P | agente | ✅ `994ea33` |
| T05 | 🟠 P1 | Nenhum cabeçalho de segurança HTTP | P | agente | ✅ `6343780` + `305f78b` |
| T06 | 🟠 P1 | 3 vulnerabilidades altas + 6 moderadas em dependências | P–M | agente | ⬜ |
| T07 | 🟠 P1 | Ações do admin não deixam rastro (`audit_logs` só no SOS) | M | agente | ✅ `e907b17` |
| T08 | 🟠 P1 | Recuperação de senha por e-mail não existe | M | dono + agente | ⬜ dono primeiro |
| T09 | 🟡 P2 | Painel admin: polling de 12 s que não pausa, apaga erros e mantém o banco acordado | P | agente | ✅ `3bc716d` |
| T10 | 🟡 P2 | Painel admin: falhas engolidas em silêncio (Erros, Convites) | P | agente | ✅ `ee56790` |
| T11 | 🟡 P2 | Downwind: "terceira porta" é código morto (decisão do dono) | M | dono decide → agente | ⬜ dono decide |
| T12 | 🟡 P2 | Sessões expiradas nunca são apagadas | P | agente | ✅ `e8fbfbc` |
| T13 | 🔵 P3 | Trocar guardas de texto por testes de comportamento nos fluxos críticos | M | agente | ⬜ |
| T14 | 🔵 P3 | 96 variáveis não usadas + 32 `<img>` (lint) | P | agente | ⬜ |
| T15 | 🔵 P3 | `data/mockSpots` é o catálogo real — nome engana | P | agente | ✅ `91e1f42` |
| T16 | 🔵 P3 | Domínio `app.kiteninja.ct.ws` pendente de verificação desde a criação | P | **dono** | ⬜ dono |
| T17 | ⚪ P4 | `KiteDataContext.tsx` com 1.547 linhas | G | agente, só depois de T13 | ⬜ |

Prioridade: 🔴 alguém pode se machucar ou a casa está pegando fogo ·
🟠 segurança/privacidade/dado · 🟡 o dono ou o velejador sentem ·
🔵 qualidade · ⚪ só com tempo sobrando.

---

## 0. Regras para o agente

### 0.1 Reproduza antes de corrigir. Não deduza.

Nesta base, **quatro rodadas seguidas** de correção do downwind foram feitas
deduzindo a causa lendo o código — as quatro eram defeitos reais, e nenhuma
era a que o dono estava vivendo. A causa só apareceu com evidência: logs de
produção e um print. A redefinição de senha repetiu a lição: o caminho feliz
funcionava, o caminho real quebrava em cinco pontos.

Antes de corrigir qualquer coisa: **faça o defeito acontecer num teste**.
Para rota/banco, use `test/rotasComPglite.ts`:

```ts
import { beforeAll, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', async () => (await import('@/test/rotasComPglite')).dbMock);
vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);
import { prepararBanco, criarUsuario, logarComo, req, params, ler } from '@/test/rotasComPglite';

beforeAll(prepararBanco, 60_000);

it('...', async () => {
  const admin = await criarUsuario({ role: 'admin' });
  await logarComo(admin);                       // cookie fica no "navegador"
  const { PATCH } = await import('@/app/api/admin/users/[id]/route');
  const r = await ler(await PATCH(req('PATCH', `/api/admin/users/${id}`, { role: 'rider' }), params({ id })));
  expect(r.status).toBe(200);
});
```

Exemplos completos: `lib/painelAdminFluxo.test.ts`, `lib/redefinirSenhaFluxo.test.ts`.

### 0.2 Todo teste novo passa por contraprova

Desfaça a correção, rode o teste, **veja ficar vermelho**, restaure. Teste que
passa com o defeito de volta não é teste. Nesta base, guardas de texto
passaram com o defeito de volta **três vezes**, sempre do mesmo jeito: a
asserção procurava o nome de uma função, e a declaração da função continuava
no arquivo mesmo com a chamada removida.

Ao aplicar a contraprova, **confira que a âncora é única**. Uma contraprova
"verde" nesta auditoria era falsa: `const token = newToken();` existe três
vezes em `lib/auth.ts`, e o patch caiu em `createSession`, não no token de
senha.

### 0.3 Armadilhas desta base

- **Comentário SQL dentro de `` sql`...` ``** não pode conter `${` (vira
  parâmetro fantasma, erro 42P18 em produção) nem crase (encerra o template).
  `npx tsx scripts/verify-sql.ts` pega as duas.
- **Driver HTTP do Neon não compõe fragmentos SQL.** Para variar a consulta,
  escreva duas consultas inteiras (`cond ? sql\`...\` : sql\`...\``).
- **Finais de linha mistos (CRLF e LF).** Reescrever um arquivo CRLF com LF
  gera diff do arquivo inteiro. Preserve o que o arquivo já usa — confira com
  `git diff --stat` antes de commitar.
- **React Compiler ativo no lint:** nada de `setState` síncrono no corpo de
  efeito (padrão da base: IIFE assíncrona com flag `cancelado`, ou
  `lib/useAoMudar.ts` para ajuste durante o render); `ref.current` não se lê
  nem escreve durante o render (escreva em `useLayoutEffect`).
- **`next` aqui não é o que você conhece** (ver `AGENTS.md`): leia
  `node_modules/next/dist/docs/` antes de usar API do framework.
- **Comentários desta base explicam o porquê, com o bug que motivou.**
  Mantenha o padrão — e, se mudar o comportamento, mude o comentário; um
  comentário que contradiz o código abaixo dele já aconteceu aqui.

### 0.4 Verificação obrigatória antes de commitar

```bash
npm ci                                   # contêiner novo não tem node_modules
npx tsc --noEmit
npx eslint .                             # 0 erros (há ~140 avisos antigos; não aumente)
npx vitest run
npx tsx scripts/verify-sql.ts            # 319+ passaram, 0 falharam
npx tsx scripts/verify-sos.ts            # 59+ passaram, 0 falharam
DATABASE_URL="postgres://u:p@localhost/db" SKIP_MIGRATIONS=1 npx next build ; echo "exit=$?"
```

O build imprime `NeonDbError ... ECONNREFUSED` na coleta de páginas estáticas
— é o banco de mentira, normal. O que vale é `exit=0`.

### 0.5 O que nunca fazer sem o dono

- Mexer em variável de ambiente da Vercel, chaves VAPID (regenerar invalida
  todas as inscrições de push), keystore do Android, `google-services.json`,
  conta de serviço do Firebase.
- Apagar projeto, domínio ou dado de produção.
- Mudar comportamento fora do escopo da tarefa sem dizer. Regra do dono:
  *"Cuidado para não quebrar outras funcionalidades ao mexer em algo."*

### 0.6 Planos gratuitos — Neon, Vercel, GitHub

O app roda inteiro em plano gratuito. Toda mudança respeita isto:

- **Vercel Hobby.** Cada push vira deploy — hoje **seis por commit** (dois
  projetos × três branches, ver T03). Agente **não faz push**: commita no
  próprio worktree e quem orquestra junta tudo num push só. Crons do
  `vercel.json` só rodam uma vez por dia neste plano; não crie cron novo lá.
- **Neon Free.** 0,5 GB de armazenamento e computação limitada; o banco
  hiberna quando ninguém o usa. Então: nenhum polling novo; consulta nova em
  rota chamada com frequência tem que ser barata e usar índice; tabela nova que
  cresce precisa nascer com expurgo; nada de manter o banco acordado. Agente
  não tem acesso ao banco de produção e não pede.
- **GitHub Free.** O CI roda em push na `main`, e os minutos de Actions são
  contados. Não dispare workflow à mão, não crie workflow agendado novo, não
  encurte o intervalo dos que existem.
- **Nenhum serviço pago novo, nenhuma dependência nova** sem necessidade
  provada. Se a tarefa parecer exigir, pare e registre para o dono decidir.

### 0.7 Diário

Toda tarefa termina com uma entrada de diário — ver
`docs/DIARIO-DE-PROGRESSO.md`. Agente em paralelo cria
`docs/diario/AAAA-MM-DD-<tarefa>.md` e **não** edita o diário principal, este
plano nem `docs/PARA-AGENTES.md` (quem orquestra consolida; três agentes no
mesmo arquivo geram conflito).

### 0.8 Entrega

Um commit por tarefa, mensagem em português dizendo **por quê** (o defeito, a
evidência, a correção, a contraprova). Atualize `docs/PARA-AGENTES.md` quando
criar doc. Marque a tarefa como feita no painel acima, com o hash do commit.

---

## T01 🔴 Escalada do SOS roda a cada 3–6 horas

**Problema.** A escalada amplia o raio de um pedido de socorro sem resposta:
5 km → 15 km → 50 km, a cada 2 minutos. Ela depende de alguém chamar
`/api/cron/sos-escalada`. O `vercel.json` agenda uma vez por dia (limite do
plano Hobby), e o workflow do GitHub Actions configurado para `*/5 * * * *`
roda quando o GitHub quer. Medido em 05/10/2026 pela API do GitHub:

```
04/10  00:36  06:19  12:34  17:01  20:03  23:02
05/10  01:52  07:58  17:04
```

Um SOS disparado às 17h05 de 05/10 teria a primeira ampliação depois da
meia-noite. Na água, é o mesmo que não ter escalada. O problema já estava
documentado em `docs/CRON-EXTERNO-SOS.md` em setembro e segue igual.

**Duas partes, faça as duas:**

**T01a — carona no polling (agente, sem serviço externo).** Todo cliente com o
app aberto chama `GET /api/sos/active` a cada 12 s
(`context/KiteDataContext.tsx`, ~linha 1389). Faça essa rota disparar
`varrerEscaladas()` (`lib/sosEscalada.ts`) **no máximo uma vez por minuto no
app inteiro**, com uma trava atômica no banco — por exemplo uma linha em
`app_settings` e:

```sql
UPDATE app_settings SET valor = NOW()::text
WHERE chave = 'sos_ultima_varredura' AND valor::timestamptz < NOW() - INTERVAL '60 seconds'
RETURNING 1
```

Só quem recebeu a linha de volta roda a varredura, e **sem bloquear a resposta**
do polling (`void varrerEscaladas().catch(...)`, com o erro indo para
`lib/observabilidade.ts`). Confira o schema real de `app_settings` antes;
adapte os nomes de coluna. Com isso, sempre que houver alguém com o app aberto
a escalada anda — inclusive quem está esperando socorro, que é justamente
quem tem o app aberto.

> ⚠️ **Correção de 05/10, depois da execução:** o Agente A conferiu os limites
> do Neon gratuito — o banco hiberna após 5 min parado e a computação gratuita é
> limitada por mês. Um agendador a cada 1 minuto (ou qualquer intervalo abaixo
> de 5 min) mantém o banco acordado o tempo todo e esgota a cota no meio do
> mês, derrubando o app inteiro, SOS incluso. **Não use 1 minuto.** O T01a
> (carona no polling) já cobre o caso de alguém com o app aberto, sem custo
> extra. As opções, com as contas, estão em `docs/CRON-EXTERNO-SOS.md`.

**T01b — agendador externo (dono, com o agente guiando).** cron-job.org
(gratuito; intervalo: ver o aviso acima) chamando
`https://kiteninja.vercel.app/api/cron/sos-escalada` e
`.../api/cron/downwind-silencio` com o cabeçalho que a rota exige (leia
`app/api/cron/sos-escalada/route.ts` para o nome exato — é o `CRON_SECRET`).
O agente escreve o passo a passo em `docs/CRON-EXTERNO-SOS.md`; o dono cria a
conta e cola o segredo (o agente **nunca** pede nem manipula o valor).

**T01c — o dono precisa VER se está vivo.** No painel admin, mostre "última
varredura do SOS: há X min" (a mesma linha de `app_settings`). Acima de 10 min,
em vermelho. Hoje não há como o dono saber que a escalada está parada.

**Aceite.**
- Teste com `test/rotasComPglite.ts`: SOS criado há 3 min sem resposta; duas
  chamadas a `/api/sos/active` em sequência → o raio sobe **uma** vez, não duas.
- Contraprova: remova a trava → o teste de "uma vez só" fica vermelho.
- `verify-sos.ts` segue 59/0.

**Não fazer.** Não reduza a janela da trava abaixo de 60 s (cada varredura
manda push). Não bloqueie a resposta do polling esperando a varredura.

---

## T02 🔴 CI vermelho: job Android

**Problema.** O CI de `671e52e` (05/10) falhou só no job **Android Debug**, na
etapa **Setup Android SDK**. Todas as etapas de código passaram (SQL, Lint,
Testes, TypeScript, Build). Último CI verde: 11/09. As anotações do run
explicam a mudança de ambiente no meio:

```
warning: Node.js 20 is deprecated. The following actions target Node.js 20 but are being
  forced to run on Node.js 24: actions/checkout@v4, actions/setup-java@v4,
  actions/setup-node@v4, android-actions/setup-android@v2.
warning: setup-java v4 is deprecated ... migrate to actions/setup-java@v5.
notice: The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026.
```

Não é do código: vai falhar em qualquer commit, inclusive no anterior.

**Arquivo.** `.github/workflows/ci.yml` (etapa em ~linha 207).

**Fazer.**
1. Confirme no GitHub qual é a versão principal atual de
   `android-actions/setup-android` e de `actions/setup-java` (releases do
   repositório de cada action). Não chute.
2. Suba `android-actions/setup-android@v2` para a atual; `actions/setup-java@v4`
   para `@v5`. Aproveite e suba `checkout`, `setup-node`, `cache`,
   `upload-artifact` para as versões que rodam em Node 24.
3. Se a nova `setup-android` ainda falhar: o runner `ubuntu-latest` já traz o
   Android SDK com `ANDROID_HOME` definido — dá para remover a etapa e manter o
   `Create local.properties`. Teste nessa ordem.
4. Fixe o runner em `ubuntu-24.04` em vez de `ubuntu-latest`, para a migração
   de 19/10 não quebrar o CI de novo sem aviso.

**Aceite.** CI verde em `main` com todos os jobs, incluindo Android Debug.

**Não fazer.** Não marque o job como `continue-on-error`, não remova o job.

---

## T03 🔴 Projeto Vercel duplicado — ação do DONO

**Problema.** Dois projetos Vercel apontam para o mesmo repositório:
`kiteninja` (o de verdade, domínio `kiteninja.vercel.app`) e `kiteninja1`
(`kiteninja1.vercel.app`). Pela API da Vercel, `kiteninja1` faz deploy de
**todo** commit, três vezes (`main` como produção, `master` e
`claude/esta-ai-0jn09l`) — somado ao projeto real, **6 builds por commit**.

Riscos além do desperdício:
- uma segunda "produção" no ar, que alguém pode receber por link e usar com
  variáveis de ambiente diferentes (push quebrado, por exemplo);
- se ela tiver `DATABASE_URL` do mesmo banco, roda `scripts/migrate-on-build.ts`
  contra produção **em paralelo** com o projeto real a cada commit;
- os crons do `vercel.json` rodam nos dois.

**Fazer (dono).** Vercel → projeto `kiteninja1` → Settings → apagar o projeto.
Antes, confira que ninguém usa `kiteninja1.vercel.app`.

**Opcional (dono).** Fazer push só em `main`. Os pushes em `master` e na branch
`claude/...` geram dois deploys de preview por commit em cada projeto.

---

## T04 🟠 Posições do link de apoio em terra guardadas para sempre

**Problema.** O link de apoio do velejo solo grava uma posição a cada 45 s em
`velejo_apoio_posicoes` (`app/api/velejo-apoio/posicoes/route.ts`, INSERT na
linha ~65). Não existe nenhum `DELETE` nessa tabela nem em
`velejo_apoio_sessoes` no código. O link vale 12 h; o rastro de onde a pessoa
esteve fica para sempre. É dado de localização de gente real, e o Neon
gratuito tem 0,5 GB.

Compare com o downwind, que resume e apaga a trilha bruta ao encerrar
(`resumirEPurgar` em `lib/downwindDb.ts`).

**Fazer.** Expurgo preguiçoso, no mesmo estilo do de `rate_limit_tentativas`
(`lib/rateLimit.ts`, "Expurgo preguiçoso"): no máximo uma vez por hora por
instância, sem bloquear a resposta, apagar as posições de sessões cuja
validade terminou há mais de 24 h. Leia `lib/apoioSolo.ts` e o schema de
`velejo_apoio_sessoes` para saber qual coluna marca a validade.

**Aceite.** Teste com `test/rotasComPglite.ts`: sessão expirada há 25 h tem
as posições apagadas; sessão ativa mantém as dela. Contraprova: tire o
filtro de validade → a ativa perde as posições e o teste fica vermelho.

---

## T05 🟠 Nenhum cabeçalho de segurança HTTP

**Problema.** `next.config.ts` não define `headers()`. Sem `X-Frame-Options`
nem `frame-ancestors`, o painel `/admin` pode ser carregado dentro de um
iframe de outro site (clickjacking: induzir o admin a tocar "Suspender" ou
"Nova senha"). O app também carrega tokens na URL —
`/recuperar-senha/<token>`, `/convite/<token>`, `/velejo-apoio/<token>`,
`/dw-motorista/<token>` — e hoje depende do padrão do navegador para não
vazá-los no `Referer`.

**Fazer.** Em `next.config.ts`, `async headers()` para todas as rotas:

- `X-Frame-Options: DENY` e `Content-Security-Policy: frame-ancestors 'none'`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`

**Não** coloque `script-src`/`img-src` nesta tarefa: o app carrega tiles de
mapa, fontes, imagens do Blob e roda dentro do WebView do Capacitor — uma CSP
completa precisa de inventário próprio e quebra coisas em silêncio. Leia a doc
de `headers` em `node_modules/next/dist/docs/` antes.

**Aceite.** `curl -sI` num build local (`next start`) mostra os cabeçalhos.
Confira que `/dw-live/<id>` (o "Telão") não é embutido em iframe por nenhuma
tela do próprio app (`grep -rn "<iframe" app components views`).

---

## T06 🟠 Vulnerabilidades em dependências

**Estado em 05/10 depois da atualização do Next** (`npm audit --omit=dev`):
0 críticas, **3 altas**, 6 moderadas. Origem:

| Pacote | Grau | Chega por |
|---|---|---|
| `@grpc/grpc-js` | alta | `firebase-admin` |
| `undici` | alta | dependência transitiva |
| `sharp` | alta | `next` (libheif) |
| `brace-expansion` | alta | transitiva |
| `@google-cloud/storage`, `gaxios`, `uuid`, `teeny-request`, `retry-request` | moderada | `firebase-admin` |

**Fazer.**
1. `npm audit fix` **sem** `--force`. Rode a verificação completa (0.4).
2. Para o que sobrar: veja se há versão nova de `firebase-admin` que resolva
   (`npm view firebase-admin versions`). Se for versão principal nova, leia o
   changelog — ele é usado em `lib/push.ts` para FCM.
3. O que não tiver correção sem quebra: registre em
   `docs/DEPENDENCIAS-ALERTAS.md` com o motivo e a exposição real.

**Aceite.** Altas zeradas, ou cada uma restante explicada no doc.

---

## T07 🟠 Ações do admin não deixam rastro

**Problema.** Existe a tabela `audit_logs`, mas só `app/api/sos/route.ts` e
`app/api/sos/[id]/route.ts` escrevem nela. **Nenhuma das 10 rotas admin**
registra nada. Suspender alguém, promover a admin, gerar link de nova senha,
revogar convite, mexer em chamado — nada fica registrado. Se uma conta de
admin for usada por outra pessoa, não há como saber o que foi feito.

**Fazer.**
1. Leia o schema de `audit_logs` e como as rotas de SOS escrevem nela.
2. Crie em `lib/` uma função única `registrarAcaoAdmin(adminId, acao, alvoId,
   detalhes)` e chame nas rotas: `users/[id]` (papel, ativo, troca exigida),
   `users/[id]/senha` (gerou link — **nunca** grave o token nem a URL),
   `invites` (criou), `invites/[id]` (revogou), `chamados/[id]` (status).
3. Falha ao registrar **não** pode impedir a ação — mesmo padrão de silêncio
   de `lib/observabilidade.ts`.
4. Uma aba simples no painel listando as últimas 100 ações.

**Aceite.** Em `lib/painelAdminFluxo.test.ts`: suspender gera uma linha com
admin, alvo e ação; gerar link gera linha **sem** o token (procure o token no
JSON da linha e espere não achar). Contraprova: tire a chamada de uma rota →
vermelho.

---

## T08 🟠 Recuperação de senha por e-mail

**Problema.** Não há envio de e-mail no projeto. Desde `671e52e` a tela
"Esqueci minha senha" diz a verdade (a recuperação é pelo administrador) e
não chama a rota — antes ela prometia "Instruções enviadas!" e, pior, matava
o link que o admin tinha mandado. Ver `docs/REDEFINIR-SENHA-NAO-PRESTOU.md`.

O autoatendimento continua sendo o que um app precisa.

**Dono:** criar conta num serviço de envio (Resend tem plano gratuito),
verificar um domínio próprio (o `app.kiteninja.ct.ws` está pendente — ver T16)
e cadastrar a chave como variável de ambiente na Vercel. O agente não faz
nenhum desses passos.

**Agente, depois da chave existir:**
1. `lib/email.ts` com uma função de envio; sem a variável, ela não envia e
   devolve `false` (nada quebra em ambiente sem chave).
2. `app/api/auth/recover-password/route.ts` envia o link quando a função existe.
   Resposta continua uniforme (não revelar se o e-mail existe).
3. `app/recuperar-senha/page.tsx` volta a ter o formulário **só quando o envio
   está configurado**; sem ele, mantém o texto atual.

**Aceite.** Teste com `test/rotasComPglite.ts` e envio simulado: o link
recebido funciona; **e** um link gerado antes pelo admin continua funcionando
depois do pedido por e-mail (o cenário D de `lib/redefinirSenhaFluxo.test.ts`
tem que seguir verde).

---

## T09 🟡 Painel admin: polling que não pausa

**Problema** (`app/admin/UserManager.tsx`, ~linhas 118 e 170):

- `setInterval` de **12 s** chamando `/api/admin/users`, que faz **3 consultas**,
  incluindo `COUNT(*)` em `chat_messages`, `posts` e `sessions_log` inteiras e
  contagens correlacionadas por usuário.
- Não pausa quando a aba fica em segundo plano. `ChatView` e
  `UpdateNotificationBanner` pausam (`document.hidden`); copie o padrão deles.
  Painel aberto esquecido = banco que nunca hiberna. (O polling de SOS em
  `KiteDataContext` também não pausa — mas lá é defensável: é socorro, e é
  nele que a T01a pega carona. Não mexa nele nesta tarefa.)
- `const [autoRefresh, setAutoRefresh]` — `setAutoRefresh` nunca é usado (o
  próprio lint acusa). Não há como desligar.
- Cada recarga chama `setError(null)`: a mensagem de erro de uma ação some em
  até 12 s, antes de o admin ler.

**Fazer.** Pausar com a aba oculta (padrão de `components/UpdateNotificationBanner.tsx`);
intervalo de 60 s; botão visível para ligar/desligar; recarga de fundo não
mexe no erro de ação. Opcional: estatísticas só na carga e no botão de
atualizar, não no polling.

**Aceite.** Lint sem o aviso de `setAutoRefresh`. Teste manual descrito no
commit (abrir, trocar de aba, voltar).

---

## T10 🟡 Painel admin: falhas engolidas

- `app/admin/ErrosManager.tsx` ~linha 95: marcar erro como resolvido faz
  `fetch(...).catch(() => {})` — se falhar, o admin não sabe e o erro volta na
  próxima carga como se nada tivesse acontecido.
- Revise do mesmo jeito `InviteManager.tsx`, `ChamadosManager.tsx` e
  `IntroVideoManager.tsx`: toda ação que pode falhar mostra a falha **perto de
  onde foi tocada** (no celular, mensagem no topo da página fica fora da tela —
  foi um dos defeitos da redefinição de senha).

**Aceite.** Nenhum `.catch(() => {})` em ação disparada pelo usuário no
`app/admin/`. `grep -rn "catch(() => {})" app/admin` vazio ou cada ocorrência
justificada em comentário.

---

## T11 🟡 Downwind: "terceira porta" é código morto — DONO DECIDE

**Problema.** `mapaMostraDownwind` (`lib/activity.ts`) tem uma porta
documentada para quem já encerrou o próprio velejo reabrir a tela do downwind
a pedido. Ela nunca dispara: `GET /api/downwind/ativo` só devolve downwind para
quem está em `confirmado` ou `navegando`, então quem encerrou nunca tem
downwind ativo.

Em setembro isso foi contornado deixando `encerrado` voltar para `confirmado`
ao tocar "entrar". O contorno tem custo: **quem reentra volta a contar no
quórum** e trava o encerramento do grupo; e para destravar precisa "sair", o
que grava `desistiu` por cima de quem completou a travessia.

**Opções para o dono:**
- **A (recomendada):** `/api/downwind/ativo` serve participante em qualquer
  estado enquanto o downwind estiver aberto ou em andamento; a porta passa a
  funcionar como projetada (não toma a tela sozinha, abre a pedido); o beacon
  só liga para quem está `navegando`/`confirmado`. O contorno de `encerrado →
  confirmado` pode ser mantido só para quem quer **voltar para a água**.
- **B:** deixar como está.

**Agente, se o dono escolher A:** leia `docs/ESPECTADOR-DE-DOWNWIND.md` e
`lib/entrarNoDownwind.test.ts` inteiros antes. Os testes de lá contam a
história de quatro correções seguidas nesse fluxo — todos têm que seguir
verdes.

---

## T12 🟡 Sessões expiradas nunca são apagadas

`auth_sessions` só perde linhas em logout, troca de senha e invalidação
explícita (`lib/auth.ts`). Sessões que expiraram sozinhas ficam. Expurgo
preguiçoso igual ao de `rate_limit_tentativas` (T04 usa o mesmo padrão; faça
os dois juntos se quiser). Aceite: teste com sessão expirada apagada e sessão
válida mantida, com contraprova.

---

## T13 🔵 Testes de comportamento nos fluxos críticos

**Estado.** 79 arquivos de teste. 17 são guardas de texto (leem o código-fonte
e procuram strings). 2 rodam rota contra banco (os desta auditoria). O resto
testa funções puras — esses estão bons.

Guardas de texto passaram com o defeito de volta três vezes (seção 0.2). Nos
fluxos onde um erro machuca alguém, troque por teste de comportamento com
`test/rotasComPglite.ts`, nesta ordem:

1. SOS: criar, responder, encerrar, escalar.
2. Downwind: criar, entrar, espectador, iniciar, posição, encerrar, cancelar.
3. Convite: validar, aceitar, token de uso único.
4. Chat: DM só entre os dois.

Migre também `lib/redefinirSenhaFluxo.test.ts` para usar o helper (hoje ele
tem a própria cópia do PGlite, de antes de o helper existir).

Guarda de texto **não** se apaga — ela só sai quando o teste de comportamento
equivalente existir e tiver passado pela contraprova.

---

## T14 🔵 Lint

`npx eslint . -f json` em 05/10: 96 `no-unused-vars`, 32 `no-img-element`,
5 `exhaustive-deps`, 2 `no-location-assign-relative-destination`.

- `no-unused-vars`: remoção mecânica, um commit, verificação completa.
- `exhaustive-deps`: **um por um**, lendo o efeito. Vários desta base são
  intencionais e comentados — "consertar" sem ler reintroduz laço infinito.
- `no-img-element`: só troque onde a imagem é estática do próprio app.
  Fotos de usuário vêm do Vercel Blob; `next/image` com URL remota exige
  configuração e passa pelo otimizador de imagem (custo).

---

## T15 🔵 `data/mockSpots` é o catálogo real

`app/api/spots/route.ts` e `context/KiteDataContext.tsx` usam `INITIAL_SPOTS`
de `data/mockSpots` como fonte de spots com estação física — é dado real, não
mock. Renomeie o arquivo para `data/spotsCatalogo.ts` e atualize os imports.
Nenhuma mudança de comportamento; verificação completa.

---

## T16 🔵 Domínio pendente — ação do DONO

`app.kiteninja.ct.ws` está cadastrado no projeto `kiteninja` desde a criação,
**não verificado** (falta o registro TXT `_vercel.ct.ws`). Decidir: verificar
(é pré-requisito do e-mail da T08) ou remover.

---

## T17 ⚪ `KiteDataContext.tsx` com 1.547 linhas

Junta spots, feed, chat, SOS, eventos, modais e o logbook. Cada mudança
re-renderiza tudo que consome o contexto. Dividir é o caminho, mas **só
depois de T13**: sem teste de comportamento cobrindo os fluxos, uma divisão
desse tamanho quebra coisa que ninguém percebe. Faça por fatias (uma por
commit, começando pelo SOS), nunca de uma vez.

---

## Rodada UX mobile (06/10) — U01 a U10

Vistos em telas reais a 390×844 (ver diário de 06/10). Os defeitos sem
decisão de produto já foram corrigidos em `9ac4480`. O dono aprovou todos
("Faça tudo", 06/10) e eles foram executados em `3d6c8c6` — coluna **Estado**.

| ID | O que se vê no celular | Proposta | Quem | Estado |
|---|---|---|---|---|
| U01 | Primeira abertura: modal "Antes de velejar" (permissões) e, logo em seguida, "Baixe o KiteNinja no Celular". Dois bloqueios antes de ver qualquer spot. | Mostrar o de instalar só a partir da 2ª visita, ou depois do primeiro velejo. | dono decide → agente | ✅ `3d6c8c6` — só a partir da 2ª carga |
| U02 | Faixa "KiteNinja Radar Pro — ATIVO" na Home. Não existe plano Pro; é decoração herdada de um mockup. | Remover, ou trocar por algo real (ex.: fonte da previsão). | dono decide → agente | ✅ `3d6c8c6` — removida |
| U03 | Feed: abas "Velejos / Comunidade" no topo e, dentro de Velejos, outras abas "Comunidade / Seguindo". Duas "Comunidade" com sentidos diferentes. | Renomear as de dentro para "Todos / Seguindo". | dono decide → agente | ✅ `3d6c8c6` |
| U04 | Card de spot na Home: nome e local cortados ("Praia Ponta…", "• A."); a coluna de texto fica estreita entre o vento e dois botões. | Nome em até 2 linhas e local abaixo; botão de bússola menor. | agente (visual) | ✅ `3d6c8c6` — bússola virou seta; card focável (Enter/Espaço) |
| U05 | Card de downwind com dois botões de participar e contagem que não bate com a lista de participantes logo abaixo. | Um botão só; contagem tirada da mesma lista. | dono confirma → agente | ✅ `3d6c8c6` — rótulos ("Confirmar presença" / "No dia: entrar na travessia"). A contagem **já batia** com a própria lista; a descrição acima estava errada. Nenhuma regra de quórum/SOS mudou |
| U06 | Três portas para o mesmo menu/perfil: hambúrguer, avatar no topo e "Menu" na barra inferior. | Escolher duas (sugestão: hambúrguer + Menu). | dono decide | ✅ `3d6c8c6` — avatar do topo saiu para logado; deslogado vê "Entrar" |
| U07 | Selos "NOVO" permanentes no menu. | Sumir depois do primeiro toque (por usuário). | agente | ✅ `3d6c8c6` — por aparelho (`lib/seloNovo.ts`) |
| U08 | Anúncios sem foto mostram um retângulo preto. | Placeholder com ícone e a cor do card. | agente | ✅ `3d6c8c6` |
| U09 | Botões flutuantes "Publicar Relato" / "Criar Downwind" cobrem o fim da lista. | Espaço no fim da lista do tamanho do botão. | agente | ✔️ verificado: não é defeito — no fim da rolagem nada fica sob o botão; sobrepor durante a rolagem é o normal de botão flutuante |
| U10 | Não há como ver o app sem um banco Neon: a análise de 06/10 usou um modo de preview local (PGlite + dados fictícios) que ficou fora do commit porque o `require` estático levaria o PGlite ao bundle de produção. | Script `npm run dev:preview` com o banco trocado por alias só no dev, sem tocar `lib/db.ts` em produção. Não consome Neon nem Vercel. | agente | ✅ `3d6c8c6` — `npm run dev:preview`; ver README |

Também feito em `3d6c8c6`: títulos curtos que cabem no celular ("Eventos",
"Perfil") e "Meu Diário" no menu lateral e no formulário de velejo.

---

## Como foi medido

| Afirmação | Fonte |
|---|---|
| Escalada do SOS a cada 3–6 h | `gh api repos/tarcyoalves/kiteninja/actions/runs` |
| CI vermelho e a causa | jobs e anotações do run `37355329887` |
| 6 builds por commit | `list_deployments` da Vercel nos dois projetos |
| Domínio pendente | `list_project_domains` da Vercel |
| Vulnerabilidades | `npm audit --omit=dev --json` |
| Rotas admin, suspenso, id inválido | `lib/painelAdminFluxo.test.ts` |
| Fluxo de senha | `lib/redefinirSenhaFluxo.test.ts` |
| Polling, lint, perfil dos testes, tabelas sem expurgo | `grep`/`eslint -f json` no código de 05/10 |

Os logs de runtime da Vercel **não** serviram: o plano Hobby retém pouco, e
não havia nada da última semana. Não conte com eles para investigar nada que
aconteceu há mais de algumas horas — reproduza.
