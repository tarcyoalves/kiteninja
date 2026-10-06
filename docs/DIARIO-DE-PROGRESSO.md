# Diário de progresso

Registro cronológico de **tudo** que foi feito no KiteNinja — por pessoa ou por
agente. Regra do dono: *"sempre coloque no histórico de progresso ou diário"*.

## Como registrar

- **Toda sessão de trabalho termina com uma entrada aqui.** Sem entrada, o
  trabalho não está terminado.
- Agente trabalhando em paralelo **não edita este arquivo** (três agentes
  escrevendo no fim do mesmo arquivo geram conflito na junção). Ele cria
  `docs/diario/AAAA-MM-DD-<tarefa>.md` com o modelo abaixo, e quem junta o
  trabalho resume aqui com o link.
- Escreva o que um leitor sem contexto precisa: o que mudou, por quê, como foi
  verificado, o que ficou pendente. Commit sempre citado pelo hash.

### Modelo de entrada

```markdown
## AAAA-MM-DD — <título curto>
**Quem:** <pessoa ou agente/modelo> · **Tarefa:** <ID do plano, se houver>
**Commits:** `abc1234`, …

- O que mudou e por quê (a evidência que motivou).
- Como foi verificado (testes, contraprova, comandos).
- Impacto nos planos gratuitos (Neon / Vercel / GitHub), se houver.
- Pendências e decisões que ficaram para o dono.
```

---

## 2026-10-05 — Auditoria completa, senha, painel admin, segurança
**Quem:** Claude (Opus, orquestrador) · **Tarefa:** pedido do dono
**Commits:** `671e52e`, `5ec6998`, `34344ed`, `89a91b7`

- **Redefinição de senha "não prestou":** cinco defeitos, provados rodando as
  rotas reais contra PGlite — o "Esqueci minha senha" matava o link do admin,
  login seguia bloqueado após redefinir, o limitador contava login correto, a
  tela dizia 6 caracteres e o servidor 10, e o link nascia fora da tela no
  celular. Ver `docs/REDEFINIR-SENHA-NAO-PRESTOU.md`.
- **Segurança:** Next 16.3.1 → 16.3.8 (três alertas críticos de RCE). Críticas
  1 → 0 no `npm audit`.
- **Painel admin:** as 10 rotas testadas contra Postgres como admin, velejador e
  anônimo. Conta suspensa não entra mais; id inválido dá 400 e não 500.
- **Ferramenta nova:** `test/rotasComPglite.ts` — rotas reais contra Postgres em
  memória, com cookie de sessão.
- **Plano:** `docs/PLANO-AGENTES-2026-10.md`, 17 tarefas.
- **Verificação:** 1138 testes, contraprova de cada teste novo, tsc, eslint 0
  erros, verify-sql 319/0, verify-sos 59/0, build exit 0. CI verde em tudo
  exceto o job Android (T02 — ambiente, não código).
- **Pendente com o dono:** T03 (apagar projeto Vercel `kiteninja1`), T16
  (domínio), T08 (conta de e-mail), T11 (decisão de desenho do downwind).

## 2026-10-05 — Três agentes Sonnet em paralelo: SOS, dados/plataforma, painel admin
**Quem:** 3 agentes (Sonnet), cada um num worktree isolado; integração por
Claude (Opus, orquestrador) · **Tarefas:** T01, T02, T04, T05, T07, T09, T10, T12, T15
**Commits:** `5ee5317` (T02), `a928a56` (T01), `994ea33` (T04), `e8fbfbc` (T12),
`6343780` (T05), `91e1f42` (T15), `305f78b` (integração A+B), `3bc716d` (T09),
`ee56790` (T10), `e907b17` (T07)

Entradas detalhadas de cada agente:
[T01](diario/2026-10-05-T01.md) ·
[T04/T05/T12/T15](diario/2026-10-05-T04-T05-T12-T15.md) ·
[T07/T09/T10](diario/2026-10-05-T07-T09-T10.md)

- **Como foi feito sem quebrar nada:** cada agente com lista fechada de arquivos,
  sem push. Integração por cherry-pick, **um agente por vez**, com verificação
  completa depois de cada um; duas contraprovas refeitas pelo orquestrador (trava
  do SOS; token de senha fora da auditoria, inclusive escondido em campo de nome
  inocente) — ambas vermelhas como deviam.
- **T01 — SOS:** a escalada pega carona no polling de `/api/sos/active` (no máximo
  1×/min no app inteiro, trava em memória + trava atômica no banco, sem atrasar a
  resposta), o cron também anota, e o painel mostra "última varredura há X min".
- **T04/T12:** posições do link de apoio apagadas 24 h após o link vencer; sessões
  de login vencidas apagadas. Uma vez por hora por instância, só pegando carona.
- **T05:** 5 cabeçalhos de segurança. Na integração saíram `camera=()` e
  `microphone=()` — o próprio agente registrou não ter verificado o envio de foto
  num Android real; o ganho era quase nenhum e o risco era quebrar foto.
- **T07/T09/T10 — painel admin:** toda ação que muda algo fica registrada (aba
  Auditoria; token e URL de senha nunca entram); lista de velejadores atualiza a
  cada 60 s e só com a aba visível (antes: 12 s, sempre); nenhuma falha silenciosa.
- **T15:** `data/mockSpots.ts` → `data/spotsCatalogo.ts`.
- **T02 — CI Android:** sem a action de terceiro; runners fixos em ubuntu-24.04.
  **Ainda não validado:** os runs depois do push foram cancelados com "The job was
  not acquired by Runner of type hosted" — falha de capacidade do GitHub (Lint e
  SQL rodaram no mesmo run). Próximo push na `main` valida.
- **Conflito de integração resolvido:** `AdminDashboard.tsx` (A e C acrescentaram
  componentes) e um teste do A que passou a contar o trabalho adiado do login do B.
- **Verificação final:** 1167 testes, tsc, eslint 0 erros, verify-sql 319/0,
  verify-sos 59/0, build exit 0.
- **Planos gratuitos:** nenhum polling novo, nenhum cron novo, nenhuma
  dependência nova. Painel admin: de 7.200 recargas/dia com a aba esquecida aberta
  para zero. **Correção importante ao plano:** agendador externo a cada 1 min
  esgotaria a computação gratuita do Neon (ver T01b no plano).
- **Pendente com o dono:** decidir o agendador do SOS (recomendação: só a carona,
  e olhar o consumo no painel do Neon na primeira semana); T03; T08; T11; T16;
  testar num Android real o envio de foto e o painel novo.

## 2026-10-05 (noite) — Produção no ar; GitHub Actions fora do ar
**Quem:** Claude (Opus, orquestrador) · **Tarefa:** acompanhamento pós-integração

- **Produção:** `40787d1` (todo o trabalho de hoje) está READY na Vercel, no
  projeto `kiteninja`, alvo produção. A carona da escalada do SOS (T01) está no ar.
- **GitHub Actions em "major outage"** (githubstatus.com, ~20h45 UTC). Os runs do
  CI ficam na fila e os jobs são cancelados com "The job was not acquired by Runner
  of type hosted". No run de `40787d1`, Testes e Lint passaram; TypeScript e SQL
  foram cancelados pela instabilidade; o job Android não chegou a rodar.
  **T02 continua sem validação** — não por falha do código.
- **A varredura do SOS pelo GitHub Actions também parou** (última às 17:04 UTC),
  pelo mesmo motivo. É exatamente o cenário que a T01 cobre: com a carona no
  polling, a escalada não depende do GitHub enquanto alguém tiver o app aberto.
- **Para o dono, quando o GitHub voltar:** abrir o último run do CI em
  github.com → Actions e clicar em "Re-run all jobs" para validar a T02 (este
  ambiente não tem permissão para re-executar). Ou simplesmente o próximo push na
  `main` valida.

---

## 2026-10-06 — Análise de UX mobile, tela por tela
**Quem:** Claude (Opus) · **Tarefa:** pedido do dono ("nova análise geral em
cada funcionalidade e na parte visual de móbile")
**Commits:** `9ac4480`

- **Como foi feito:** o app rodou localmente com um banco em memória (PGlite)
  semeado com dados fictícios (5 velejadores, velejos com trilha, downwind,
  chat, anúncios, alerta) e foi fotografado com Chromium em 390×844 (celular),
  como velejador e como admin — ~30 telas, com detector de overflow
  horizontal. Esse modo de preview **não foi commitado** (ver U10 no plano).
- **Corrigido (defeitos sem decisão de produto):**
  - Datas cruas no feed, alertas, eventos e Diário ("Mon Oct 05 2026 23:58:21
    GMT+0000 (Coordinated Universal Time)"). Causa: `String(Date)` nas rotas.
    Agora ISO na API e "há 46 min" / "06/10/2026" na tela.
  - "Registrar Velejo" nascia com 28,4 km, 50 km/h, salto 9,2 m, vento 20 e
    rajada 26. Quem não apagava publicava um velejo que não aconteceu (e
    entrava no ranking). Medições agora começam vazias.
  - Título do cabeçalho empurrava o avatar para fora da tela; títulos
    "Diário" e "Spots" alinhados à barra inferior.
  - Conta nova abria a Home em "Favoritos (0)" com "Nenhum spot encontrado
    com estes filtros". Agora abre em Todos quando não há favoritos.
  - "Maré: •" vazio no card do Diário; placeholder da busca que cortava.
- **Verificado:** teste de rota contra PGlite (`lib/datasNasRotas.test.ts`) com
  contraprova — com `String()` de volta ele falha mostrando exatamente o texto
  visto no celular; trava do formulário (`lib/registroVelejoSemValoresFicticios.test.ts`)
  reprova 11/11 no código antigo. tsc, eslint 0 erros, vitest 1183/1183,
  verify-sql 319/0, verify-sos 59/0, build exit 0. Telas recapturadas depois.
- **Planos gratuitos:** nenhum impacto (sem consulta nova, sem cron, sem
  dependência).
- **Para o dono decidir:** itens U01–U10 em `docs/PLANO-AGENTES-2026-10.md`
  (dois modais seguidos na primeira abertura, faixa "Radar Pro ATIVO" que não
  corresponde a nada, abas "Comunidade" dentro de "Comunidade" no feed, etc.).

---

## 2026-10-06 — U01–U10 executados ("Faça tudo")
**Quem:** Claude (Opus) · **Tarefa:** U01–U10 do plano
**Commits:** `3d6c8c6`

- **O que mudou:** primeira abertura sem o convite de instalação (U01); faixa
  "Radar Pro" fictícia removida (U02); subabas do feed "Todos / Seguindo" (U03);
  card de spot com nome inteiro e local legível (U04); rótulos do downwind que
  separam "confirmar presença" de "entrar na água" (U05); avatar redundante do
  topo removido para quem está logado (U06); selos "Novo" que somem após o
  primeiro toque (U07); anúncio sem foto sem quadrado preto (U08); e
  `npm run dev:preview` (U10). Detalhes por item na tabela do plano.
- **Correções de rota ao executar:**
  - U05: a contagem de confirmados **já batia** com a própria lista; o problema
    real eram dois botões que pareciam sinônimos. Juntá-los mudaria quórum e
    SOS, então só os rótulos mudaram.
  - U09: verificado na tela que não é defeito; nada foi alterado.
  - U04: o botão de bússola era o único elemento focável do card; ao tirá-lo,
    o card virou botão acessível (Enter/Espaço) para não perder acesso por
    teclado e leitor de tela.
  - U10: a primeira tentativa (alias do Turbopack) não funciona — o Next
    resolve `@/` pelo tsconfig antes do alias. Ficou um `require` atrás de
    `NODE_ENV === 'development'`, que o build elimina.
- **Verificado:** telas recapturadas a 390×844 (1ª carga sem convite, 2ª com;
  selo do Mapa some após o toque; cards, downwind, anúncios, feed). Build de
  produção sem nenhum `.js` contendo o preview; contraprova sem a condição o
  levou a dezenas de rotas. Novos testes: `lib/seloNovo.test.ts`,
  `lib/dbPreviewForaDaProducao.test.ts` (contraprovado). tsc, eslint 0 erros
  (avisos 139 → 138), vitest 1188/1188, verify-sql 319/0, verify-sos 59/0,
  build exit 0.
- **Planos gratuitos:** nenhum impacto. O preview roda só na máquina de quem
  desenvolve e não toca Neon nem Vercel.
- **Pendente para o dono:** velejos já gravados com os valores fictícios do
  formulário antigo (28,4 km / 50 km/h / salto 9,2 m) continuam no banco de
  produção — este ambiente não tem acesso a ele para contar. Também seguem
  T02 (validar CI), T03, T08, T11 e T16.

---

## 2026-10-06 — Três agentes Sonnet: dependências, testes de fluxo, lint
**Quem:** 3 agentes Sonnet em worktrees isolados; integração por Claude (Opus)
· **Tarefa:** T06, T13, T14 — pedido do dono: "Adiante algum serviço com agentes"
**Commits:** T06 `0d2fd06` `8f63782` `c86159e` · T14 `a0d4140` `90f5dd4` ·
T13 `9e7c682` `6c3fae4` `2fed5ec` `4c2c7e3` `0abc2c3` `df6f30a` · correções
`333f57f` · consulta para o dono `d984b8e`

- **T06 (dependências)** — `npm audit --omit=dev`: 1 crítica / 4 altas / 6
  moderadas → 1 crítica / 0 altas / 2 moderadas. `npm audit fix` sem `--force`
  + `firebase-admin` 14.3.0 → 14.5.0 (mesma versão principal). Conferido na
  integração: lock continua v3, `next` igual, nenhum pacote nativo por
  plataforma perdido (swc, sharp, lightningcss, oxide). Diário do agente:
  `docs/diario/2026-10-06-T06.md`.
  - **Para o dono decidir:** `@capacitor/android` 8.5.0 tem falha crítica
    (GHSA-rvm3-566m-v7fv) que só vale dentro do APK. A correção (8.5.2) foi
    tentada pelo agente e negada pelo controle de permissões da sessão; não
    foi refeita por outro caminho. Precisa de autorização e de um APK novo.
    Ver `docs/DEPENDENCIAS-ALERTAS.md`.
- **T14 (lint)** — avisos 138 → 40 (39 depois da integração), 0 erros. Só
  nomes, imports e cálculos mortos. Revisado na integração, um por um, o que
  podia mudar comportamento: efeito do feed (dispara nos mesmos momentos), o
  vigia do chat (agora também reinicia ao trocar de conta direto — correto),
  `useMemo` removidos (puros, sem leitor), `sw.js` (só um comentário; o
  navegador rebaixa o service worker uma vez). Os 31 `<img>` ficaram: todos
  são imagem de usuário ou remota. Diário: `docs/diario/2026-10-06-T14.md`.
- **T13 (testes de comportamento)** — 4 arquivos novos pelas rotas reais
  contra PGlite: SOS (37), downwind (36), convites (28), chat privado (15);
  `redefinirSenhaFluxo.test.ts` migrado para o helper. ~67 contraprovas
  registradas em `docs/diario/2026-10-06-T13.md`. Helper novo
  `test/entrarRapido.ts` (sessão sem bcrypt, o arquivo do SOS caiu de 66 s
  para 6 s).
- **Dois defeitos reais que os testes acharam — corrigidos em `333f57f`:**
  1. **Downwind privado aceitava qualquer um com o id** e, em seguida,
     mostrava a posição de todos na água. Agora só criador e participantes
     passam por `/entrar` num privado (404 para o resto). Convites não passam
     por essa rota, então não foram afetados.
  2. **SOS já encerrado podia ser "reencerrado"**, apagando quem encerrou.
     Agora só fecha o que está aberto; já fechado responde 200 sem mudar nada
     (com 409, o painel de SOS do autor ficaria preso na tela).
  Contraprova das duas: sem a trava, só o teste correspondente fica vermelho.
  Testes do agente que usavam `/entrar` como atalho para pôr gente num
  downwind privado foram ajustados para gravar a participação como os
  convites fazem.
- **Também:** `docs/CONSULTA-VELEJOS-FICTICIOS.md` — consulta para o dono
  contar/listar (e, se quiser, limpar) velejos gravados com 28,4 km / salto
  9,2 m do formulário antigo. Validada contra o `lib/schema.sql` em PGlite.
- **Verificado no conjunto integrado:** tsc, eslint 0 erros (39 avisos),
  vitest 91 arquivos / 1304 testes, verify-sql 319/0, verify-sos 59/0, next
  build exit 0, nenhum `.js` de produção com o banco de preview.
- **Planos gratuitos:** nenhum impacto. Um push único em main/master.
