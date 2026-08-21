# Pendências — sessão de 20/08/2026 (continuar aqui)

Lista original do dono, 9 itens. Status real de cada um, para quem continuar
não repetir investigação.

## INCIDENTE — dono ficou trancado fora do próprio app (resolvido)

Depois do deploy do item 8 (perfil, commit `f2be153`/`bb11f92`), **ninguém
rodou a migração de schema em produção**. `lib/schema.sql` ganhou
`ALTER TABLE users ADD COLUMN IF NOT EXISTS height_cm NUMERIC(5,1);`, mas essa
coluna nunca foi criada no Neon de produção. O código foi ao ar assumindo que
ela existia.

Efeito em cascata, só descoberto pelos runtime logs da Vercel
(`get_runtime_errors`), não por dedução:

1. Toda checagem de sessão (`GET /api/auth/me`, que faz `SELECT ... height_cm
   ... FROM users`) quebrava com `NeonDbError: column "height_cm" does not
   exist` (500). É por isso que o dono foi deslogado sem motivo aparente logo
   no início desta sessão — qualquer refresh de sessão depois daquele deploy
   caía nesse erro.
2. Isso também mascarou os dois problemas seguintes: o login (`POST
   /api/auth/login`) retornava 200 normalmente (usuário/senha corretos), mas
   o `refresh()` do `AuthContext` que vem logo depois batia nesse 500, então
   `isAuthenticated` nunca virava `true`. Da tela do usuário: botão vira
   "Entrando...", volta para "Entrar", **sem nenhuma mensagem de erro** — o
   código não tem esse terceiro caminho (só sabe dizer "senha errada" ou "sem
   conexão"). Foram investigadas DUAS hipóteses erradas antes desta (rate
   limit de login, tela de troca de senha obrigatória) até os logs mostrarem
   a causa real.
3. O reset de senha em si (ver item abaixo) também não tinha como ser
   confirmado direto do agente: o driver `@neondatabase/serverless` faz as
   consultas via HTTPS para `api.<região>.aws.neon.tech`, host que a política
   de rede do ambiente do agente bloqueia (403). Rodar o SQL via console do
   Neon, pelo navegador do próprio dono, foi o único caminho que funcionou.

**Correção aplicada:** o dono rodou `ALTER TABLE users ADD COLUMN IF NOT
EXISTS height_cm NUMERIC(5,1);` direto no SQL Editor do Neon. Login voltou a
funcionar.

**Lição pra não repetir:** depois de qualquer deploy que mexe em
`lib/schema.sql`, rodar `node node_modules/tsx/dist/cli.mjs scripts/migrate.ts`
(ou o SQL Editor do Neon) contra o banco de **produção**, não só validar com
`scripts/verify-sql.ts` (que roda contra PGlite em memória, nunca contra o
banco real). Verde no `verify-sql.ts` prova que o schema é coerente
internamente; não prova que o banco de produção foi atualizado. Considerar
adicionar a migração ao pipeline de deploy (build step da Vercel) para este
tipo de esquecimento parar de ser possível.

**Outra lição, sobre a sessão de suporte em si:** o agente quase publicou uma
rota temporária de reset de senha gated por segredo, direto no repositório
— que é **público** no GitHub. O classificador de segurança do ambiente
bloqueou a ação antes do push. Nunca commitar segredo/bypass de autenticação
em repositório público, nem "por um instante" — o histórico do Git é
permanente e qualquer scraper pode pegar o commit em segundos.

## Feito e publicado (main)

1. **Salve indo pro chat geral** → não corrigido ainda (é o item grande, ver
   `docs/PLANO-CHAT-DIRETO.md` — plano completo de DM, nada implementado).
2. **Chat individual** → mesmo plano acima.
3. **Autonotificação da própria mensagem** → **corrigido**, commit `2869cc3`.
   `context/KiteDataContext.tsx`: filtra `novasDeOutros` por `userId !== user?.id`
   antes de contar não-lidas/notificar.
4. **Mapa e Radares iguais** → **corrigido**, commit `fe81857`. Os dois botões
   do menu chamavam `navigateTo('mapa')`. Removido "Radares" (decisão do dono).
5. **Downwind devia nascer em Eventos** → **corrigido**. Ver seção abaixo.
6. **Só radar GFS** → **corrigido**, commit `3dfeccc`. `lib/multiModel.ts`
   deletado (só existia pro blend), `lib/weather.ts` busca só `gfs_seamless`,
   card de comparação de 3 modelos removido de `SpotDetailModal.tsx`.
7. **Criar DW no menu flutuante** → **corrigido**, junto com o item 5 (mesmo
   trabalho, ver seção abaixo).
8. **Editar perfil (peso/altura/kite)** → **corrigido**, commit `f2be153`.
   Já existia `app/api/profile/route.ts` self-serve (o agente corrigiu minha
   premissa errada de que precisava criar rota nova) — estendido com
   `height_cm` (novo em `users`), clamp de `quiverKites`/`quiverBoards`,
   `preferredWindUnit` virou `oneOf(...)` em vez de string livre.
   `views/PerfilView.tsx` novo, aba `'perfil'` deixou de ser morta, botão
   "Editar Perfil" no `SidebarDrawer.tsx`. 123 checks SQL, 456 testes.
   **Pendência pequena documentada, não regressão:** não dá pra zerar um
   array via PATCH (`[]` é tratado como "não enviado" pelo COALESCE) — já
   era assim antes para `disciplines`, agora vale pra `quiverKites`/`quiverBoards`.
9. **Chat lento pra abrir** → **corrigido**, commit `fe81857`(chat perf, ver
   git log — foi commit separado antes do Radares, buscar
   `perf(chat): presenca nao bloqueia`). Causa real: `touchPresenceKeepingSpot`
   bloqueava a resposta do GET/POST de mensagens. Trocado por `after()` do
   Next. Índice e paginação já estavam corretos, não era isso.

## Item 5+7 — Downwind vinculado a Evento (feito)

**Premissa da sessão anterior estava errada, igual ao caso do perfil (item
8):** não existia UI de criação de evento nenhuma, em lugar nenhum — nem em
`EventsAndAlertsView.tsx` (os `Plus` de lá são "Reportar" ocorrência e "Quero
Participar", não criação de evento), nem no admin (`app/admin/` não tem tela
de eventos). O único jeito de criar um evento era `POST /api/events` direto,
`requireAdmin()`, sem front-end nenhum. `lib/authz.ts` já tinha
`canCreateOfficialEvent` e `canOrganizeDownwind` escritas e comentadas desde a
fundação (`5e224fe`), mas nenhuma rota as usava — código morto até agora.

### O que foi construído (tudo na mesma sessão, sem tocar em nada do plano
maior de mapa ao vivo em `docs/PLANO-DOWNWIND-MAPA.md`, que continua "plano,
nada implementado" — é a fase seguinte, não esta):

- **Schema:** `downwinds.event_id UUID REFERENCES events(id) ON DELETE SET
  NULL` (sem índice — única consulta prevista por `event_id` é um lookup
  avulso, não filtro recorrente). 4 checks novos em `scripts/verify-sql.ts`
  (criação vinculada, join, e o `SET NULL` ao apagar o evento). **127 checks
  SQL** (era 119 na sessão anterior, 123 depois do item 8).
- **`lib/auth.ts`:** `requireDownwindOrganizer()` — busca
  `pode_organizar_downwind` do banco e decide via `canOrganizeDownwind`
  (lib/authz.ts). Essa função e `canCreateOfficialEvent` agora estão testadas
  em `lib/authz.test.ts` (2 casos novos).
- **`POST /api/events` reescrita:** não é mais `requireAdmin()` fixo pra
  qualquer tipo. `type === 'Downwind'` exige `requireDownwindOrganizer()`
  (admin/moderator/instructor pelo role, ou rider com a liberação pontual) e,
  na mesma requisição, cria a linha em `events` **e** em `downwinds`
  (`event_id` apontando de volta, `criado_por` = quem criou, participante
  organizador inserido como `velejador` + `eh_organizador`). Os outros 3 tipos
  de evento continuam exigindo `canCreateOfficialEvent(role)` (admin/mod/
  instructor — antes só admin conseguia criar QUALQUER evento; agora
  moderador e instrutor também podem, que é o que `canCreateOfficialEvent` já
  dizia desde sempre sem ninguém checar).
- **`GET /api/auth/me` + `AuthContext`:** novo campo `canOrganizeDownwind`,
  computado no servidor com a mesma função de authz, exposto no client
  seguindo exatamente o padrão já existente de `isAdmin` (role sai do
  `profile`, vira booleano solto no contexto).
- **`KiteDataContext.createDownwind()`:** POST pro endpoint acima, padrão
  `{ok, error?}` igual `updateProfile` (não o fire-and-forget do
  `addSafetyAlert` — aqui o erro de validação precisa chegar na tela).
- **`views/EventsAndAlertsView.tsx`:** FAB "Criar Downwind" (mesma classe
  `publish-fab-bottom` do botão Publicar de `FeedView.tsx`), visível só na
  subaba Eventos e só para quem tem `canOrganizeDownwind`. Abre formulário
  com spot de saída (obrigatório, select de `spots`), spot de chegada
  (opcional), data/hora real (`datetime-local`), região, descrição. `nome`
  do downwind = título do evento.

### Decisão de design que ficou implícita e vale registrar
`events.event_date` é `TEXT` livre (nunca reparseado em lugar nenhum do app),
mas `downwinds.previsto_para` é `TIMESTAMPTZ` de verdade — não dá pra derivar
um do outro sem perder informação. A rota resolve isso pedindo uma data/hora
real (`previstoPara`, ISO) só no fluxo de Downwind, e formata o `event_date`
por extenso a partir dela (`toLocaleDateString('pt-BR', ...)`) só pra manter a
listagem genérica de eventos funcionando sem mudar `KiteEvent`/`event_date`.
Eventos não-Downwind continuam com `eventDate` texto livre, como sempre foram
— essa mudança não afeta esse caminho.

### O que NÃO foi feito (fica pra próxima, é a fase de
`docs/PLANO-DOWNWIND-MAPA.md`, não deste item)
Mapa ao vivo, posições em tempo real, carro de apoio nomeado, convites,
encerramento do downwind — nada disso tem UI ainda, só o schema e as funções
puras de `lib/downwind.ts` (já existiam antes desta sessão). O que esta
sessão fez foi só o nascimento do downwind a partir de um evento. Não achar
que "criar downwind" = "downwind funcional de ponta a ponta".

### Verificação obrigatória de qualquer mudança de schema deste projeto
```bash
node node_modules/tsx/dist/cli.mjs scripts/verify-sql.ts   # 127 verdes
node node_modules/vitest/vitest.mjs run                     # 458 verdes
node node_modules/typescript/bin/tsc --noEmit                # limpo
node node_modules/next/dist/bin/next build                   # verde
```
`npx` pega o pacote errado no Git Bash — sempre chamar `node node_modules/...`
direto. Repo é CRLF, não usar `sed -i`.

## Referências úteis já escritas nesta sessão
- `docs/PLANO-DOWNWIND-MAPA.md` — mapa ao vivo do downwind, fotos, carro de apoio.
- `docs/PLANO-CHAT-DIRETO.md` — DM/chat individual, reaproveitando `chat_messages`.
- `docs/DEBUG-TARJA-RODAPE.md` — postmortem da tarja do rodapé (resolvida,
  causa era `black-translucent` na status bar — NÃO reabrir isso sem medir
  primeiro com `components/DiagTela.tsx`).

## Item 21/08/2026 — Chat direto (DM), as 4 fases de `docs/PLANO-CHAT-DIRETO.md`

Motivado por um bug relatado pelo dono depois de testar o mapa ao vivo do
downwind em produção: "Depois resolva o chat direto" — o botão "Acenar 🤙" na
aba Online postava a saudação no chat GERAL, visível para todo mundo, quando
a intenção era mandar um recado privado só para aquela pessoa.

- **`lib/chat.ts`:** `salaDireta(idA, idB)` gera a sala canônica
  `dm:<menor>:<maior>`; `parseRoomName` reconhece o formato e REJEITA ordem
  trocada e auto-DM (não normaliza — ver comentário de `DM_ROOM_RE` no
  arquivo sobre por que aceitar as duas ordens duplicaria a conversa em duas
  strings de `room` diferentes).
- **`lib/authz.ts`:** `canAccessDm(userId, a, b)` — só os dois participantes,
  SEM bypass de moderação (diferente de `canResolveSos`/`canManageListing`:
  uma DM é conteúdo privado, não recurso de moderação).
- **`app/api/chat/messages/route.ts`:** `requireExistingRoom` autoriza
  `dm:*` via `canAccessDm` (403 — a existência do par de UUIDs não é segredo,
  só o conteúdo é).
- **`app/api/chat/dms/route.ts` (novo):** inbox de conversas diretas —
  `DISTINCT ON (room)` + `ORDER BY room, created_at DESC` (a linha mais
  recente de cada sala).
- **`views/ChatView.tsx`:** nova aba "Diretas" (inbox); "Acenar 🤙" agora abre
  `salaDireta()` de verdade; `handleSend` ganhou um `targetRoom` opcional
  para não perder a mensagem no race de `setState` ao abrir uma DM nova e
  mandar a saudação no mesmo clique.
- **`context/KiteDataContext.tsx` + `components/Header.tsx`:**
  `dmUnreadCount` separado do `unreadChatCount` do geral (cada DM tem sua
  própria "linha d'água", já que o inbox só devolve a última mensagem por
  sala); somados no badge do sino.
- **Push (Fase 4):** `sendPushToUser()` — mesmo padrão do SOS — dispara em
  DM dentro de `after()`. Chat geral/spot continuam sem push (ruído demais:
  viraria notificação para todo mundo online).
- **Achado durante a Fase 3, fora do plano original:**
  `presenceSafeRoom()` em `lib/chat.ts`. `GET /api/chat/presence` devolve o
  campo `room` de TODO MUNDO para QUALQUER usuário autenticado (é assim que
  a aba Online sempre funcionou). Sem essa função, abrir uma DM gravaria
  `dm:<a>:<b>` em `user_presence.room`, e qualquer terceiro consultando esse
  endpoint veria com quem alguém está conversando — vazamento de METADADO
  mesmo com o conteúdo já protegido por `canAccessDm`. Toda sala `dm:*` agora
  vira `null` nos dois pontos que gravam presença (heartbeat dedicado e o
  `after()` de `messages/route.ts`).

**Sem mudança de schema** (`chat_messages.room` continua `TEXT` livre, como o
plano previa) — `verify-sql.ts` continua em **164 checks** (não muda desde a
sessão anterior). `vitest` foi de 560 para **573 testes**, todos verdes,
incluindo o teste explícito de terceiro usuário negado numa sala `dm:*`
alheia (critério de aceite do plano). `tsc --noEmit` e `next build` limpos.

### O que NÃO foi feito (fora de escopo desta fase, por decisão do plano)
Sem grupos, sem editar/apagar mensagem de DM, sem "digitando...", sem
confirmação de leitura — o chat geral não tem, DM não nasce com mais recurso
que ele. O deep-link `/?tab=chat` do push (mesma convenção do SOS,
`/?tab=mapa&sos=...`) não é lido por `app/page.tsx` no carregamento — é uma
lacuna pré-existente dos dois casos de push do app, não introduzida aqui.

## Item 21/08/2026 — botão "Iniciar" do mapa normal vira registro pessoal

Pedido do dono: "Temos um botão de iniciar no mapa normal do app. Vamos
deixar ele para registro pessoal de cada velejador."

### O que existia antes desta mudança
O botão "INICIAR" de `views/MapView.tsx` (mapa geral, fora de qualquer
downwind em grupo) só abria `components/ModoNavegacao.tsx` — a tela preta com
Wake Lock que já mede distância e velocidade máxima em tempo real via
`lib/useTrilhaSessao.ts` (o mesmo hook usado no downwind). Ao sair
("Sair"), esses números eram só descartados: nenhum registro sobrevivia à
sessão. O logbook pessoal (`components/SessionLoggerModal.tsx`, aberto pelo
botão "+ Velejo" do Header) já existia, mas 100% de digitação manual —
inclusive Distância/Velocidade Máx/Salto, que tinham valores de EXEMPLO
fixos (28.4 / 26.8 / 9.2) como estado inicial dos campos, não dados reais.

### Decisão de arquitetura
Não criar uma tabela nem uma tela nova — reaproveitar o logbook que já existe
e já tem toda a validação/persistência (`POST /api/sessions`). O que faltava
era só a PONTE entre "sessão real de GPS" e "rascunho do formulário":

- **`lib/trilhaSessao.ts`** ganhou duas funções puras (testadas em
  `lib/trilhaSessao.test.ts`, 8 casos novos):
  - `valePenaRegistrarSessao(resumo)` — filtra toque acidental no botão
    Iniciar (sessão sem distância nem velocidade real) para não interromper
    a saída com um formulário vazio.
  - `paraPrefillLogbook(resumo, agora)` — converte {distanciaKm,
    velocidadeMaxNos, iniciadoEm} num rascunho {distanceKm, maxSpeedKnots,
    durationMinutes, date, startTime}. Só os campos que o GPS de fato mede —
    vento, maré, prancha, tamanho da pipa, nota da sessão e salto (exige
    acelerômetro, não GPS) continuam SEMPRE preenchimento manual, igual a
    qualquer outro registro do logbook.
- **`components/ModoNavegacao.tsx`:** `onSair` passa a receber um
  `ResumoNavegacao` (distância, velocidade máxima, instante de montagem do
  componente como aproximação de "início da sessão"). Assinatura
  retrocompatível: `views/DownwindAoVivoView.tsx` continua passando
  `onSair={() => setModoNavegacaoAtivo(false)}` sem tocar no argumento — uma
  função de zero parâmetros é atribuível a um tipo que espera um parâmetro em
  TypeScript, então nada mudou nesse outro caller.
- **`context/KiteDataContext.tsx`:** `loggerPrefill` + `abrirLoggerComResumo`
  + `limparLoggerPrefill` — seta o rascunho e abre o modal numa chamada só;
  o prefill é consumido (e apagado) assim que o modal aplica os valores, para
  uma abertura manual seguinte do "+ Velejo" não herdar dado de uma sessão
  de GPS antiga.
- **`components/SessionLoggerModal.tsx`:** ao abrir com um `loggerPrefill`
  presente, sobrescreve Distância/Velocidade Máx/Duração/Data/Horário com os
  valores reais e ZERA Salto Mais Alto (em vez de deixar o "9.2" de exemplo
  ao lado de números que agora são de verdade — mostrar um número fake ao
  lado de dado real seria pior que deixar em branco). Um banner
  "Distância, velocidade máxima... vieram do rastreamento real do Modo
  Navegação" aparece na seção de Telemetria GPS sempre que os valores vieram
  de uma sessão real, para o velejador nunca confundir com digitação manual.
- **`views/MapView.tsx`:** ao sair do Modo Navegação, chama
  `valePenaRegistrarSessao` e, se passar, `abrirLoggerComResumo`. É o único
  lugar que liga essa ponte — `DownwindAoVivoView.tsx` não foi tocado e
  continua sem criar um SessionLog automático ao sair de um downwind (aquele
  fluxo já tem seu próprio resumo por participante via
  `GET /api/downwind/[id]/resumo` / `DownwindResumoModal`; duplicar viraria
  dois registros divergentes da mesma travessia).

### Por que não é "criar sessão automaticamente"
GPS não sabe vento, maré, tamanho de pipa, prancha, nem como foi a sessão
(rating) — inventar um valor plausível para esses campos seria pior que
pedir para o velejador preencher. Por isso o fluxo continua terminando no
MESMO formulário de sempre, só que com os campos que o GPS de fato mede já
prontos — o velejador confere, completa o resto e confirma (ou fecha o X e
descarta, como sempre pôde fazer).

**Sem mudança de schema** — `verify-sql.ts` continua em **164 checks**.
`vitest` foi de 573 para **581 testes** (8 novos, todos em
`lib/trilhaSessao.test.ts`). `tsc --noEmit` e `next build` limpos.
