# Plano — App nativo (Play Store) e integração com este backend

Status: **investigação registrada, nenhum código deste repositório mudou.**
Escrito em 24/08/2026 a partir do relato do dono: "Fizemos novas atualizações.
Inclusive já fizemos o app para Play Store. Tudo configurado no Firebase e no
Android Studio." Pediu para documentar para outro agente continuar.

## O que foi conferido e o que NÃO está aqui

Antes de escrever qualquer linha deste documento, o repositório
`tarcyoalves/kiteninja` inteiro foi olhado à procura de qualquer rastro do
trabalho nativo (`git log`, busca por `android`, `firebase`, `capacitor`,
`.well-known`, `assetlinks`, `manifest`). Resultado:

- **Não existe projeto Android Studio, configuração do Firebase, wrapper
  Capacitor/Bubblewrap/TWA, nem nenhum arquivo relacionado a app nativo neste
  repositório.** Os únicos commits novos desde a última sessão de trabalho são
  dois ajustes cosméticos no menu lateral (destaque visual do item "Reportar
  Bug/Melhoria" — `446677f`, `e15dc03`), sem relação com Android/Play Store.
- O dono confirmou (nesta mesma conversa) que não sabe dizer se esse trabalho
  vive em outro repositório GitHub ou só localmente na máquina dele/de quem
  fez — **isso ficou em aberto, é a primeira coisa a resolver** (ver seção
  "Perguntas para o dono" abaixo).
- O escopo do GitHub desta sessão estava limitado a `tarcyoalves/kiteninja`.
  Se o app nativo mora em outro repositório, quem continuar precisa usar a
  ferramenta de adicionar repositório (`add_repo` no Claude Code) para
  conseguir enxergá-lo antes de analisar qualquer coisa — **não adivinhe o
  conteúdo de um projeto que você não consegue ler**.

## O que já existe NESTE repositório e é relevante para empacotar como app nativo

Caso o caminho escolhido tenha sido (ou venha a ser) um **TWA — Trusted Web
Activity** (o jeito mais comum de levar uma PWA para a Play Store sem
reescrever nada, via Bubblewrap ou PWABuilder), o lado "web" já está com boa
parte do necessário pronto:

- **`app/manifest.webmanifest/route.ts`**: manifest servido por rota (não
  arquivo estático) para sair com `Content-Type: application/manifest+json`
  de verdade — comentário no próprio arquivo explica que alguns Android
  ignoram o manifest servido como `text/plain`. Já tem:
  - `display: 'standalone'`, `start_url`/`scope: '/'`, `orientation: 'portrait'`;
  - ícones 192×192 e 512×512 (`purpose: 'any'`) **e** um ícone 512×512
    `purpose: 'maskable'` (`/brand/maskable-512.png`) — necessário porque o
    Android recorta o ícone em círculo/squircle conforme o launcher, e sem a
    folga do maskable a logo perde as bordas nesse corte;
  - `theme_color`/`background_color` sincronizados com `--app-bg` do
    `app/globals.css` (travado por teste, `app/manifest.webmanifest/route.test.ts` —
    ver o comentário lá sobre a splash "piscar" de uma cor pra outra quando
    diverge);
  - `shortcuts` (Mapa, Logbook).
- **`public/sw.js`**: Service Worker mínimo, só trata `push`/`notificationclick`
  — é o que faz o Web Push (VAPID) funcionar hoje no navegador/PWA instalada.
  **Não é Firebase Cloud Messaging** — ver seção seguinte.

## O que falta para confirmar/ajustar, se o caminho for TWA

1. **`/.well-known/assetlinks.json` não existe neste repositório.** Esse
   arquivo é obrigatório para o Android verificar que o app TWA e o domínio
   `kiteninja.vercel.app` pertencem à mesma organização (Digital Asset
   Links) — sem ele, ou a verificação falha (o app cai para "Custom Tab" e
   mostra a barra de endereço do navegador, quebrando a aparência de app
   nativo) ou a Play Store recusa/sinaliza o pacote na revisão. Se o
   Android Studio/Bubblewrap já gerou esse arquivo, ele precisa ser publicado
   em `public/.well-known/assetlinks.json` (Next.js serve qualquer coisa em
   `public/` na raiz do domínio) — **conferir se isso foi feito onde quer que
   o projeto Android esteja, e trazer o arquivo pra cá se ainda não veio**.
2. **Confirmar a origem exata do pacote**: o `assetlinks.json` precisa do
   `package_name` do app Android e do hash SHA-256 do certificado de
   assinatura (debug ou release) — dado que só existe no projeto Android
   Studio, não aqui.

## O que falta se o Firebase foi configurado para notificações push nativas (FCM)

Este é o ponto mais provável de ficar quebrado em silêncio, então merece
destaque: **o backend deste app só sabe falar Web Push (VAPID), não Firebase
Cloud Messaging.**

- Tabela `push_subscriptions` (`lib/schema.sql`): guarda `endpoint` +
  `p256dh`/`auth` (as três colunas que o protocolo Web Push exige) — não tem
  coluna nenhuma pensada para um **token FCM** (que é uma string opaca só,
  formato completamente diferente de um endpoint Web Push).
- `lib/push.ts` (`sendPushToUser`/`sendPushToUsers`): usa a biblioteca
  `web-push` com as chaves VAPID do projeto — não tem nenhum código de
  integração com o Admin SDK do Firebase (que seria o jeito de mandar push
  para um token FCM a partir do servidor).
- Rota de inscrição atual (`app/api/push/subscribe`, ver o arquivo) recebe
  exatamente o formato de uma `PushSubscription` do navegador — não aceita
  nem valida um token FCM.

**Se o app Android nativo (via Firebase) espera receber notificação de SOS,
chat direto, curtida/comentário/resposta (Fase 6) ou qualquer outro evento
que hoje dispara `sendPushToUser`/`sendPushToUsers`, isso NÃO vai chegar até
ele** — essas chamadas só alcançam quem tem uma linha em `push_subscriptions`
com um endpoint Web Push válido, nunca um token FCM.

### Dois jeitos de fechar essa ponte, se for necessário

1. **App Android registra o token FCM como se fosse mais um tipo de
   "assinatura" deste mesmo sistema** — adicionar uma coluna
   (`fcm_token TEXT`, ou uma tabela irmã `push_subscriptions_fcm`) e um ramo
   em `lib/push.ts` que, para essas linhas, chama o Admin SDK do Firebase em
   vez de `web-push`. Mantém UM único ponto de disparo
   (`sendPushToUser`/`sendPushToUsers`) mandando pros dois canais.
2. **App Android não depende do backend web para push** — se o app nativo
   tiver sua própria lógica (ex.: Cloud Functions do Firebase reagindo a
   alguma coisa, ou simplesmente não replica os mesmos eventos de push do
   PWA) — nesse caso não precisa mexer em nada aqui, mas então SOS/chat/social
   ficam **inconsistentes entre PWA e app nativo** (quem usa o app Android não
   recebe os mesmos avisos que quem usa a PWA), o que provavelmente não é o
   que o dono quer para o alerta de SOS especificamente (é o caso mais crítico
   de segurança do app inteiro — ver `docs/OPERACAO-SOS.md` e
   `docs/MAQUINA-ESTADOS-SOS.md`).

**Não decidir isso sozinho** — é uma escolha de arquitetura que depende de
como o app Android foi construído (WebView fina vs. app nativo de verdade
com sua própria camada de dados), informação que só existe no projeto que
este documento não conseguiu localizar.

## Perguntas para o dono, antes de qualquer código novo

1. O projeto Android Studio/Firebase está em outro repositório Git? Se sim,
   qual (`owner/repo`) — para adicionar ao escopo da sessão com `add_repo`.
   Se não (só local), o dono precisa trazer os arquivos relevantes
   (`AndroidManifest.xml`, config do Firebase, o que foi gerado pelo
   Bubblewrap/PWABuilder se foi esse o caminho) para dentro de uma conversa
   com um agente, já que não há como um agente enxergar arquivos que
   existem só na máquina local do dono.
2. O caminho foi **TWA** (a PWA atual embrulhada, sem reescrever UI) ou um
   **app nativo/Capacitor** com telas próprias? Muda completamente o que
   "continuar isso" significa.
3. O Firebase foi configurado só para push (FCM), ou também para outra
   coisa (Analytics, Crashlytics, Auth)? Se for só push, a pergunta da seção
   anterior (qual dos dois jeitos de fechar a ponte) precisa de resposta.
4. Já existe pacote publicado/em revisão na Play Store, ou o "fizemos o app"
   é o build local ainda não enviado? Muda a urgência de qualquer correção
   aqui — um app já em revisão com o `assetlinks.json` errado pode ser
   rejeitado ou pior, aprovado e quebrado em produção.

## Como continuar (para o próximo agente)

1. Leia este documento inteiro primeiro.
2. Faça as 4 perguntas acima ao dono — não presuma nenhuma resposta.
3. Se houver repositório separado, adicione com `add_repo` e leia o projeto
   Android/Firebase de verdade antes de propor qualquer mudança neste
   backend.
4. Se a resposta confirmar que o app depende deste backend para
   push/dados: trate a ponte FCM como uma fase nova, com o mesmo rigor de
   verificação já padrão neste projeto (schema + `scripts/verify-sql.ts` +
   `lib/authz.test.ts` + os 4 comandos de verificação obrigatórios
   documentados em qualquer `docs/PLANO-*.md` recente) antes de fazer deploy.
5. Se a resposta for "é só TWA, sem push nativo": o único item realmente
   pendente aqui pode ser confirmar/publicar o `assetlinks.json` em
   `public/.well-known/assetlinks.json` — baixo risco, mas precisa dos dados
   exatos (`package_name` + hash do certificado) que só existem no projeto
   Android.
