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

---

## 2026-11-12 — Varredura completa: rotas, telas, brechas, dependências
**Quem:** Claude (Fable) · **Tarefa:** pedido do dono ("mega varredura em todo
o código, todas as páginas, funcionalidades, brechas, falhas, bugs")
**Commits:** `b7af607` (dependências), `571b5c0` (correções)

- **Como foi feito:** (1) `npm audit`; (2) leitura das 90 rotas de API sem
  comentários, procurando acesso a dado de outro usuário, escrita sem filtro
  de dono, rota sem login, entrada sem validação; (3) varredura do cliente por
  injeção de HTML e links montados com dado de usuário; (4) busca por segredo
  versionado; (5) app rodando local (`npm run dev:preview`) com um script que
  chamou todas as rotas de leitura como velejador, admin, anônimo e com
  entrada malformada; (6) roteiro no celular (390×844) de 44 passos —
  registrar velejo, comentar, publicar, chat, evento, anúncio, perfil, painel
  admin, páginas públicas — registrando erro de tela e resposta ≥ 400.
- **Corrigido:**
  - **Dependências:** `next` 16.3.8 → 16.4.6 (dois críticos de execução
    remota de código) e `undici` (alta). Ver `docs/DEPENDENCIAS-ALERTAS.md`.
  - **Privacidade:** velejo tornado privado continuava no feed de relatos.
  - **Leitura sem login:** comentários de post (`GET /api/posts/[id]/comments`).
  - **Datas:** 41 pontos da API ainda devolviam o texto cru do `Date`; o
    cursor do feed perdia milissegundos (podia pular velejo entre páginas).
  - **Diário:** "90m" no lugar da distância; "Flat / Cruising" sem salto.
  - **Validação:** data ao editar velejo; id malformado e `limit` negativo
    davam erro 500 (22 rotas com regex de id frouxa).
  - **Endurecimento:** redefinição de senha confere o link antes do bcrypt;
    segredo do cron em tempo constante; endpoint de push só https.
- **Verificado e sem defeito:** todo UPDATE/DELETE de dado de usuário filtra
  pelo dono; painel admin responde 403 a não-admin e 401 a anônimo; conta
  suspensa e convidado de downwind são barrados em `requireUser`; tokens
  (sessão, convite, senha, apoio em terra) guardados só como hash; marcadores
  do mapa escapam HTML; nenhum segredo no repositório; nenhum erro de tela
  nem overflow nos 44 passos.
- **Testes:** `lib/varredura2026_11.test.ts` (5, pelas rotas reais).
  Contraprova: contra a API anterior, os 5 falham. Total: tsc, eslint 0
  erros, vitest 1309/1309, verify-sql 319/0, verify-sos 59/0, build exit 0.
- **Planos gratuitos:** nenhum impacto de uso. Um push.
- **Não corrigido, registrado no plano (V01–V05):** fotos de post, avatar e
  anúncio gravadas como texto no banco (0,5 GB do Neon); perfil não deixa
  apagar bio/contato de emergência; limites de usuário logado são em memória
  (os de porta aberta já usam o banco);
  "trocar a senha" obrigatório só é cobrado na tela; rotas que gravam sem
  limite de requisições.
- **Para o dono:** `@capacitor/android` crítico segue pendente (precisa de
  autorização e APK novo); T02, T03, T08, T11, T16 seguem como estavam.

---

## 2026-11-13 — "Corrija tudo": Capacitor, V01, V02, V04, V05
**Quem:** Claude (Fable, orquestrador) + agente Sonnet (V01, V02) + agente
Haiku (V05) · **Tarefa:** pedido do dono, com subagentes mais baratos
**Commits:** `23ffc31` (Capacitor) · `273230e` (V04) · `e5b9ef8` (V05) ·
`3476fa2` `e90ad37` (V01) · `40b4aa0` (V02) · integração e relato no commit
seguinte a esses

- **Capacitor 8.5.0 → 8.5.3:** fecha a falha crítica do WebView. `npm audit
  --omit=dev` agora: 0 críticas, 0 altas. **Só protege quem instalar um APK
  novo** — gerar e publicar é com o dono; este ambiente não compila Android.
- **V01 — fotos fora do banco (Sonnet):** foto de relato, avatar e fotos de
  anúncio agora sobem do celular direto para o Vercel Blob e o banco guarda só
  o endereço. Rota nova `/api/fotos/token` (login exigido, só três pastas, só
  JPEG/PNG/WebP, tamanho limitado pelo token). Relato e anúncio só aceitam
  endereço do próprio Blob — antes o relato aceitava qualquer texto como foto.
  Fotos antigas continuam aparecendo. Para tirá-las do banco há
  `scripts/migrar-fotos-para-blob.ts` (modo de simulação por padrão), com
  passo a passo em `docs/MIGRAR-FOTOS-PARA-BLOB.md`. Diário do agente:
  `docs/diario/2026-11-12-V01-V02.md`.
- **V02 — apagar campo do perfil (Sonnet):** bio, spot de casa e contato de
  emergência agora podem ser apagados; campo não enviado continua mantido.
- **V04 — troca de senha obrigatória (orquestrador):** cobrada no servidor
  (403 até trocar), não só pela tela.
- **V05 — limites de envio (Haiku + orquestrador):** teto por usuário em 16
  rotas que gravam. Nada de SOS nem de leitura. Diário:
  `docs/diario/2026-11-12-V05.md`.
- **Achado ao conferir na tela:** Publicar Relato nascia com "20 nós, 9m²
  Twintip, Side-Onshore Liso". Corrigido como o Registrar Velejo.
- **Revisão da integração:** diffs dos dois agentes lidos antes de juntar
  (rota de upload, validação de URL, SQL do perfil, núcleo da migração,
  posição de cada limite). Um susto que não era defeito: o app local entrou
  em laço de recarga — era o cache do servidor de desenvolvimento, que ficou
  no ar enquanto dezenas de arquivos mudavam ("HMR hash mismatch"); sumiu ao
  reiniciar com `.next/dev` limpo. Produção não usa esse mecanismo.
- **Verificado no conjunto:** tsc, eslint 0 erros (39 avisos), vitest 96
  arquivos / 1349 testes, verify-sql 319/0, verify-sos 59/0, build exit 0,
  todas as rotas de leitura sem erro, roteiro de 44 passos no celular sem
  erro de tela.
- **Não verificado:** upload de foto de ponta a ponta (o ambiente local não
  tem o token do Blob — a tela mostra o aviso certo); o script de migração
  contra banco e Blob reais; a compilação do APK.
- **Planos gratuitos:** o banco Neon para de crescer com fotos. O Blob passa
  a receber relato/avatar/anúncio além dos velejos — conferir o limite do
  plano no painel da Vercel.
- **Para o dono:** (1) gerar e publicar o APK novo; (2) rodar a migração das
  fotos antigas; (3) pendências anteriores T02, T03, T08, T11, T16.

---

## 2026-11-13 — Planos gratuitos: teto mensal de fotos e limites conferidos
**Quem:** Claude (Fable) · **Tarefa:** lembrete do dono ("estamos nos planos
free — GitHub, Neon, Vercel")
**Commits:** o deste registro

- **O que motivou:** a V01 passou mais fotos para o Vercel Blob e eu tinha
  deixado o limite do plano como "confira no painel". Conferido na
  documentação: o plano Hobby inclui **2.000 envios de arquivo por mês**, e ao
  estourar a Vercel **bloqueia o Blob por 30 dias** (todas as fotos somem).
  O teto por usuário que eu tinha posto (60 por hora) não protegia disso.
- **Corrigido:**
  - teto do app inteiro: 1.500 envios a cada 30 dias, contado no banco
    (`orcamentoMensalDoBlob`); passou, o envio de foto é recusado com aviso e o
    resto do app segue;
  - teto por usuário: 40 fotos por dia (era 60 por hora);
  - as fotos de velejo, que não tinham teto nenhum, entram nos dois;
  - script de migração: no máximo 200 fotos por execução (`--max`), porque
    cada foto migrada também gasta um envio; guia reescrito com a conta.
- **Novo:** `docs/LIMITES-PLANOS-GRATUITOS.md` — números de Vercel, Neon e
  GitHub conferidos na documentação em 13/11, o que acontece ao estourar cada
  um e o que no código impede isso.
- **Correção de informação:** o Neon Free hoje dá 1 GB por projeto, não
  0,5 GB como este diário e o plano vinham dizendo. A cota que mais aperta no
  Neon é a de computação (≈ 400 h/mês: o banco não pode ficar sempre acordado).
- **Erro meu pego na revisão:** o guia dizia "200 fotos por semana é seguro";
  somado aos 1.500 do app passaria dos 2.000. Ficou "no máximo duas execuções
  por mês".
- **Verificado:** dois testes novos pelas rotas (teto mensal; teto da
  migração), contraprovados — sem o teto, os dois falham. tsc, eslint 0 erros,
  vitest 1351/1351, verify-sql 319/0, verify-sos 59/0, build exit 0.
- **Custo desta mudança nos planos:** uma consulta leve ao banco por foto
  enviada e até 1.500 linhas pequenas que expiram sozinhas. Um push.
- **Para o dono:** a T03 (projeto Vercel duplicado) continua fazendo cada push
  virar seis deploys; resolvê-la é o maior alívio disponível no plano Hobby.

---

## 2026-11-13 (tarde) — T08 pronta e desligada, 1ª fatia da T17, APK novo no aparelho
**Quem:** Claude (Fable) · **Tarefa:** "faça tudo" do dono sobre as pendências
**Commits:** o deste registro

- **T02 — fechada.** Conferido na API do GitHub: os três últimos runs de CI em
  `main` passaram, Android incluído. Não havia nada a corrigir.
- **T08 — código pronto, desligado.** `lib/email.ts` (Resend por HTTP, sem
  dependência nova), a rota `recover-password` envia o link e a tela
  `/recuperar-senha` mostra o formulário **só** quando `RESEND_API_KEY` e
  `EMAIL_FROM` existem. Sem elas nada muda. Três cuidados além do plano:
  o link sai de `APP_URL`, não do cabeçalho Host (a rota é aberta); em
  produção sem envio configurado não se cria token que ninguém vai receber;
  e não há remetente padrão (o de teste do Resend só entrega ao dono da conta
  — seria a mesma promessa falsa de antes). Passo a passo do dono em
  `docs/ATIVAR-EMAIL-DE-SENHA.md`.
- **T17 — 1ª fatia (SOS).** Estado e ações do SOS saíram de
  `KiteDataContext.tsx` para `context/useSosAtivo.ts`, sem mudar o corpo nem o
  que o contexto expõe (1.547 → 1.390 linhas). Faltam chat, feed e logbook,
  uma fatia por commit.
- **APK.** Compilado nesta máquina (Capacitor 8.5.3, `BUILD SUCCESSFUL`) e
  instalado por USB no Samsung A07 do dono por cima do de 31/08, mantendo os
  dados. Cópia em `Downloads/KiteNinja-2026-11-13.apk`. O processo subiu sem
  crash no logcat; **a tela estava bloqueada, então não houve conferência
  visual.** É APK de debug assinado com a chave desta máquina: outro aparelho
  com APK do CI precisa desinstalar antes.
- **Verificado:** tsc; eslint 0 erros, 39 avisos (igual ao anterior); vitest
  1.359 testes, 1.358 passando e 1 que só falha no fuso desta máquina (abaixo);
  verify-sql 319/0; verify-sos 59/0; build exit 0. Os 8 testes novos da T08
  rodam as rotas reais com o Resend simulado; contraprova: sem o envio na
  rota, 4 falham.
- **Achado, não corrigido:** `lib/datasNasRotas.test.ts` falha em máquina fora
  de UTC (espera `2026-10-04`, recebe `2026-10-03` em UTC−3) e passa com
  `TZ=UTC`, que é o fuso do CI e da Vercel. Produção não é afetada; quem roda
  a suíte no Brasil vê um vermelho que não é regressão.
- **Aviso de ambiente:** nesta máquina, hoje, cada hash de senha levou ~1 s
  (CPU a 100% com outros programas) e os testes de rota estouram o limite
  padrão de 5 s. Rodar com `--testTimeout=180000`. Não é do código.
- **Não feito, e por quê:**
  - **T03** — o conector da Vercel não respondeu; o GitHub confirma que
    `kiteninja1` ainda constrói cada commit. Apagar projeto é ação do dono.
  - **T11** — fica com o dono. A opção A mexe em quem conta no quórum e no
    fluxo que já quebrou quatro vezes; "faça tudo" não escolhe entre A e B.
  - **Migração das fotos** — exige o token do Blob, que não existe nesta
    máquina.
  - **T16** — domínio é do dono (e pré-requisito para ligar a T08).
- **Correção logo após publicar (revisão de segurança automática):** a rota
  ainda caía no endereço da requisição quando `APP_URL` faltava — um Host
  forjado poderia apontar o link do e-mail de outra pessoa para outro site.
  Agora `APP_URL` é a terceira variável obrigatória (`urlDoApp` em
  `lib/email.ts`): sem ela o envio fica desligado. Dois testes novos (sem
  `APP_URL` nada sai; Host forjado não muda o link). O recurso estava
  desligado em produção, então ninguém foi exposto.
- **T03 — feita pelo dono (13/11):** projeto `kiteninja1` apagado na Vercel.
  Conferência: os status do commit deste registro no GitHub.
