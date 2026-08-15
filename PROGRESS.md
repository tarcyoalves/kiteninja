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
| 5 | Publicar: push no repo + deploy Vercel | ⏳ pendente — falta `DATABASE_URL` real e login Vercel |

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

## O que falta para publicar (tarefa #5)

1. **`DATABASE_URL` pooled do Neon** — precisa ter `-pooler` no host. Sem
   isso `npm run migrate` e `npm run seed` não têm o que rodar contra.
2. Rodar, nessa ordem, contra o banco real:
   ```bash
   npm run migrate   # aplica lib/schema.sql
   npm run seed      # cria spots + primeiro admin (senha impressa 1x)
   npm run test:db   # scripts/verify-db.ts, testes de integração no banco real
   ```
3. `npx vercel login` (ou variável de ambiente de token da Vercel — o usuário
   mencionou já ter posto o token do Neon nas env vars do projeto Vercel).
4. `git init` neste diretório (ainda não é repo git local), commit, push para
   `https://github.com/tarcyoalves/kiteninja` (repo já existe, autenticado via
   `gh`, mas está vazio — sem branch padrão ainda).
5. `vercel --prod` ou conectar o repo no dashboard da Vercel, com as env vars
   `DATABASE_URL` e `APP_URL` configuradas lá.
6. Depois do primeiro deploy: acessar `/admin` com o admin criado pelo seed,
   gerar o primeiro convite, e validar o fluxo de aceite em
   `/convite/[token]` na URL pública.

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

## Como continuar (se você é outro agente lendo isto)

1. Leia este arquivo até o fim antes de tocar em qualquer rota de API.
2. Rode `npm run typecheck && npm run test && npm run test:sql && npm run build`
   e confirme que ainda está tudo verde antes de começar a mudar algo.
3. Se for adicionar uma rota nova que toca em `favorites`, `post_likes` ou
   `event_registrations`, siga o padrão DELETE-RETURNING/INSERT-ON CONFLICT já
   usado nas rotas existentes — não crie uma coluna `id` que não existe.
4. Atualize a tabela de status no topo deste arquivo ao terminar uma tarefa.
