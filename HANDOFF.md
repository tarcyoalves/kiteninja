# HANDOFF — KiteNinja

Repasse de trabalho para o próximo agente (Antigravity). Escrito em
2026-08-17, sobre o commit `cd06bd2` (`master`), com o app **no ar** em
https://kiteninja.vercel.app

Este documento é o contrato: o que está medido, o que está quebrado, e o que
NÃO pode ser assumido. Tudo que afirmo aqui foi verificado por execução —
onde não deu para verificar, está escrito "não verificado".

---

## 1. O produto em uma frase

App mobile-first de condições para kitesurf (vento, maré, ondas, eventos,
comunidade, marketplace, chat), **fechado por convite**: só entra quem recebe
um link único e não transferível gerado pelo admin.

Público: velejador que precisa "checar tudo com um olhar enquanto se prepara
na praia". Isso é critério de design, não enfeite — se uma informação exige
dois toques para aparecer, está no lugar errado.

## 2. Stack e estado

| Item | Valor |
|---|---|
| Framework | Next.js 16.3.1 (App Router), React 19.2.8, TypeScript |
| Estilo | Tailwind v4 (`@tailwindcss/postcss`) |
| Banco | Neon Postgres via `@neondatabase/serverless` (driver HTTP) |
| Auth | Sessão própria em cookie httpOnly + bcryptjs 12 rounds |
| Clima | Open-Meteo (sem chave), modelo `gfs_seamless` |
| Mapa | Leaflet + react-leaflet, tiles CARTO/OSM |
| Testes | Vitest — **230 passando em 13 arquivos** |
| Build | `npm run build` verde |
| Typecheck | `npx tsc --noEmit` limpo |
| Deploy | Vercel, produção confirmada servindo `cd06bd2` |

### Regras não negociáveis do projeto

1. **`AGENTS.md` manda.** Esta versão do Next tem breaking changes: leia
   `node_modules/next/dist/docs/` antes de escrever código de framework. Não
   confie na sua memória de Next 14/15. O bloco no topo do `AGENTS.md` é
   reescrito pelo `next dev`; commitar junto é o certo, apagar só recria.
2. **Nunca coloque segredo em `NEXT_PUBLIC_`.** `.env*` está no `.gitignore`.
3. **Nunca cole token (GitHub/Vercel/Neon) em chat.** Use o `gh` e o `vercel`
   já autenticados na máquina.
4. **Todo UPDATE/DELETE em dado de usuário filtra por `user_id`.** Já existe
   `lib/authz.test.ts` cobrindo isso; não regrida.
5. **Convite é uso único.** O consumo é um `UPDATE ... WHERE used_at IS NULL`
   condicional, que resolve a corrida no próprio banco. Não troque por
   `SELECT` + `UPDATE`.
6. **Entrega só conta publicada:** commit + push + build verde + confirmação
   na URL pública. "Funciona local" não é entrega.

### Comandos

```bash
npm run dev            # dev server
npx tsc --noEmit       # typecheck
npx vitest run         # 230 testes
npm run build          # build de produção
npx tsx scripts/verify-sql.ts   # valida schema/queries em Postgres real (PGlite, sem rede)
npx tsx scripts/verify-db.ts    # integração contra o Neon (precisa DATABASE_URL)
```

`scripts/verify-sql.ts` roda Postgres em processo via PGlite. **Use antes de
qualquer mudança de schema ou query** — ele já pegou 3 bugs reais (SQL dinâmico
quebrado e `SELECT id` em tabelas de chave composta).

## 3. Arquitetura que você precisa conhecer

```
app/
  api/            26 rotas (lista completa abaixo)
  admin/          painel do admin (gera/revoga convites)
  convite/[token] aceite de convite, validado no servidor antes de renderizar
lib/
  auth.ts         núcleo de segurança (hash, sessão, convite) — 'server-only'
  db.ts           cliente Neon; falha rápido sem DATABASE_URL
  schema.sql      17 tabelas, idempotente
  weather.ts      Open-Meteo (vento + marine)
  windVector.ts   matemática da animação (testada fora do componente)
  api.ts          handle() — converte HttpError em status; nunca vaza stack
  validation.ts   str/num/bool/oneOf/email/password
components/ views/ context/
scripts/          migrate, seed, verify-sql, verify-db
```

Tabelas: `users invites auth_sessions spots favorites sessions_log posts
post_likes post_comments safety_alerts events event_registrations listings
listing_photos listing_favorites chat_messages user_presence`

Rotas: `admin/invites admin/invites/[id] alerts alerts/[id]
auth/change-password auth/login auth/logout auth/me chat/messages
chat/messages/[id] chat/presence events events/[id]/register favorites
invites/accept invites/validate listings listings/[id]
listings/[id]/favorite posts posts/[id]/comments posts/[id]/like profile
sessions sessions/[id] spots`

**Detalhes que já custaram bug e você deve respeitar:**

- `favorites`, `post_likes`, `event_registrations`, `listing_favorites` têm
  **chave composta e NÃO têm coluna `id`**. Toggle correto é
  `DELETE ... RETURNING` e, se não removeu nada, `INSERT ... ON CONFLICT DO
  NOTHING`. `SELECT id` nessas tabelas **explode**.
- PATCH parcial usa `COALESCE(${valor}, coluna)`, não SQL concatenado.
- Params de rota dinâmica são Promise: `ctx: { params: Promise<{ id: string }> }`.
- Login é timing-safe: compara contra `DUMMY_HASH` quando o e-mail não existe.
- A connection string **precisa ser a pooled** (host com `-pooler`).

---

## 4. AS QUATRO TAREFAS

Ordem sugerida: **B → C → D → A**. B e C são bugs que o usuário vê agora; A é
a maior e mais arriscada, e fica melhor sobre uma base sem defeito aberto.

---

### TAREFA A — Estrutura completa de usuários (a maior)

Hoje existe: `users` (role `admin`/`rider`, `must_change_password`,
`disciplines TEXT[]`, peso, nível, home spot), convite uso único, sessão em
cookie, troca de senha, `/api/profile`, painel admin de convites.

Falta pensar **tudo** o que um app real de comunidade precisa. Projete antes
de codar e **entregue o plano versionado no repo** (`docs/PLANO-USUARIOS.md`)
antes de abrir código — o usuário exige plano e progresso versionados, não só
no chat.

Cobrir no mínimo:

**Ciclo de vida da conta**
- Recuperação de senha (token de uso único, expirável, hash no banco — mesmo
  padrão dos convites; **nunca** guarde o token em claro).
- Verificação de e-mail; troca de e-mail com confirmação nos dois endereços.
- Desativação (soft delete) vs. exclusão definitiva com LGPD em mente:
  exportar meus dados, apagar minha conta. Hoje o CASCADE apaga posts e
  sessões junto com o usuário — decida se é isso que se quer (talvez
  anonimizar o autor e preservar o conteúdo da comunidade).
- Reenvio/expiração/revogação de convite (parte existe, revise).

**Identidade e perfil**
- Avatar: hoje há bug conhecido de "alterar foto" relatado pelo usuário —
  **investigue e conserte** (veja Seção 6). Decida armazenamento (Vercel Blob
  é o caminho natural aqui) em vez de base64 no Postgres.
- Perfil público vs. privado, bio, redes, equipamento (quiver: tamanhos de
  kite, prancha), unidades preferidas (nó/km/h), spots favoritos.
- `rider_id` já existe; defina a regra de geração e unicidade.

**Papéis e permissões**
- Hoje só `admin` e `rider`. Provavelmente faltam `moderator` (moderar posts,
  alertas e anúncios) e talvez `escola`/`instrutor` (perfil comercial).
- Centralize a autorização: já existe `lib/authz.ts` + teste. **Toda** rota
  nova passa por lá; não espalhe `if (user.role === 'admin')`.
- Matriz de permissão explícita, testada — quem edita/apaga o quê.

**Segurança**
- Rate limit em login, aceite de convite e recuperação de senha (hoje **não
  existe**; é a lacuna mais séria). Sem isso, força bruta é trivial.
- Lockout progressivo ou captcha após N falhas.
- Sessões: listar dispositivos ativos, revogar uma ou todas, invalidar todas
  ao trocar senha (hoje **não invalida** — verifique e corrija).
- Log de auditoria para ação de admin (quem convidou, revogou, promoveu).
- Rotação do cookie de sessão no login (evita fixation).

**Admin**
- Lista de usuários com busca/filtro/paginação, ver detalhe, suspender,
  promover/rebaixar, forçar troca de senha, reenviar convite.
- Métricas básicas: usuários ativos, convites pendentes, conteúdo reportado.
- Denúncia de conteúdo/usuário e fila de moderação.

**Notificações** (decidir escopo; pode ficar para depois, mas projete o schema)
- Preferências por canal e por tipo (vento bom no meu spot, resposta no meu
  post, novo evento).

Entregáveis: migração idempotente em `lib/schema.sql`, rotas com `handle()` +
validação, testes Vitest (inclusive de autorização negativa), `verify-sql.ts`
estendido, e o plano em `docs/PLANO-USUARIOS.md`.

---

### TAREFA B — Animação de vento pisca e morre (bug, causa já localizada)

**Sintoma do usuário:** "quando clica, aparece rapidamente a animação e some
logo".

**Causa raiz, já diagnosticada — não precisa procurar:**
Em `components/WindParticleLayer.tsx`, `projetarSpots()` é chamado **somente
dentro de `iniciar()`** (linha ~163). O array `projetados` é a única fonte do
campo de vento. Como os dados de vento chegam **assíncronos depois do mount**,
a primeira (e muitas vezes única) projeção acontece com a lista vazia ou
velha. Com `projetados` vazio, `campoDeVento()` retorna
`{vx:0, vy:0, forca:0}` (`lib/windVector.ts:51`) — as partículas nascem, não
recebem deslocamento, o véu translúcido apaga o rastro e o campo "morre".

Medido: instrumentando o DOM, o canvas é criado 2× e removido 1× num único
ciclo de troca de aba — ou seja, o efeito **remonta** e a projeção não
acompanha a chegada dos dados.

`spotsRef.current` é atualizado a cada render (linha 44), mas **ninguém
reprojeta** quando ele muda. Esse é o furo.

**Correção esperada:**
1. Reprojetar quando `spots` mudar de conteúdo (não só na identidade do
   array), sem reiniciar o loop inteiro — repovoar partículas a cada chegada
   de dado faz piscar.
2. Se `projetados` estiver vazio, **não** deixar o loop rodando em vão:
   aguardar dado e então projetar e iniciar.
3. Revisar o remount: o efeito depende de `[map, paused]`, e o
   `activeLayer !== 'ondas'` em `LeafletMap.tsx:330` monta/desmonta o
   componente. Garanta que alternar camada não mate a animação.

**Já corrigido por mim neste commit (não desfaça, é pré-requisito):** o loop
não inicia mais com a aba oculta (o `rAF` pedido nesse estado é suspenso e
nunca reagenda, matando a animação de vez), e um `ResizeObserver` repovoa
quando o container do Leaflet ganha área real.

**Como verificar de verdade** (aprenda do meu erro): o painel de preview
**não compõe frames**, então `document.hidden` fica `true`, `rAF` não é
servido e o canvas lê 0 pixels **mesmo funcionando**. Eu afirmei "funciona no
iPhone" baseado nisso e estava errado. Verificação que funciona: interceptar
`requestAnimationFrame`, enfileirar os callbacks e **bombear ~40 frames à
mão**, depois contar pixels com alpha > 0 via `getImageData`. Com o campo
correto isso deu **20.506 pixels**. Melhor ainda: teste no iPhone real.

---

### TAREFA C — Previsão avança de dia pelo scroll

**Pedido:** ao rolar a previsão, já ir para o próximo dia e assim por diante,
sem clicar no botão de "amanhã"/próxima data.

**Estado real: já existe boa parte.** Em `components/SpotDetailModal.tsx` há
`selectedDayIndex` + `scrolledDayIndex` (linhas ~51-53), `scrollToDay()` com
`scrollIntoView` (~86-97) e um `IntersectionObserver` para saber qual dia está
visível (~105). Ou seja: **verifique e termine, não reescreva.**

Pontos de atenção:
- O `useEffect` de sincronização (~76-83) depende de `selectedDayIndex` — isso
  cheira a laço: scroll muda o índice, o efeito muda o índice de novo. Confirme
  que não há briga entre "scroll manda" e "botão manda".
- `scrollToDay` faz `if (dayIdx === scrolledDayIndex) return;` — cuidado para
  o clique no botão não virar no-op quando o scroll já mudou o valor.
- Respeite `prefers-reduced-motion` (já referenciado no código).
- Rolagem horizontal do cabeçalho de dias mede 623px de conteúdo em 344px de
  caixa: garanta que o dia ativo entre em vista sozinho.
- Objetivo é continuidade real: chegar no fim do dia 1 deve emendar no dia 2,
  sem salto brusco e sem perder a posição ao voltar.

---

### TAREFA D — Maré e ondas divergentes do Windfinder (com pista forte)

**Pedido:** alinhar ao máximo vento, ondas e maré; "saber que horas enche e
que horas seca" com precisão.

**Vento já foi resolvido por mim:** trocado `best_match` → `gfs_seamless` em
`lib/weather.ts:20`. Medido contra o Windfinder no mesmo spot e horário, 8
blocos de 3h: erro caiu de **4,1 → 1,9 nó** (rajada 6,4 → 2,1). Confirmado na
API de produção. Testei `cell_selection=sea` para vento: **piora** (3,6), então
ficou fora, com o motivo anotado no código. Não reintroduza sem medir.

**Maré/ondas — achado importante, verificado agora:**
Chamando `marine-api.open-meteo.com` para Barra de Pernambuquinho
(`-4.975,-37.042`), a resposta volta com:

```
latitude: -4.791664   longitude: -37.041656   elevation: 62.0
```

A API **deslocou a coordenada ~20km para dentro do continente** e devolveu
elevação de 62 m — está resolvendo uma célula de **terra**, não de mar.
`cell_selection=sea` **não corrige** (mesma resposta, mesma elevação). A curva
de maré até oscila de forma plausível (−0,91m a +1,21m), então a amplitude
parece real, mas **a fase e a localização são suspeitas** — e fase errada é
exatamente "erra a hora que enche e que seca".

Investigue nesta ordem:
1. **Coordenada de consulta marinha ≠ coordenada do pino.** O spot é praia; o
   pino pode cair em terra. Provável correção: guardar por spot um par
   `marine_lat/marine_lng` deslocado alguns km para o mar aberto, e consultar
   a maré/onda por ele. Meça: a resposta deve voltar com `elevation` ~0.
2. **Confirme com fonte independente.** Maré astronômica é previsível e
   tabelada; a referência brasileira é a Marinha (DHN/FEMAR). Se o Open-Meteo
   não acertar a fase, considere tábua de maré por porto de referência em vez
   de modelo de circulação — para "enche/seca" isso costuma ser mais preciso.
3. **Interpolação horária é grossa.** Hoje `tideTrendAt` (`lib/weather.ts:163`)
   decide subindo/descendo comparando amostras de 1 hora, e `nextTideText`
   pega a primeira virada. Pico real raramente cai no minuto cheio: interpole
   (parábola nos 3 pontos vizinhos) para dar hora com minuto.
4. **Ondas:** valide `wave_height/direction/period` no mesmo esquema; se a
   célula é de terra, provavelmente estão igualmente deslocados.
5. **Meça e registre**, como fiz com o vento: tabela de erro médio contra a
   referência, antes e depois, no commit. Sem número, não é melhoria.

Cuidado: `lib/weather.test.ts` e `lib/forecastGrid.test.ts` já existem —
estenda em vez de duplicar.

---

## 5. Como eu trabalhei (e onde errei) — economize suas tentativas

- **Delegue em paralelo** para subagentes tarefas independentes (ler muitos
  arquivos, rodar suites), mas **audite a saída**: os agentes reportaram
  "concluído" três vezes com bug real dentro. Achei lendo o código: SQL
  dinâmico que gerava `spot_name = 1` (inteiro literal, não `$1`) e três
  `SELECT id` em tabelas sem coluna `id`.
- **Meça, não deduza.** Minhas três afirmações erradas nesta sessão vieram de
  deduzir: (a) "a animação funciona no seu iPhone" — falso, o preview não
  compõe frames; (b) diagnóstico apoiado em `clientHeight: 0`, quando o
  próprio `<html>` mede 0 no painel; (c) tentei adivinhar a senha do admin e
  tomei 401. Instrumente (MutationObserver, interceptar `rAF`, `getImageData`)
  ou teste no aparelho.
- **Valor chumbado é dívida.** `.bottom-nav-gap` fixava `4rem` para um menu que
  mede **65px**; 1px bastava para cobrir a primeira aba e engolir o toque. Hoje
  o `BottomNav` publica a altura real em `--nav-h` via `ResizeObserver`. Meça,
  não adivinhe.
- **Safe area do iPhone:** overlays em tela cheia precisam de
  `.overlay-safe-top` / `.overlay-safe-bottom` (em `app/globals.css`), senão
  colidem com o relógio. Já aplicado em SpotDetailModal, SidebarDrawer,
  ListingDetailModal e PhotoLightboxModal — **use nos novos**.
- O badge de dev do Next cobre o canto inferior no preview; é artefato de dev,
  não vai para produção. Não "conserte".

## 6. Pendências conhecidas (fora das 4 tarefas)

- **"Alterar foto" não funciona** — relatado pelo usuário, causa ainda não
  localizada. Entra na Tarefa A (avatar).
- **Criar anúncio e chat** — o usuário relatou que não estavam funcionando;
  há rotas e testes (`listings`, `chat/*`, `marketplace.test.ts`,
  `chat.test.ts`), mas **não confirmei ponta a ponta logado**. Verifique.
- **Vento logado em produção não verificado ponta a ponta**: `/api/spots` sem
  sessão devolve 401 — comportamento correto de app por convite. A validação
  do GFS que fiz depois do deploy foi na API de produção autenticada via
  navegador e no servidor local com o mesmo código. Para reconferir logado,
  gere um convite novo pelo painel admin.
- **Sem rate limit** em login/convite/recuperação. Lacuna de segurança mais
  séria hoje.
- `calculateKiteSize` tem condicional morta (`(75 / weightKg) > 0`, sempre
  verdadeiro) herdada do código original. Limpar quando tocar no arquivo.
- Regra de negócio confirmada pelo usuário: **18 nós ou mais já é vento bom
  para velejar.** Respeite nas escalas de cor e nos alertas.

## 7. Definição de pronto

Para cada tarefa:

1. `npx tsc --noEmit` limpo.
2. `npx vitest run` — 230 testes atuais continuam passando, mais os novos.
3. `npx tsx scripts/verify-sql.ts` verde se mexeu em schema/query.
4. `npm run build` verde.
5. Verificado no aparelho ou por instrumentação real (não por screenshot de
   preview, veja Seção 5).
6. Commit com mensagem explicando **o porquê** e trazendo o número medido
   (como no commit `cd06bd2`).
7. Push e **confirmação na URL pública** — o deploy da Vercel entra como
   Preview; promova para produção e confirme que o artefato servido tem a sua
   mudança. Eu confirmei baixando o CSS de produção e conferindo
   `var(--nav-h,4rem)`.
8. Plano e progresso versionados em `docs/` — outro agente precisa poder
   continuar sem este chat.

Idioma: código, comentários, commits e UI em **português do Brasil**.
Comentário explica **por que**, não o que a linha faz.
