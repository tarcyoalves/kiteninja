# KiteNinja — progresso

Registro vivo do que já foi feito, o que falta e as decisões que importam para
quem continuar este trabalho (humano ou agente). Atualize esta lista a cada
mudança de estado relevante — não deixe o progresso só no chat.

## Status (14/08/2026)

| # | Tarefa | Estado |
|---|---|---|
| 1 | Scaffold Next.js 16 + Neon + auth core | ✅ concluído |
| 2 | Integrar Open-Meteo (vento/maré real, janela de 7 dias) | ✅ concluído |
| 3 | Migrar UI do Vite (Gemini) para Next.js | ✅ concluído |
| 4 | Testes + build verde | ✅ concluído (ver abaixo) |
| 5 | Publicar: push no repo + migrate/seed + deploy Vercel | ✅ concluído — no ar em https://kiteninja.vercel.app |

## O que já está pronto

- **Auth real**: bcrypt (12 rounds), sessões httpOnly de 30 dias, convites de
  uso único (`lib/auth.ts`). Sem cadastro aberto — só entra quem tem link de
  convite gerado por um admin (`app/admin`, `app/convite/[token]`).
- **Banco**: schema completo em `lib/schema.sql` (12 tabelas), validado linha
  a linha contra Postgres real via PGlite — ver `scripts/verify-sql.ts`
  (`npm run test:sql`, 47 checks, sem precisar de Neon nem Docker).
- **Clima real**: `lib/weather.ts` busca vento/rajada/direção na Open-Meteo e
  onda/maré na Marine API (ambas sem chave). Cache de 10 min em memória.
  Testado contra a API real em `lib/weather.test.ts` (`npm run test`).
- **Rotas de API**: todas as rotas em `app/api/` foram auditadas e têm suas
  queries validadas contra Postgres real (não só lidas). Bugs encontrados e
  corrigidos nesta auditoria:
  - `app/api/sessions/[id]/route.ts`: SQL dinâmico quebrado (gerava `$1`
    como inteiro literal) — reescrito com `COALESCE` + helper `sent()`.
  - `app/api/posts/[id]/like/route.ts`, `app/api/favorites/route.ts`,
    `app/api/events/[id]/register/route.ts`: `SELECT id FROM <tabela de
    chave composta>` — essas tabelas (`post_likes`, `favorites`,
    `event_registrations`) não têm coluna `id`. Reescritas com o padrão
    `DELETE ... RETURNING` seguido de `INSERT ... ON CONFLICT DO NOTHING`
    (toggle atômico resolvido no banco).
  - `app/api/sessions/route.ts` (GET): mesmo problema de coluna inexistente
    (`COUNT(pl.id)` em `post_likes`) **mais** inflação de contagem por
    duplo `LEFT JOIN` (likes × comentários se multiplicavam). Reescrito com
    subqueries de `COUNT(*)`.
  - `app/api/posts/route.ts`, `app/api/alerts/route.ts`,
    `app/api/events/route.ts`, `app/api/posts/[id]/comments/route.ts`:
    todo `POST` fazia `String(inserted[0])`, que serializa o objeto como
    `"[object Object]"` em vez do id. Corrigido para
    `String((inserted[0] as Record<string, unknown>).id)`.
  - `app/api/posts/route.ts` (GET): comentários sempre voltavam `[]`
    (comentado como "fetched separately", mas nunca eram). Reescrito com
    `json_agg` para trazer os comentários já no payload do feed, sem N+1.
  - `app/api/spots/route.ts`: zerava todos os campos de clima
    ("weather enrichment left for later"). Agora chama
    `getManySpotsWeather` e popula vento/onda/maré reais por spot.
- **UI**: código do Gemini (Vite) migrado para App Router. O contexto de
  dados (`context/KiteDataContext.tsx`) foi **reescrito do zero** — a versão
  original vivia inteira em `localStorage` com vento gerado por
  `Math.random()`. A versão atual fala com as rotas de API acima, com
  atualização otimista (toque na tela reage antes da resposta do servidor,
  desfaz se o servidor recusar) nos toggles de favorito/like/inscrição.
- **Verificação que já corre em CI/local**:
  - `npm run typecheck` → `tsc --noEmit`, limpo.
  - `npm run test` → Vitest, 20 testes (12 de auth + 8 de clima, 2 deles
    batendo na Open-Meteo real).
  - `npm run test:sql` → PGlite, 47 checks contra Postgres real (schema,
    constraints, isolamento entre usuários, toggles, cascata).
  - `npm run build` → `next build`, 24 rotas, verde.

## Radares ao vivo de app pago (pedido do usuário, recusado)

O usuário pediu para puxar as velocidades de vento dos radares de um app pago
de kite (assinatura própria) e usar isso para alimentar o KiteNinja. Recusei:
isso é scraping automatizado de um serviço pago de terceiro, contra os termos
de uso do app mesmo usando credencial legítima — risco real de banimento da
conta paga, e provavelmente a rede de radares é licenciada de outra empresa,
não do app em si.

Alternativas legítimas se isso for retomado:
- **INMET** (`apitempo.inmet.gov.br`): estações automáticas com vento medido,
  dados abertos e gratuitos, boa cobertura no litoral.
- **PNBOIA** (Marinha do Brasil): boias oceânicas com vento/onda medidos ao
  vivo, dados abertos.
- Assinar uma API meteorológica que já licencia dados de estação real
  (Windy API, StormGlass, Tomorrow.io) — uso autorizado, sem essa zona
  cinzenta.

Nenhuma dessas foi implementada ainda; é trabalho futuro se o usuário quiser
uma camada "observado" (sensor real) ao lado da previsão de modelo que já
está no ar.

## Tarefa #5 — status

- ✅ `git init` local, primeiro commit, push para
  `https://github.com/tarcyoalves/kiteninja` (branch `master`).
- ✅ Projeto Vercel `kiteninja` já existia e já tinha `DATABASE_URL` (pooled,
  host `-pooler`) configurada em Preview/Production.
- ✅ `npm run migrate` rodado contra o Neon real — as 12 tabelas existem.
- ✅ `npm run seed` rodado — 12 spots + 3 eventos + admin
  `tarcyo.alves@gmail.com`, senha temporária `1234` (`must_change_password =
  TRUE`, troca obrigatória no primeiro login).
- ✅ `npm run test:db` (scripts/verify-db.ts) — 31/31 passaram contra o Neon
  real: schema, constraints, convite de uso único (inclusive corrida
  concorrente), isolamento entre usuários, cascata.
- ⏳ Falta: deploy de fato (`vercel --prod` ou push automático via integração
  Git da Vercel) e validação do fluxo de convite na URL pública.

### Bug crítico encontrado ao rodar migrate pela primeira vez

`scripts/migrate.ts` dividia `lib/schema.sql` por `;` e depois descartava
qualquer bloco cuja **primeira linha** fosse um comentário (`-- ...`). Como
cada `CREATE TABLE` no schema é precedido por um comentário de seção na mesma
"sentença" (sem `;` entre o comentário e o `CREATE TABLE`), o filtro apagava
o comentário *e* a tabela junto — silenciosamente, sem erro até o primeiro
`CREATE INDEX` que dependia da tabela descartada. Isso teria deixado
`users`, `invites`, `auth_sessions`, `spots`, `favorites`, `sessions_log`,
`posts` e `safety_alerts` (8 de 12 tabelas) sem serem criadas.
Corrigido: agora os comentários são removidos com uma regex global antes do
split por `;`, não usados para filtrar blocos inteiros. Confirmado rodando
contra o Neon real (22 comandos, 12 tabelas).

## Decisões que valem registrar

- **Sem cadastro aberto por design**: só existe `POST /api/invites/accept`.
  Não recrie um `register()` genérico — isso reabriria a porta que o usuário
  pediu para manter fechada ("link unico e nao pode ser repassado").
- **Nunca colar token/PAT no chat.** Push e deploy usam `gh` CLI e Vercel CLI
  já autenticados na máquina do usuário.
- **Toda tabela com chave composta** (`favorites`, `post_likes`,
  `event_registrations`) não tem coluna `id`. Se escrever uma query nova
  contra essas tabelas, não assuma `id` — use as colunas da própria chave.
- **Todo UPDATE/DELETE em dado de usuário filtra por `user_id`** (ou por
  `id + user_id` junto). Ver `app/api/sessions/[id]/route.ts` como padrão de
  referência: um velejador nunca consegue apagar ou editar sessão de outro.
- **Cache de clima é em memória (`Map` no módulo `lib/weather.ts`), 10 min.**
  Em serverless isso significa cache por instância, não compartilhado — é uma
  escolha aceitável para não precisar de Redis nesta fase, mas se o tráfego
  crescer vale mover para KV/Upstash.
- **Antes de confiar em qualquer query nova**: rode contra
  `scripts/verify-sql.ts` (PGlite, sem precisar de Neon) antes do deploy. Foi
  assim que os bugs acima foram encontrados — ler o código não bastou, três
  deles só quebraram ao executar de fato.

## Deploy (16/08/2026) — site no ar

- URL pública: **https://kiteninja.vercel.app**
- `npx vercel --prod` publicou, mas a URL respondia 404 mesmo com build
  verde. Causa: o projeto Vercel tinha `framework: null` (preset "Other"),
  então a Vercel não sabia servir a saída do Next.js corretamente. Corrigido
  via API (`PATCH /v9/projects/:id` com `framework: "nextjs"`).
- Além disso o projeto tinha `ssoProtection: {"deploymentType":
  "all_except_custom_domains"}` — como não há domínio customizado, isso
  bloqueava *todo* acesso público (redirecionava para login da Vercel).
  Removido (`ssoProtection: null`) porque o pedido explícito era deixar o
  site acessível para teste sem exigir login na Vercel. Se algum dia quiser
  reativar proteção de preview/produção, é essa mesma chave.
- Após as duas correções, novo `vercel --prod` e validado direto na URL
  pública: home 200, `/api/spots` devolvendo vento/onda/maré reais (não
  mock), login do admin funcionando (`mustChangePassword: true`), `/admin`
  retorna 200 autenticado e 307 (redirect) sem sessão.
- Login do admin: `tarcyo.alves@gmail.com` / senha temporária `1234`
  (`must_change_password = TRUE`, troca obrigatória no primeiro acesso).
  Gere o primeiro convite em `/admin` e comece a trocar a senha por ali.

## Como continuar (se você é outro agente lendo isto)

1. Leia este arquivo até o fim antes de tocar em qualquer rota de API.
2. Rode `npm run typecheck && npm run test && npm run test:sql && npm run build`
   e confirme que ainda está tudo verde antes de começar a mudar algo.
3. Se for adicionar uma rota nova que toca em `favorites`, `post_likes` ou
   `event_registrations`, siga o padrão DELETE-RETURNING/INSERT-ON CONFLICT já
   usado nas rotas existentes — não crie uma coluna `id` que não existe.
4. Atualize a tabela de status no topo deste arquivo ao terminar uma tarefa.
