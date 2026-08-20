# Pendências — sessão de 20/08/2026 (continuar aqui)

Lista original do dono, 9 itens. Status real de cada um, para quem continuar
não repetir investigação.

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
