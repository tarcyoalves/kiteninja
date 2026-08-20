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
5. **Downwind devia nascer em Eventos** → **NÃO FEITO. Próximo passo.** Ver
   seção dedicada abaixo — já tem toda a especificação, só falta executar.
6. **Só radar GFS** → **corrigido**, commit `3dfeccc`. `lib/multiModel.ts`
   deletado (só existia pro blend), `lib/weather.ts` busca só `gfs_seamless`,
   card de comparação de 3 modelos removido de `SpotDetailModal.tsx`.
7. **Criar DW no menu flutuante** → depende do item 5, não feito.
8. **Editar perfil (peso/altura/kite)** → **EM ANDAMENTO**, agente em
   background construindo agora (schema `height_cm`, rota
   `app/api/users/me`, `views/PerfilView.tsx`, entrada no `SidebarDrawer.tsx`
   — já visível no drawer: import `UserCog` adicionado). **Se a sessão
   cortar aqui: rode `git status` e `git diff` para ver o que o agente já
   escreveu, rode as 4 verificações (`tsc`, `vitest`, `verify-sql.ts`,
   `next build`), revise e commite se estiver verde.**
9. **Chat lento pra abrir** → **corrigido**, commit `fe81857`(chat perf, ver
   git log — foi commit separado antes do Radares, buscar
   `perf(chat): presenca nao bloqueia`). Causa real: `touchPresenceKeepingSpot`
   bloqueava a resposta do GET/POST de mensagens. Trocado por `after()` do
   Next. Índice e paginação já estavam corretos, não era isso.

## PRÓXIMO PASSO — item 5+7, Downwind vinculado a Evento

Decisão já tomada com o dono: **`downwinds` continua tabela própria (já em
produção desde `5e224fe`), ganha uma FK pra `events`.** Não virar um "tipo de
evento" dentro da tabela `events` — são tabelas separadas, vinculadas.

Fluxo: organizador cria um evento normal (já existe UI de criação em
`views/EventsAndAlertsView.tsx`, procure pelos `Plus` nas linhas ~108 e ~325).
Dentro do evento, ativa "modo downwind", que cria a linha em `downwinds` com
`event_id` apontando pro evento.

### Schema
```sql
ALTER TABLE downwinds ADD COLUMN IF NOT EXISTS event_id UUID
  REFERENCES events(id) ON DELETE SET NULL;
```
`SET NULL`, não `CASCADE`: apagar o evento não pode arrastar a trilha de
segurança do downwind (mesmo raciocínio já usado em `criado_por`, ver
`docs/PLANO-DOWNWIND-MAPA.md`). Adicionar check em `scripts/verify-sql.ts`.

### Ponto de entrada no menu flutuante
O dono pediu "colocar a criação de DW no menu flutuante também" — o padrão de
FAB já existe em `views/FeedView.tsx` (botão Publicar) e foi replicado em
`views/MapView.tsx` (botão do Modo Navegação, ver commit `7c8802a` pra copiar
o padrão exato de posicionamento sem cobrir o menu inferior). Local mais
natural: dentro de `views/EventsAndAlertsView.tsx`, perto da criação de evento
já existente — ativar "modo downwind" no momento de criar o evento, ou logo
depois, num evento já criado.

**ATENÇÃO — CONFLITO DE ARQUIVO:** `lib/schema.sql` e `scripts/verify-sql.ts`
só devem ser tocados por UM agente/sessão por vez. Se o item 8 (perfil) ainda
não tiver terminado/commitado quando você for mexer nisso, espere ou confira
`git diff` desses dois arquivos antes de editar — dois agentes escrevendo ao
mesmo tempo no mesmo arquivo corrompe o trabalho um do outro.

### Verificação obrigatória de qualquer mudança de schema deste projeto
```bash
node node_modules/tsx/dist/cli.mjs scripts/verify-sql.ts   # deve subir de 119
node node_modules/vitest/vitest.mjs run                     # 450+ verdes
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
