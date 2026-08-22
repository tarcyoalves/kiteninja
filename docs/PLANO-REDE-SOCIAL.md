# Plano — KiteNinja como rede social de velejo

Status: **plano, nada implementado.** Escrito em 21/08/2026 a partir de um
pedido do dono, com prints do app **Surfr** como referência visual:

> "Pensando no futuro do app para abrirmos para o público geral vamos adotar
> esse estilo de mapa realista. Planeje esse estilo de timeline como rede
> social, podendo curtir o velejo do amigo. Pense na forma de buscar e add
> amigos. (...) Quero o aplicativo bem fluido."

Três pedidos concretos (mapa realista, timeline social com curtida, buscar/
adicionar amigos) e **um requisito transversal que vale como restrição de
projeto em todas as fases: fluidez**. Ver a seção "Fluidez" — ela não é um
polimento no fim, é o que decide a arquitetura do feed.

---

## 1. O que o app JÁ tem (levantado no código, não suposto)

Antes de planejar o que falta, o que dá para reaproveitar:

| Peça | Onde | Reaproveitamento |
|---|---|---|
| Sessão de velejo completa | `sessions_log` (24 colunas: spot, data, duração, vento, kite, distância, vel. máx, foto, nota) | **É o "post" da timeline.** Não precisa de tabela nova para o conteúdo. |
| Privacidade por sessão | `sessions_log.is_public` (default TRUE) | Já existe. O feed só precisa respeitar. |
| Curtir + comentar | `post_likes`, `post_comments` | **Padrão de código pronto** (rota, otimismo na UI, contagem). Copiar a forma, não a tabela — ver 4.2. |
| Redução de trilha GPS | `amostrarTrilha()` em `lib/trilhaDownwind.ts` | Reduz N pontos para ~200. Pronto e testado. |
| Mapa estático com trilha | `components/DownwindResumoMapa.tsx` | **É quase o card do feed**: trilha + marcadores início/fim + `fitBounds`. |
| Tiles de satélite | `LeafletMap.tsx` (Esri World Imagery) | O estilo "realista" já existe, só não é padrão nem compartilhado. |
| Presença ao vivo | `user_presence` + `GET /api/chat/presence` | É o "26 riders live worldwide" do print 1 e o modo "People" do Discover. |
| Perfil rico | `users` (rider_id, país, nível, quiver, home spot, bio) | Base do perfil público. |
| Medição GPS ao vivo | `lib/useTrilhaSessao.ts` + `lib/trilhaSessao.ts` | Já mede distância e vel. máx com filtros calibrados. |

**O app já é 70% de uma rede social de velejo. O que falta é o grafo social,
a trilha persistida na sessão, e a timeline.**

---

## 2. Os três buracos reais

### 2.1 A sessão não guarda a trilha — o buraco que bloqueia tudo

O card do Surfr é, visualmente, **a trilha desenhada no mapa de satélite**.
Sem isso não existe timeline com essa cara.

Hoje `sessions_log` guarda `distance_km` e `max_speed_knots`, mas **nenhuma
geometria**. E a raiz é anterior ao banco: `lib/trilhaSessao.ts` acumula
`EstadoTrilha` com distância, velocidades e `ultimaReferencia` — **um único
ponto**, o anterior, para calcular o próximo trecho. A lista de pontos nunca
existe; cada amostra é consumida e descartada.

O downwind em grupo resolveu isso à parte: `downwind_participantes.
trilha_reduzida` (JSONB, `[[lat,lng,tsMs], ...]`, ~200 pontos). **A sessão
solo precisa do mesmo, e do mesmo jeito** — não de um segundo mecanismo.

### 2.2 Não existe grafo social

Zero ocorrências de `follow`/`amigo`/`seguidor` no código inteiro. Não há
como um velejador ver o velejo de outro: `GET /api/sessions` filtra
`WHERE s.user_id = ${user.id}` — só as próprias.

### 2.3 Curtir uma sessão é indireto e quebrado

`GET /api/sessions` calcula `likesCount` assim:

```sql
SELECT COUNT(*) FROM post_likes pl
JOIN posts p ON p.id = pl.post_id
WHERE p.session_id = s.id
```

Ou seja: **só dá para curtir uma sessão se o autor também tiver criado um
post separado sobre ela.** Na prática o contador é sempre 0. A sessão precisa
ser curtível diretamente.

---

## 3. Fluidez — a restrição que decide a arquitetura

> "Quero o aplicativo bem fluido."

O jeito ingênuo de fazer o feed é renderizar um `<MapContainer>` por card.
**Isso destrói o app em celular:** cada mapa Leaflet é uma instância viva com
listeners, canvas e dezenas de requisições de tile. Vinte cards = vinte mapas
= scroll travado e 4G estourado. É o erro mais caro possível aqui, e é
irreversível depois que a UI inteira depende dele.

**Decisão: duas camadas de renderização da trilha.**

1. **`components/TrilhaMiniatura.tsx` (SVG puro, instantâneo, zero rede).**
   Recebe `trilha_reduzida`, projeta os pontos num `viewBox` e desenha um
   `<polyline>`. Sem Leaflet, sem tile, sem `useEffect`. Renderiza no mesmo
   frame que o resto do card. **É o que o velejador vê ao rolar rápido.**

2. **Satélite real, só quando o card para na tela.** Um `IntersectionObserver`
   monta o Leaflet (com `dragging`, `zoom`, `scrollWheelZoom` e
   `keyboard` **desligados** — é uma figura, não um mapa) por cima da
   miniatura SVG, com fade-in. Sai da tela por uma margem generosa →
   desmonta e volta a ser SVG.

Resultado: rolagem sempre fluida (SVG é barato), e o visual realista do Surfr
onde o olho de fato para. A miniatura SVG nunca "pisca" para branco, porque
ela já está desenhada por baixo.

**Demais regras de fluidez, obrigatórias em toda fase:**

- **Paginação por cursor (keyset), nunca `OFFSET`.** `WHERE created_at <
  $cursor ORDER BY created_at DESC LIMIT 15`. `OFFSET` fica mais lento a cada
  página; keyset é constante.
- **Nada de polling novo.** O app já tem 3 poltas em andamento (chat 4s, DM
  10s, SOS). O feed atualiza em: abrir a aba, pull-to-refresh, e voltar do
  background. Mais um `setInterval` seria bateria e 4G a troco de nada.
- **Curtida otimista.** O coração pinta no toque; a requisição vai atrás; se
  falhar, reverte. Nunca esperar a rede para dar feedback.
- **`React.memo` no card + `content-visibility: auto`** no container, para o
  browser pular o layout do que está fora da tela.
- **Consultar `.claude/skills/vercel-react-best-practices`** antes de escrever
  os componentes — a skill está instalada no projeto exatamente para isto.

---

## 4. Arquitetura proposta

### 4.1 Grafo social: **seguir assimétrico**, não "amizade" com aceite

O dono falou "amigos", mas a mecânica certa aqui é a do Strava/Surfr:
**seguir**, sem pedido nem aceite.

Por quê: amizade simétrica exige uma fila de convites pendentes, tela de
aceitar/recusar, notificações dos dois lados e um estado a mais em toda
consulta. Seguir é um `INSERT` e um `DELETE`. Para um app que quer abrir ao
público, é a diferença entre "achei o cara, toquei em Seguir, pronto" e um
fluxo de 4 telas.

**"Amigo" continua existindo como conceito na UI:** quando os dois se seguem,
a UI mostra "Amigos". É derivado, não é uma tabela.

```sql
CREATE TABLE user_follows (
  follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)   -- ninguém segue a si mesmo
);
CREATE INDEX idx_follows_following ON user_follows (following_id);
```

O `CHECK` é a barreira no banco, além da checagem na rota — mesmo princípio
de `salaDireta` rejeitar auto-DM em duas camadas.

### 4.2 Curtir/comentar a sessão diretamente

Tabelas espelhando `post_likes`/`post_comments`, que já funcionam:

```sql
CREATE TABLE session_likes (
  session_id UUID NOT NULL REFERENCES sessions_log(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, user_id)
);
CREATE TABLE session_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions_log(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_session_comments ON session_comments (session_id, created_at);
```

A PK composta em `session_likes` é o que torna "curtir duas vezes"
impossível no banco, não só na UI.

**Não migrar** o `likesCount` antigo (que passa por `posts`): ele sempre valeu
0 na prática. A consulta velha sai, a nova entra.

### 4.3 Trilha na sessão

```sql
ALTER TABLE sessions_log ADD COLUMN IF NOT EXISTS trilha_reduzida JSONB;
ALTER TABLE sessions_log ADD COLUMN IF NOT EXISTS lat_inicial NUMERIC(9,6);
ALTER TABLE sessions_log ADD COLUMN IF NOT EXISTS lng_inicial NUMERIC(9,6);
```

Mesmo formato de `downwind_participantes.trilha_reduzida` (`[[lat,lng,tsMs]`),
mesma redução (`amostrarTrilha`, limite 200). `lat/lng_inicial` existem para
o feed conseguir enquadrar o mapa sem varrer o array inteiro.

`lib/trilhaSessao.ts` passa a acumular os pontos aceitos num array **com
teto** (ex.: 5.000 pontos brutos; ao cruzar, reamostra pela metade). Sem teto,
uma travessia de 3h a 1Hz são ~11 mil pontos em memória num celular.

### 4.4 Feed

`GET /api/feed?cursor=<iso>` devolve sessões de **quem eu sigo + as minhas**,
com `is_public = TRUE`, keyset por `created_at DESC`, 15 por página.

Regra de visibilidade, em um só lugar (`lib/social.ts`, função pura testável):

- Minha própria sessão: sempre visível para mim, pública ou não.
- Sessão de terceiro: visível se `is_public = TRUE`.
- Feed lista só quem eu sigo (+ eu). Descobrir gente nova é a aba Descobrir,
  não o feed — feed de estranhos vira ruído no dia 1.

### 4.5 Buscar velejadores

`GET /api/riders/search?q=` — `ILIKE` em `name` e `rider_id`, `is_active =
TRUE`, exclui a própria conta, limite 20, devolve se já sigo.

**Nunca devolver `email`** — é o vazamento óbvio de uma busca aberta. O
`authz.test.ts` já audita rotas por vazamento de hash de senha; a busca entra
na mesma disciplina.

Índice para não fazer varredura completa quando a base crescer:
```sql
CREATE INDEX IF NOT EXISTS idx_users_busca_nome ON users (LOWER(name));
```

---

## 5. O que aproveitar dos prints (e o que NÃO copiar)

### Aproveitar

| Print | Elemento | Onde aplicar |
|---|---|---|
| 1 (feed) | Cabeçalho do card: avatar + nome + spot + bandeira à esquerda; duração + vento à direita | `CardSessaoFeed` — temos todos esses dados |
| 1 | Faixa de 4 números grandes sobre o mapa | Nossos 4: **Distância, Vel. máx, Duração, Vento** |
| 1 | Linha `❤ 0  💬 0  ↗` + tag do equipamento à direita | Reusar padrão de `FeedView` atual |
| 1 | "Uploaded session from watch" + "Today at 11:13" | Nossa legenda + horário relativo |
| 1 | "26 riders live worldwide" | **Já temos**: `user_presence` |
| 2 | Discover com 3 modos (Spots / People / Wind) | Já temos Spots e Wind; **People = presença** |
| 3 | Folha arrastável "Show N spots in this area" | Combina com o card inferior do mapa atual |
| 4 | Satélite realista como padrão | Fase 0 |
| 5 | Estrutura de Ajustes em seções | Reorganizar `PerfilView` depois |
| 7 | Detalhe: mapa full-bleed + folha + abas | Tela de detalhe da sessão |

### NÃO copiar

- **Jumps / Max airtime / Jump Analysis.** O Surfr tira isso de relógio ou
  sensor (Woo/Garmin). **Nós só temos GPS de celular** — altura de salto por
  GPS é ruído, não dado. Inventar um número aqui seria mentir para o
  velejador, exatamente o que `ModoNavegacao` evita nos avisos de sinal. O
  campo `highest_jump_m` do logbook é **manual** e só aparece se preenchido.
- **"Subscribe to unlock" / PRO.** Monetização não foi pedida e trava
  funcionalidade do próprio usuário.
- **Leaderboard.** Fase futura; exige regra anti-fraude de GPS antes.

---

## 6. Privacidade — a decisão que não pode ficar para depois

Abrir ao público + publicar trilhas de GPS tem uma consequência concreta:
**o início e o fim da trilha dizem onde a pessoa estava.** Em kitesurf isso
quase sempre é uma praia, mas o Modo Navegação pode ser ligado em casa.

Para esta fase, o mínimo honesto:

1. `sessions_log.is_public` **já existe e já é respeitado** — o feed nunca
   mostra sessão privada de terceiro.
2. O interruptor "Sessão pública" no `SessionLoggerModal` precisa ficar
   **visível e explicado** ("aparece no feed de quem te segue"), não escondido
   no fim do formulário.
3. Registrado como pendência para a fase de abertura ao público:
   perfil privado (`users.perfil_publico`), bloquear usuário, e ocultar os
   primeiros/últimos ~200m da trilha.

Não é excesso de zelo: é o que diferencia abrir para o público de vazar a
casa dos primeiros usuários.

---

## 7. Fases (cada uma entrega sozinha e é verificável)

**Fase 0 — Mapa realista.** `lib/mapTiles.ts` centraliza os 3 estilos (hoje
duplicados em 3 componentes, com o resumo do downwind ainda em `dark_all`).
Satélite vira o padrão. Sem schema, sem API. *Entrega visível no mesmo dia.*

**Fase 1 — Trilha na sessão.** `lib/trilhaSessao.ts` acumula pontos com teto;
`ResumoNavegacao` carrega a trilha; `sessions_log` ganha as 3 colunas; `POST
/api/sessions` aceita e reduz. Checks em `verify-sql.ts`.

**Fase 2 — Grafo social.** `user_follows`, `lib/social.ts` (puro + testes),
`GET /api/riders/search`, `POST/DELETE /api/riders/[id]/follow`.

**Fase 3 — Feed.** `session_likes`/`session_comments`, `GET /api/feed` com
keyset, `TrilhaMiniatura` (SVG), `CardSessaoFeed` (Leaflet lazy), `FeedView`
reescrito com scroll infinito.

**Fase 4 — Perfil público + detalhe da sessão.** `GET /api/riders/[id]`,
tela de detalhe (mapa full-bleed + folha + estatísticas), botão Seguir.

**Fase 5 — Descobrir pessoas.** Aba People no Discover, sugestões por spot em
comum, contadores de seguidores.

## 8. Critérios de aceite

- `node node_modules/tsx/dist/cli.mjs scripts/verify-sql.ts` — verde, com
  checks novos para: trilha na sessão, `CHECK` de auto-follow, PK de
  `session_likes` barrando curtida dupla, e a consulta keyset do feed.
- `node node_modules/vitest/vitest.mjs run` — verde, incluindo **teste de
  negação**: usuário C não recebe no feed a sessão privada de A, e não
  consegue curtir o que não pode ver.
- `tsc --noEmit` e `next build` limpos.
- **Fluidez, medida e não deduzida:** rolar 20 cards não pode montar 20
  Leaflets. Verificável contando instâncias montadas no card.
