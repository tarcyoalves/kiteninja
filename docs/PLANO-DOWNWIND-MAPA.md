# Plano — Mapa ao vivo do Downwind

Status (21/08/2026): **implementado e commitado em 8 fases**, branch
`claude/retomar-aplicacao-d7iyr7`. Falta só publicar (rodar `migrate.ts`
contra o Neon de produção — ver aviso no fim desta seção — e fazer o deploy) e
testar no aparelho. O restante deste documento é o plano original, mantido
como referência de desenho; onde ele diverge do que foi de fato construído, a
tabela abaixo manda.

## O que mudou do plano original

O pedido do dono trouxe três decisões que este documento não previa:

1. **Entrada pelo evento, não por convite.** `downwind_convites` ficou fora de
   escopo. O ponto de entrada é o botão no card do evento tipo Downwind em
   `views/EventsAndAlertsView.tsx` — `POST /api/downwind/[id]/entrar`.
2. **Mapa ao vivo sem remover a navegação.** Enquanto o velejador participa de
   um downwind aberto/em andamento, `app/page.tsx` mostra
   `views/DownwindAoVivoView.tsx` dentro da aba Mapa. O `BottomNav` permanece
   visível e as demais abas continuam disponíveis. O beacon de posição vive em
   `context/DownwindContext.tsx`, portanto sair da aba Mapa não interrompe o
   rastreamento. O chat privado do downwind (`dw:<id>`) continua embutido no mapa
   via `components/DownwindChat.tsx`.
3. **Só a própria trilha, nunca a de terceiros.** O dono pediu trajeto no
   mapa ("marcar o trajeto de cada velejador também"), mas decidiu, depois de
   ver o trade-off de 20 trilhas cruzadas virando sopa visual, mostrar só a
   trilha de quem está olhando. Isso simplificou o transporte
   (`lib/trilhaDownwind.ts`): sem `?trilhaDe=`, sem alternância "minha/todas".

## Onde cada peça mora

| Peça | Arquivo |
|---|---|
| Schema (`apoio_user_id`, resumo, `ux_downwinds_event`) | `lib/schema.sql` |
| Autorização (404 vs 403, guarda anti-fail-open, invariante do apoio) | `lib/downwindAcesso.ts` |
| Transporte da trilha (amostragem, cursor, cauda viva) | `lib/trilhaDownwind.ts` |
| Rotas | `app/api/downwind/ativo`, `app/api/downwind/[id]/{posicoes,status,entrar,participantes/[userId]}` |
| Estado "estou num downwind agora?" | `context/DownwindContext.tsx` |
| Mapa ao vivo na aba Mapa | `views/DownwindAoVivoView.tsx` |
| Mapa (marcadores, trilha própria) | `components/DownwindMapa.tsx` |
| Faixa das 4 perguntas | `components/DownwindFaixaInfo.tsx` |
| Detalhe do participante + vínculo de apoio | `components/DownwindParticipanteSheet.tsx` |
| Chat privado do grupo | `components/DownwindChat.tsx` |
| Iniciar → Modo Navegação → volta ao mapa | `components/ModoNavegacao.tsx` (props novas) |

**ATENÇÃO PARA O DEPLOY:** o schema ganhou 4 colunas e um índice UNIQUE.
Rodar `migrate.ts` contra o Neon de **produção** antes de publicar qualquer
código desta feature — verde no `verify-sql.ts` (149 checks) só prova
coerência interna, não que o banco real foi atualizado. Ver o incidente
documentado em `docs/PENDENCIAS-20-08-2026.md` (item "INCIDENTE"). Antes de
criar `ux_downwinds_event`, confirmar que não há dois downwinds com o mesmo
`event_id` em produção:
```sql
SELECT event_id, COUNT(*) FROM downwinds
 WHERE event_id IS NOT NULL GROUP BY event_id HAVING COUNT(*) > 1;
```

## Fora de escopo (não foi feito)

Push "avisar meu apoio", convite por link (`downwind_convites`), trilha de
terceiros/alternância "minha/todas" (decisão explícita do dono, ver acima),
agrupamento de marcadores sobrepostos, amostragem por Douglas-Peucker (a
amostragem por módulo em SQL já é suficiente para o volume de pontos de uma
travessia).

---

## Plano original (referência de desenho)

Público deste documento: um agente ou desenvolvedor que vai implementar isto sem
ter participado das conversas anteriores. Tudo que você precisa saber está aqui
ou apontado daqui.

---

## O que o velejador precisa de verdade

Um downwind é uma travessia de ponto A a ponto B ao longo da costa, em grupo, de
1 a 3 horas. O grupo **se espalha** — os mais rápidos abrem vantagem de
quilômetros. Não é um passeio em formação.

As perguntas que realmente aparecem na água são quatro, e todas são de segurança
ou de logística, nenhuma é de sociabilidade:

1. **"Cadê o pessoal?"** — Estou muito à frente? Muito atrás? Devo esperar?
2. **"Alguém ficou para trás?"** — A pergunta que a feature existe para
   responder. Alguém parado há 20 minutos pode ter quebrado equipamento.
3. **"Cadê o MEU carro?"** — Num downwind com 12 pessoas e 3 carros de apoio,
   saber qual dos três é o seu não é detalhe: é o carro que tem suas chaves, sua
   água, sua roupa, e é quem vai te buscar. Hoje isso se resolve no grito e no
   WhatsApp.
4. **"Onde eu consigo parar?"** — Cansou, rasgou a vela, o vento caiu. Precisa
   sair na praia num ponto onde o apoio consiga chegar.

Isso define o desenho: **não é "ver amiguinhos no mapa".** É um instrumento de
travessia. Cada elemento na tela tem que responder uma dessas quatro perguntas
ou não entra.

---

## Decisão central: o mapa é privado ao downwind

**Só quem é participante de um downwind vê as posições daquele downwind.**

Isto é rastreamento de pessoas em tempo real. Não pode vazar para o app inteiro,
não pode aparecer no mapa geral, não pode ser consultado por quem não está na
travessia.

Regras concretas, que a rota **precisa** aplicar no servidor (nunca só no
cliente):

- O solicitante tem que ter linha em `downwind_participantes` para aquele
  `downwind_id`. Sem isso, **404** — não 403. Um 403 confirmaria que o downwind
  existe, e isso já é informação sobre onde um grupo está navegando.
- Posições só são servidas enquanto o downwind está `em_andamento`. Downwind
  `aberto` (ainda não começou), `encerrado` ou `cancelado` não devolve posição de
  ninguém.
- Quem está em estado `encerrado` ou `desistiu` **para de ter a posição
  compartilhada**. Já saiu da água; continuar transmitindo seria vigiar a pessoa
  no caminho de casa.
- Moderação (`admin`/`moderator`) **não** ganha acesso automático aqui. O SOS tem
  essa exceção porque é socorro; um downwind em andamento não é emergência.
  Se virar emergência, o caminho é o SOS, que já tem suas próprias regras.

Existe precedente no projeto: `app/api/sos/active/route.ts` tem uma função
`canSeePos` que decide quem enxerga coordenada. **Leia antes de escrever a sua** —
o espírito é o mesmo, mas as regras não são idênticas.

---

## Decisão central: cada velejador tem um carro de apoio nomeado

Esta é a parte com maior retorno prático e a que não existe em nenhum app
concorrente conhecido.

Hoje `downwind_participantes.papel` é `'velejador' | 'apoio_terra'`. Falta o
vínculo entre os dois: **qual motorista apoia qual velejador.**

Proposta de schema (detalhes na seção Schema): uma coluna `apoio_user_id` em
`downwind_participantes`, apontando do velejador para o motorista dele.

Por que isso importa na tela:
- O marcador do **seu** carro é visualmente distinto dos outros carros. A
  pergunta "qual desses três é o meu?" tem que ser respondida de relance, sem
  clicar.
- A **distância até o seu carro** é a informação mais útil quando você decide
  parar.
- Permite "avisar meu apoio" ser um push para **uma** pessoa, e não um grito
  para o grupo todo.

Um motorista pode apoiar vários velejadores. Um velejador tem no máximo um carro
de apoio. Velejador sem apoio designado é válido (nem todo downwind organiza
isso) — a UI simplesmente não mostra o destaque.

---

## Schema

Tudo em `lib/schema.sql`, seguindo as convenções que já estão lá: `CREATE TABLE
IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, enums via `CHECK (col
IN (...))` e nunca tipo ENUM do Postgres, coordenadas em `NUMERIC(9,6)`.

### Vínculo de apoio

```sql
ALTER TABLE downwind_participantes
  ADD COLUMN IF NOT EXISTS apoio_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
```

`ON DELETE SET NULL` e não CASCADE: se a conta do motorista for apagada, o
velejador continua no downwind, só fica sem apoio designado.

**Invariante que a FK NÃO garante e a aplicação PRECISA validar:**
o `apoio_user_id` tem que ser um usuário que é participante **do mesmo
downwind** e com `papel = 'apoio_terra'`. Uma FK simples só garante que o usuário
existe. Valide na rota e cubra com teste — apontar para alguém de outro
downwind, ou para outro velejador, tem que ser rejeitado.

Considere também rejeitar `apoio_user_id = user_id` (apoiar a si mesmo).

### Índice

Avalie se vale um índice para "quais velejadores eu apoio":

```sql
CREATE INDEX IF NOT EXISTS idx_downwind_part_apoio
  ON downwind_participantes (downwind_id, apoio_user_id)
  WHERE apoio_user_id IS NOT NULL;
```

Justifique a escolha. Lembre-se de que a tabela é pequena por downwind (dezenas
de linhas), então índice pode ser desnecessário — não adicione por reflexo.

### `scripts/verify-sql.ts` é obrigatório

Todo SQL novo **precisa** ganhar blocos correspondentes lá. O script roda contra
PGlite (Postgres real em processo) e hoje tem 119 checks. Adicione:

- `expectOk` do caminho feliz: velejador com `apoio_user_id` apontando para um
  `apoio_terra` do mesmo downwind.
- `expectOk` da query principal do mapa (última posição de cada participante,
  com join em `users` para nome e avatar).
- Teste de que apagar o usuário do motorista deixa `apoio_user_id` NULL sem
  remover o velejador.

---

## Rotas de API

Siga o padrão do projeto sem inventar outro: `export async function GET(request,
context) { return handle(async () => { ... }) }`, com `requireUser()` de
`lib/auth.ts` e validação via `lib/validation`. Leia
`app/api/sos/[id]/route.ts` inteiro como referência de rota idiomática.

### `GET /api/downwind/[id]/posicoes`

O coração da feature. Devolve a última posição de cada participante ativo.

Autorização: aplicar integralmente as regras da seção "o mapa é privado ao
downwind". Comece por elas, antes de qualquer query de posição.

A query central usa o índice que já existe
(`idx_downwind_posicoes_user_tempo`):

```sql
SELECT DISTINCT ON (p.user_id) p.user_id, p.lat, p.lng, p.accuracy_m, p.registrado_em
FROM downwind_posicoes p
WHERE p.downwind_id = $1
ORDER BY p.user_id, p.registrado_em DESC
```

Junte com `downwind_participantes` (papel, estado, eh_organizador,
apoio_user_id) e `users` (nome, avatar_url).

Resposta sugerida por participante:

```ts
{
  userId: string;
  nome: string;
  avatarUrl: string | null;
  papel: 'velejador' | 'apoio_terra';
  ehOrganizador: boolean;
  estado: 'confirmado' | 'navegando' | 'encerrado' | 'desistiu';
  lat: number | null;          // null se nunca reportou
  lng: number | null;
  registradoEm: string | null; // ISO
  ehMeuApoio: boolean;         // calculado no servidor para o solicitante
  souApoioDele: boolean;       // o inverso, para a tela do motorista
}
```

Calcule `ehMeuApoio`/`souApoioDele` **no servidor**. O cliente não deveria
precisar montar esse cruzamento, e deixar isso no servidor evita divergência
entre as duas telas.

Não devolva `estadoSinal` pronto: o cliente deriva com `estadoSinal()` de
`lib/downwind.ts` a partir de `registradoEm`. Assim o indicador continua correndo
entre um poll e outro, em vez de ficar congelado no valor do último fetch.

### `POST /api/downwind/[id]/posicoes`

Recebe a posição do próprio usuário. Valida lat/lng com os helpers de
`lib/validation` (o padrão `num(payload, 'lat', { min: -90, max: 90 })` já existe
em `app/api/chat/presence/route.ts`).

Rejeite se o downwind não estiver `em_andamento` ou se o participante estiver
`encerrado`/`desistiu` — senão a tabela cresce com dados que ninguém pode ver.

**Atenção ao volume.** Esta é a tabela que mais cresce: ~20 participantes × 3h ×
1 ponto/40s ≈ 5.400 linhas por evento. Como tudo roda em **Neon free**, a
retenção é obrigatória e a limpeza tem que ser preguiçosa (não há cron na Vercel
Hobby). Ver a seção "Restrição de projeto: tudo roda em plano gratuito" antes de
implementar esta rota.

### `PATCH /api/downwind/[id]/participantes/[userId]`

Define o `apoio_user_id`. Quem pode: o próprio velejador (escolhe seu apoio) e o
organizador (designa por todos). Aplique a validação de invariante descrita no
schema.

### Opcional — `POST /api/downwind/[id]/avisar-apoio`

Push para o motorista designado ("preciso parar"). Use `sendPushToUser` de
`lib/push.ts`. **Só implemente depois que o resto estiver funcionando.**

---

## Interface

### Marcadores no mapa

O projeto já cria marcadores customizados com `L.divIcon` renderizando React —
veja `createSpotIcon` e `createUserLocationIcon` em `components/LeafletMap.tsx`.
**Siga esse padrão**, não introduza uma biblioteca de marcadores.

**Velejador:** foto circular de `users.avatar_url`. Quando não houver foto,
iniciais do nome sobre cor derivada do `userId` (determinística, para a mesma
pessoa ter sempre a mesma cor). Anel colorido em volta indicando o estado de
sinal, via `estadoSinal()`: normal, atrasado, sem sinal. Quem está sem sinal
aparece esmaecido — está mostrando a **última posição conhecida**, não a atual, e
a tela não pode sugerir o contrário.

**Apoio em terra:** ícone de carro, visualmente distinto de uma foto de pessoa —
diferente de relance, não só na cor. **O seu carro** ganha destaque forte
(tamanho maior, anel de cor própria, e um rótulo curto tipo "SEU APOIO"). Essa é
a resposta à pergunta 3 e precisa funcionar sem clicar e sem ler.

**Organizador:** marca discreta (uma coroa pequena, um ponto). É informação
secundária — não pode competir com o estado de sinal, que é o que importa para
segurança.

### Ao clicar

Popup ou painel inferior (o projeto já tem `SpotDetailModal` e o card do mapa
como referência de estilo) com:

- nome e foto maior
- papel e se é organizador
- **há quanto tempo reportou** — em destaque, é o dado de segurança
- distância até você
- se for seu apoio: rótulo claro
- se for velejador e você for o apoio dele: rótulo inverso

### Informação fixa útil, sem clicar

Uma faixa compacta com o que responde as quatro perguntas:

- quantos ainda estão na água (reaproveite `velejadoresPendentes` de
  `lib/downwind.ts`)
- **quem está mais atrás** — quem corre mais risco de ficar para trás. Calcule
  por progresso na rota (`progressoDownwind` em `lib/downwind.ts` já existe)
- **distância até o seu carro de apoio**
- quantos estão sem sinal

### Atualização

Polling, porque **o projeto não tem realtime nenhum** — nem WebSocket, nem SSE.
O `ChatView` faz polling de 4s e é a referência de como fazer isso direito:
`setInterval` que **pausa quando `document.hidden`** (`views/ChatView.tsx`,
efeito por volta da linha 306).

Para o mapa, 30-60s é a cadência combinada com o dono. Não copie os 4s do chat —
posição custa GPS e bateria, mensagem não.

---

## Restrição de projeto: tudo roda em plano gratuito

**Neon free, Vercel Hobby, GitHub free.** Isso não é detalhe de custo — é
restrição de arquitetura, e esta feature é justamente a que mais pressiona os
três limites. Decida com isso em mente desde o começo, não depois.

### Storage do Neon — `downwind_posicoes` é a tabela que ameaça o limite

É a única tabela do projeto com crescimento sério: ~20 participantes × 3h × 1
ponto/40s ≈ **5.400 linhas por downwind**. A ~100 bytes por linha com overhead,
são ~540 KB por evento. Poucos downwinds por semana e a trilha passa a dominar o
banco inteiro — todas as outras tabelas juntas são pequenas perto disso.

Por isso a **retenção é obrigatória, não opcional** (o texto acima dizia
"considere"; com plano free, decida e implemente):

- Apagar trilha de downwinds `encerrado`/`cancelado` depois de N dias. Sugestão:
  7 dias, tempo de sobra para revisar a travessia e gerar um resumo.
- Se quiser preservar o histórico da travessia, guarde um **resumo** (distância,
  duração, velocidade máxima, e talvez uma trilha reduzida por amostragem) e
  descarte os pontos brutos. Um resumo é uma linha; a trilha é milhares.
- **Não existe cron no plano free da Vercel.** A limpeza tem que ser preguiçosa,
  disparada por quem consulta — exatamente o padrão que
  `app/api/sos/active/route.ts` já usa para a escalada de raio do SOS. Leia como
  está feito lá e siga; o comentário no arquivo explica o porquê.

Considere também reduzir a cadência de gravação: um ponto a cada 60s em vez de
40s corta a tabela em um terço, com perda pequena de fidelidade para o que a
feature precisa responder.

### Invocações da Vercel

Polling de 20 participantes por 3 horas, a cada 30s, dá ~7.200 invocações **por
downwind**. A 60s, cai pela metade. Duas implicações de desenho:

- **Um único `GET /posicoes` devolve todo mundo.** Nunca uma requisição por
  participante — isso multiplicaria a conta pelo tamanho do grupo.
- O polling **precisa** pausar com `document.hidden`, como o `ChatView` já faz.
  Sem isso, celular no bolso continua consumindo invocação e bateria à toa.
- Funções serverless no Hobby têm timeout curto (~10s). A query do mapa é
  indexada e rápida, mas não empilhe trabalho pesado nela.

### Cold start do Neon

O free tier suspende o banco após inatividade. A **primeira** consulta depois de
um tempo parado demora visivelmente. A tela do mapa precisa de estado de
carregamento honesto na primeira carga — e não interpretar lentidão inicial como
"sem sinal", o que seria um falso alarme logo na abertura.

---

## Armadilhas deste projeto (leia antes de codar)

- **CRLF.** O repo é CRLF. `sed -i` converte o arquivo inteiro para LF e o diff
  explode para milhares de linhas. Use as ferramentas de edição.
- **`npx` pega o pacote errado no Git Bash.** Chame direto:
  `node node_modules/typescript/bin/tsc --noEmit`,
  `node node_modules/vitest/vitest.mjs run`,
  `node node_modules/tsx/dist/cli.mjs scripts/verify-sql.ts`,
  `node node_modules/next/dist/bin/next build`.
- **Branch é `main`.** O fluxo antigo com `master` está morto — ele criava um
  deployment de preview a cada push, e era a origem da "bolinha" da Vercel.
- **Leaflet é client-only.** Já é carregado com `dynamic(..., { ssr: false })` em
  `views/MapView.tsx`. Não quebre isso.
- **A tarja do rodapé iOS.** `--nav-h` é publicado por `components/BottomNav.tsx`
  e qualquer overlay de tela cheia pode fazê-lo congelar, deixando faixa vazia
  embaixo. Já foi corrigido (commit `a4ae216`) fazendo o valor ser republicado em
  `resize`/`orientationchange`/`visualViewport`. Se aparecer faixa escura no
  rodapé, **verifique `--nav-h` antes de mexer em qualquer outro CSS.**
- **`podeEncerrarDownwind` é fail-open** com lista vazia. Qualquer rota que
  encerre downwind tem obrigação de garantir que a lista de participantes foi
  realmente carregada. Está documentado no próprio `lib/downwind.ts`.
- **iOS PWA não roda GPS em segundo plano.** É por isso que existe o Modo
  Navegação (`components/ModoNavegacao.tsx`), tela preta com Wake Lock. O mapa do
  downwind vai ter as mesmas limitações: se o velejador não estiver com o app em
  primeiro plano, a posição dele **não atualiza**. A tela precisa ser honesta
  sobre isso — mostrar "há X min" e esmaecer, nunca fingir que a posição é atual.
- **Não duplicar lógica de SOS.** `lib/useSosHold.ts` encapsula o disparo
  inteiro. Se precisar de SOS nesta tela, use o hook.

---

## Fases sugeridas

1. **Schema + verify-sql.** `apoio_user_id`, validação de invariante, checks.
   Não depende de mais nada.
2. **`GET /posicoes` + `POST /posicoes`**, com a autorização completa e testes de
   quem pode e quem não pode ver. **A autorização é a parte crítica desta fase** —
   escreva os testes de negação primeiro.
3. **`PATCH` do vínculo de apoio**, com validação de invariante.
4. **Marcadores no mapa**: foto, carro, estados de sinal, destaque do seu apoio.
5. **Popup de detalhes** e a faixa de informação fixa.
6. **Opcional:** avisar apoio por push; trilha (rastro dos últimos pontos);
   agrupamento de marcadores sobrepostos quando o grupo está junto.

## Critérios de aceite

- `node node_modules/tsx/dist/cli.mjs scripts/verify-sql.ts` verde, com contagem
  **maior** que os 119 atuais.
- `node node_modules/vitest/vitest.mjs run` verde, com testes novos cobrindo:
  negação de acesso por não-participante, invariante do `apoio_user_id`, e a
  regra de não servir posição de quem já encerrou.
- `node node_modules/typescript/bin/tsc --noEmit` limpo.
- `node node_modules/next/dist/bin/next build` verde.
- Um não-participante recebe **404** ao consultar posições — verificado por
  teste, não por inspeção.
