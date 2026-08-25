# Plano master Android + iOS — KiteNinja

**Status:** Fase 0 executada, documentada e **aprovada com condições pelo Opus 5** em 24/08/2026. Fase 1 ainda não iniciada; nenhum código funcional ou shell mobile foi implementado.

**Base auditada:** commit `e15dc03` da branch `main`, em 24/08/2026. A árvore estava limpa e igual a `origin/main` no início da auditoria.

**Objetivo:** transformar o KiteNinja atual em aplicativo Android e iOS publicável, mantendo o PWA e o backend em produção, sem reescrever o que já funciona e sem prometer capacidades de segurança que as plataformas não garantem.

## 1. Decisão executiva

### Escolha recomendada

Usar **Capacitor como shell nativo incremental**, mantendo:

- Next.js/React/Tailwind como base de UI;
- APIs Next.js hospedadas na Vercel;
- Neon/Postgres como banco;
- Vercel Blob para mídia já existente;
- PWA como canal web;
- Leaflet e os mapas atuais no primeiro release.

Não usar:

- WebView que apenas abre `https://kiteninja.vercel.app` como produto final;
- TWA como estratégia iOS;
- React Native ou Flutter como primeira migração;
- JavaScript oculto como substituto de localização nativa em background;
- cron diário da Vercel Hobby como mecanismo de emergência.

### Por que esta é a melhor rota para este repositório

O app já possui uma UI React ampla, 60+ rotas de API, regras de negócio e testes. Reescrever tudo em React Native/Flutter criaria duas superfícies de defeito justamente nos fluxos de SOS, downwind, chat, previsão e autorização. Capacitor permite trocar apenas as bordas dependentes da plataforma — localização, push, armazenamento seguro, lifecycle, deep links, câmera/arquivos, status bar e splash — por implementações nativas.

Há uma restrição: `next export` não serve diretamente para o app atual, pois ele usa App Router, rotas API e conteúdo server-side no mesmo projeto. A migração deve separar o **cliente móvel compilável** do **backend Next hospedado**, com compartilhamento de componentes e contratos. O binário nunca executará o backend.

## 2. Situação atual comprovada

### O que existe e deve ser preservado

- Next.js 16.3.1, React 19.2.8, TypeScript e Tailwind 4 (`package.json`).
- 60+ endpoints sob `app/api`, com autenticação e autorização server-side.
- Sessão por token opaco em cookie `httpOnly`, `secure`, `sameSite=lax`; hash SHA-256 no banco (`lib/auth.ts:82-157`).
- Convites, perfis, seguidores, feed, sessões/logbook, comentários, chat geral/spot/DM, classificados, eventos, alertas, chamados e painel admin.
- SOS com unicidade de alerta aberto, máquina de estados, escalada idempotente, candidatos por proximidade/downwind e registros de auditoria (`app/api/sos`, `lib/sosEscalada.ts`, `lib/schema.sql:537-701`).
- Downwind com participantes, convite de apoio em terra, trilhas e resumo.
- Open-Meteo/GFS para previsão atmosférica e Marine para ondas/maré (`lib/weather.ts:24-36`).
- Fonte de vento observado do Kite Clube Tremembé (`lib/windObserved.ts`).
- Leaflet/react-leaflet com tiles CARTO e Esri, com atribuição centralizada (`lib/mapTiles.ts`).
- PWA standalone, ícones maskable/iOS, safe areas, splash e service worker mínimo para Web Push (`app/manifest.webmanifest/route.ts`, `app/layout.tsx`, `public/sw.js`).
- Testes unitários, SQL/PGlite, Neon e scripts adversariais de SOS. Na auditoria de 24/08/2026 foram reexecutados 673 testes em 38 arquivos, 233 checks SQL e 53 checks SOS, todos verdes. TypeScript e compilação Next também estavam verdes; repetir no início da implementação, mas não usar `npm run build` contra produção inadvertidamente, pois esse script executa `scripts/migrate-on-build.ts` antes de compilar.

### Limitações relevantes do estado atual

1. **Background real não existe.** `usePositionBeacon` e `useDownwindBeacon` param em `document.hidden` (`lib/usePositionBeacon.ts:83-123`, `lib/useDownwindBeacon.ts:42-80`). Com tela bloqueada ou app encerrado, o navegador não oferece a garantia necessária.
2. **Push é Web Push/VAPID.** `lib/push.ts` envia assinaturas de navegador; o banco não modela APNs/FCM. O service worker só trata push/click e não fornece cache offline (`public/sw.js`).
3. **A escalada confiável em minutos não está operacional.** O cron configurado é diário (`vercel.json`); a documentação afirma que `CRON_SECRET` falta e VAPID não foi comprovado (`docs/OPERACAO-SOS.md`).
4. **Autenticação mobile não existe.** Assets locais do Capacitor não devem depender implicitamente do cookie same-site da web. Não há token por dispositivo, rotação ou Keychain/Keystore.
5. **Offline é parcial e volátil.** A UI mantém dados anteriores em memória quando uma API falha, mas não existe banco/cache persistente de spots, previsão, mapas, trilhas ou fila de mutações. O service worker explicitamente não intercepta assets/Leaflet (`public/sw.js:1-7`).
6. **Polling é extenso e inconsistente no lifecycle.** Chat, DMs, notificações, SOS, presença e posições usam vários timers. Muitos fluxos pausam com `document.hidden`, mas o polling global de SOS a cada 12 s não pausa (`context/KiteDataContext.tsx:956-962`). No foreground, o conjunto multiplica requests e gasto de bateria; no background web, o navegador ainda pode throttlar/suspender sem garantia.
7. **Rate limit é `Map` em memória.** Não é compartilhado entre instâncias serverless (`lib/rateLimit.ts:14`).
8. **Observabilidade é insuficiente.** Erros não conhecidos viram apenas `console.error` (`lib/api.ts:9-18`). Não há alerta operacional de falha no SOS.
9. **UGC incompleto para lojas.** Não há política de privacidade/termos no repo nem fluxo de exclusão de conta encontrado. Há moderação e exclusões pontuais, mas faltam denúncia/bloqueio transversal para usuários, posts, comentários, chat e classificados.
10. **Sem CI versionado.** Não há `.github/workflows` no repo.
11. **README ainda é o template do create-next-app.** Não documenta arquitetura, ambientes ou release.
12. **Fotos de perfil podem ser data URLs de até 1,5 MB no próprio registro de usuário** (`app/api/profile/route.ts:34-42`), inadequado para escala e para sincronização mobile.

## 3. Arquitetura alvo

```text
                    ┌────────────────────────────────────┐
                    │ Backend Next.js hospedado (Vercel) │
                    │ /api/v1 + jobs + webhooks push     │
                    └───────────────┬────────────────────┘
                                    │ HTTPS/JSON
               ┌────────────────────┴────────────────────┐
               │                                         │
┌──────────────▼─────────────┐             ┌─────────────▼──────────────┐
│ Web/PWA Next.js            │             │ App mobile Capacitor       │
│ cookie httpOnly            │             │ React compilado localmente │
│ Web Push/VAPID             │             │ token opaco no Keychain    │
│ Geolocation web foreground │             │ APNs/FCM + localização nat.│
└────────────────────────────┘             └────────────────────────────┘
               │                                         │
               └────────────────────┬────────────────────┘
                                    │
                    ┌───────────────▼────────────────────┐
                    │ Pacotes compartilhados             │
                    │ UI, tipos, contratos, domínio      │
                    └────────────────────────────────────┘
```

### Estrutura de repositório alvo

A migração pode ocorrer no mesmo repositório:

```text
apps/
  web/                 # Next.js + app/api hospedado
  mobile/              # Vite/React + Capacitor android/ios
packages/
  domain/              # regras puras e tipos
  api-client/          # fetch tipado, autenticação, retries
  ui/                  # componentes compartilháveis
  platform/            # interfaces, sem dependência de Capacitor
```

Não mover tudo no primeiro commit. Primeiro criar as interfaces e o cliente de API no layout atual; só depois extrair `apps/mobile`. Big-bang monorepo é risco sem benefício.

### Interfaces de plataforma obrigatórias

- `AuthStore`: web cookie implícito; mobile token opaco em Keychain/Keystore.
- `LocationService`: foreground web; foreground/background nativo.
- `PushService`: VAPID web; APNs/FCM mobile.
- `LifecycleService`: `visibilitychange` web; lifecycle Capacitor nativo.
- `StorageService`: memória/localStorage apenas para preferências não sensíveis; SQLite/Preferences mobile.
- `NetworkService`: estado online/offline, qualidade, retry e fila.
- `HapticsService`: `navigator.vibrate` web; haptics nativo.
- `DeepLinkService`: URLs web, Universal Links e Android App Links.
- `MediaService`: file/camera/photo picker e upload.
- `MapService`: Leaflet web primeiro; adaptador para mapa nativo/MapLibre se os testes exigirem.

Componentes e hooks não devem importar plugins Capacitor diretamente. Eles chamam essas interfaces; isso preserva testes, PWA e reversibilidade.

## 4. Contratos de backend antes do shell

### API versionada

Criar `/api/v1` sem quebrar os caminhos web atuais. Durante a transição, handlers atuais podem delegar ao mesmo serviço de domínio.

Todo endpoint mobile deve ter:

- schema explícito de request/response;
- `requestId`/correlation ID;
- envelope de erro estável (`code`, `message`, `retryable`);
- idempotency key nas mutações críticas;
- paginação por cursor em feed, chat, notificações, riders e classificados;
- timestamps UTC ISO-8601;
- versionamento compatível com duas versões do app em circulação;
- política de timeout/retry; nunca retentar automaticamente mutação sem idempotência.

### Autenticação mobile

Adicionar uma sessão mobile opaca, não JWT autoportante:

- login troca credenciais por `accessToken` curto e `refreshToken` rotacionável;
- armazenar apenas no Keychain/Keystore;
- servidor guarda hash, device ID, plataforma, versão, criação, expiração e última utilização;
- refresh token é single-use/rotating; reuso revoga a família;
- logout revoga o dispositivo; “sair de todos” revoga todos;
- proteção contra brute force deve sair do `Map` local para storage distribuído/banco;
- o web mantém o cookie atual.

Não colocar tokens em URL, logs, analytics, AsyncStorage/localStorage ou payload de notificação.

### Registro de dispositivo/push unificado

Substituir o conceito isolado de `push_subscriptions` por registro de dispositivo:

```text
device_registrations
  id, user_id, platform(web|ios|android), installation_id
  push_provider(webpush|apns|fcm), push_token/endpoint
  app_version, locale, timezone, enabled, last_seen_at, revoked_at
```

O dispatcher escolhe Web Push, APNs ou FCM e registra resultado por mensagem. Token inválido é desativado. A API nunca confia em `userId` enviado pelo cliente.

## 5. Fluxos críticos

### 5.1 SOS — contrato de segurança

O fluxo atual é uma boa base, mas o release mobile não pode depender do estado operacional atual.

**Definição honesta:** KiteNinja coordena ajuda comunitária; não substitui 193/185/192/190. Botões de ligação continuam disponíveis offline quando houver sinal celular.

**Disparo:**

1. hold de 800 ms e haptic;
2. capturar melhor posição disponível com prazo curto;
3. gerar `clientSosId` UUID e persistir localmente antes da rede;
4. POST idempotente;
5. se offline, mostrar claramente “comunidade ainda não avisada”, oferecer ligação/SMS/WhatsApp e manter retentativa visível;
6. se confirmado pelo servidor, mostrar quantos dispositivos/usuários foram selecionados e estado da entrega sem alegar recebimento humano;
7. nunca usar silent push como única via de alerta.

**Escalada:** job server-side a cada minuto, independente de app aberto. O cron diário atual não atende. Opções aceitáveis: scheduler externo confiável com healthcheck ou infraestrutura que execute a cada minuto. Exigir alarme se o job não rodar por 2 ciclos.

**Push:** prioridade adequada à emergência, TTL curto, som/haptic conforme permissões. “Critical Alerts” no iOS exige entitlement específico da Apple e não entra no MVP; o produto deve funcionar sem isso.

**Ponta a ponta:** testar dois aparelhos reais, app em foreground/background/encerrado, rede lenta, sem GPS, token expirado, bateria baixa e permissão negada. Só liberar a alegação “avisa outros velejadores” depois de prova repetível.

**Limite duro:** force-stop/force-quit, ausência de dados e sistema sem permissão podem impedir execução/entrega. A UI e os termos não podem prometer garantia absoluta.

### 5.2 Localização e sessões/downwind

Separar três modos:

| Modo | Precisão/cadência | Background | Persistência |
|---|---|---:|---|
| Presença geral | baixa, esparsa | não necessária | última posição fresca no servidor |
| Sessão individual | adaptativa | durante sessão explícita | fila local + batch |
| Downwind | alta/adaptativa, safety-first | sim, durante evento | fila local + confirmação |

Regras:

- `@capacitor/geolocation` cobre geolocalização foreground, não o requisito de tracking contínuo em background; escolher plugin mantido ou módulo nativo próprio somente após spike, revisão de licença, lifecycle e política das lojas;
- permissão “Always/background” só é solicitada no contexto de iniciar tracking que realmente precisa dela;
- Android usa foreground service visível durante tracking;
- iOS habilita background location apenas enquanto a atividade estiver ativa;
- usuário vê indicador persistente e botão “Parar rastreamento”;
- buffer local append-only com sequência monotônica e timestamp do dispositivo;
- upload em lote idempotente; servidor aceita duplicata sem duplicar trilha;
- reduzir precisão/cadência parado, bateria baixa ou accuracy ruim;
- force-stop/force-quit, reboot antes de desbloqueio, economia de bateria e encerramento pelo sistema entram na matriz de falha; nenhum plugin autoriza promessa de continuidade garantida;
- nunca inferir que ausência de atualização significa acidente; exibir “sinal perdido/última posição”;
- política de retenção, exportação e exclusão de trilhas definida antes de coletar em background.

### 5.3 Push e mensagens

- Push transporta identificadores e texto mínimo; dados sensíveis são buscados após autenticação.
- Deep link abre tela específica e revalida autorização no servidor.
- DM pode gerar APNs/FCM server-side; chat geral não deve notificar todos por padrão.
- Badges derivam de estado server-side, não dos contadores voláteis atuais.
- Polling permanece fallback, mas unificado e com backoff/jitter. WebSocket/SSE só após medir necessidade e custo.

### 5.4 Mapas e offline

**Release 1:** manter Leaflet e tiles atuais, corrigindo lifecycle no shell e medindo memória/FPS nos aparelhos alvo. Isso minimiza rewrite.

**Offline inicial:**

- persistir catálogo de spots, favoritos, última previsão válida, eventos/downwind ativo e configuração;
- mostrar “atualizado em” e estado stale;
- fila de trilha/SOS não confirmado separada de cache comum;
- mapa sem tiles deve continuar mostrando coordenada textual, bússola, última posição e botões de emergência.

**Não pré-baixar tiles CARTO/Esri sem licença explícita.** Os URLs atuais e atribuições não provam direito de bulk download/offline. Para regiões offline, selecionar provedor/licença adequados e orçamento antes de implementar; MapLibre é opção de renderer, não licença de tiles.

**Gatilho para migrar o mapa:** só trocar Leaflet por MapLibre/native se os testes demonstrarem falha de FPS, memória, render em background/foreground ou necessidade licenciada de mapas offline. Encapsular antes para não reescrever telas.

### 5.5 Clima, maré e vento

- Continuar fazendo Open-Meteo via backend, não diretamente por dois clientes, para normalizar modelos, fuso e fallback.
- Persistir snapshot por spot com `observedAt`, `fetchedAt`, fonte/modelo e validade.
- O cliente mostra dado stale em vez de zero inventado.
- Rever antes do lançamento as fórmulas empíricas de conversão de datum em `lib/weather.ts:245-283`: dados de maré podem influenciar segurança e devem ter origem/calibração documentada por estação, margem de incerteza e aviso de que não são carta náutica oficial.
- Vento observado deve exibir fonte, idade e indisponibilidade; nunca fundir “medido” e “previsto” sem distinção.

### 5.6 UGC, privacidade e lojas

Antes de beta pública:

- política de privacidade publicada e acessível antes do login;
- termos de uso e aviso de segurança/SOS;
- fluxo de exclusão de conta dentro do app e URL web equivalente;
- exportação de dados pessoais;
- denúncia em usuário, post, comentário, mensagem/chat e anúncio;
- bloqueio/mute de usuário com efeito em feed, DM e chat;
- fila de moderação, SLA interno e audit log;
- contato de suporte e canal de contestação;
- retenção declarada de posição, SOS, chat e trilhas;
- inventário para App Privacy Details e Google Data Safety;
- respostas de review e conta demo sem expor produção real.

Marketplace permanece sem pagamento, conforme `docs/PLANO-ANUNCIOS.md`. Se pagamentos digitais forem adicionados no futuro, precisam de revisão separada de políticas e arquitetura.

## 6. Fases executáveis

As fases não são estimadas em horas/dias. Cada uma termina por evidência, não por calendário.

### Fase 0 — Congelar baseline e provar operação atual

**Estado em 24/08/2026:** `IMPLEMENTADO`, `TESTADO` e `APROVADO COM CONDIÇÕES` pelo Opus 5. Evidências e classificações estão em `MOBILE-BASELINE.md`. Condições antes/durante o início da Fase 1: tratar lint e vulnerabilidade de dependência em mudanças separadas e reversíveis; definir staging/banco descartável; instalar toolchain Android conforme matriz oficial vigente. A prova operacional completa de SOS PWA em dois aparelhos continua pendente e não foi simulada nesta máquina.

**Entregas**

- ADR da arquitetura mobile;
- executar e arquivar typecheck, testes, SQL, SOS e build;
- teste PWA atual em iPhone e Android reais;
- configurar/provar VAPID e scheduler por minuto ou declarar SOS indisponível para beta;
- matriz de capacidades e promessas do produto.

**Gate:** zero regressão e fluxo SOS PWA com dois aparelhos documentado.

**Rollback:** nenhum código de produto; remover apenas documentação/configuração de teste.

### Fase 1 — Contratos e fundação compartilhada

**Entregas**

- interfaces de plataforma;
- `api-client` com base URL, erros, request ID e abort/timeout;
- `/api/v1`, schemas e testes de contrato;
- sessão mobile e registro de dispositivo;
- feature flags por plataforma/versão.

**Gate:** web continua passando; cliente de teste autentica, renova e revoga sessão; nenhum token aparece em log/storage inseguro.

**Rollback:** flags mantêm web nos endpoints antigos; revogar todas as sessões mobile.

### Fase 2 — Shell Capacitor mínimo

**Entregas**

- app React compilado localmente;
- projetos Android/iOS, bundle IDs, environments e deep links;
- status bar/splash/safe areas/keyboard/orientation;
- login, navegação, spots, previsão e perfil;
- pipeline de build assinado para distribuição interna.

**Gate:** sem dependência do servidor para carregar a casca; login e leitura funcionam em Wi-Fi/4G, retomada de background e rotação suportada; revisão de WebView/minimum functionality preparada.

**Rollback:** PWA permanece canal principal; builds internos podem ser desativados por feature flag/minimum version.

### Fase 3 — Push nativo

**Entregas**

- APNs/FCM, registro/refresh/revogação de token;
- dispatcher multicanal;
- deep links para SOS, DM, evento e alerta;
- centro de preferências e badges server-side;
- telemetria de aceitação/envio/erro/abertura sem conteúdo sensível.

**Gate:** matriz foreground/background/encerrado em aparelhos reais; token rotacionado e desinstalação tratados; push duplicado deduplicado.

**Rollback:** desabilitar categoria por servidor; Web Push segue para PWA.

### Fase 4 — Tracking nativo e offline safety

**Entregas**

- serviço nativo de localização de sessão/downwind;
- foreground service Android e background mode iOS;
- SQLite/fila local, batch idempotente e reconciliação;
- indicadores de estado/permissão/sinal/bateria;
- política de retenção e purge.

**Gate:** trilha contínua com tela bloqueada dentro dos limites de plataforma; perda/restauração de rede sem buracos silenciosos; consumo de bateria medido e aprovado; tracking cessa ao encerrar.

**Rollback:** kill switch remoto interrompe background tracking e volta ao modo foreground web.

### Fase 5 — SOS mobile end-to-end

**Entregas**

- gatilho nativo reutilizando máquina de estados server-side;
- persistência local de tentativa e idempotency key;
- scheduler por minuto + healthcheck + alerta operacional;
- push nativo, fallback ligação/SMS/WhatsApp e estados honestos;
- runbook e simulações.

**Gate:** exercícios repetidos com dois ou mais aparelhos, sem GPS/rede, background/encerrado e escalada; nenhum cenário exibe “enviado” sem ACK do servidor; auditoria de autorização e privacidade verde.

**Rollback:** kill switch remove o botão comunitário e mantém números oficiais; jamais manter fluxo parcialmente confiável ativo.

### Fase 6 — Offline de produto, mídia e performance

**Entregas**

- cache persistente versionado de spots/previsão/evento ativo;
- outbox de mutações seguras;
- upload de mídia por arquivo com compressão e retomada;
- lazy loading/map isolation, orçamento de bundle/memória/FPS;
- decisão baseada em métricas sobre Leaflet vs MapLibre/native.

**Gate:** cold start, navegação e mapa dentro dos budgets definidos; cache nunca mascara idade/fonte; conflitos de sync resolvidos.

**Rollback:** desabilitar cache/outbox por versão de schema e limpar somente caches reconstruíveis.

### Fase 7 — Compliance, beta e lojas

**Entregas**

- denúncia/bloqueio/exclusão/exportação;
- políticas e disclosures;
- assets e textos de loja;
- Data Safety/App Privacy;
- TestFlight e Play internal/closed testing;
- revisão em aparelhos e acessibilidade;
- checklist de incidentes e suporte.

**Gate:** todos os itens da checklist `STORE-READINESS.md`, revisão de privacidade e segurança, zero P0/P1 aberto e beta sem crash blocker.

**Rollback:** staged rollout/pausa de release; backend permanece compatível com versão anterior.

### Fase 8 — Lançamento progressivo e operação

- rollout 1%/5%/20%/50%/100%, pausável;
- painel de crash-free users, API errors, registro/aceitação/rejeição/abertura de push, localização e SOS;
- on-call e runbook de revogação de versão;
- revisão pós-lançamento antes de adicionar recurso novo.

Aceitação pelo Web Push/APNs/FCM não prova entrega no aparelho nem leitura humana. A telemetria e a UI devem manter esses estados separados.

## 7. Priorização

### P0 — antes de qualquer alegação de segurança

- corrigir o rate limit de `POST /api/sos`: hoje ele é consumido antes da busca do SOS aberto (`app/api/sos/route.ts:22-55`), então reapertar para atualizar posição/reconfirmar o mesmo socorro esgota as três tentativas por hora; somente uma criação nova deve consumir o limite;
- scheduler de escalada em minutos e healthcheck;
- VAPID atual comprovado e APNs/FCM no mobile;
- teste SOS real multiaparelho;
- localização nativa para tracking em background;
- auth mobile segura;
- observabilidade/alerta de SOS;
- política de falha e kill switches.

### P1 — antes de beta pública

- emitir o evento estruturado `encerrado` ao resolver/cancelar/marcar falso alarme; o tipo existe em `lib/sosLog.ts`, mas `app/api/sos/[id]/route.ts` hoje grava apenas `audit_logs`;
- privacidade/termos/exclusão/exportação;
- denúncia e bloqueio UGC;
- cache offline mínimo e outbox;
- rate limit distribuído;
- CI/CD e builds assinados;
- deep links verificados;
- acessibilidade e permissões contextuais.

### P2 — após estabilidade

- MapLibre/native map se métricas justificarem;
- mapas offline licenciados;
- WebSocket/SSE se polling provar custo alto;
- widgets/live activities/wearables;
- assinatura/pagamento, somente com plano separado.

## 8. Custos e dependências

Custos que devem ser confirmados no momento da contratação/publicação, em fontes oficiais:

- Apple Developer Program;
- Google Play Console;
- hardware macOS/Xcode ou CI macOS para assinar iOS;
- scheduler por minuto/monitoramento;
- retenção de logs/crash reporting;
- tiles/mapas offline e eventual geocoding;
- aumento de banco/blob/egress conforme adoção.

APNs/FCM não devem ser confundidos com custo total zero: o transporte pode não ter tarifa por mensagem, mas backend, monitoramento, suporte e operação têm custo. Não selecionar fornecedor de mapa ou observabilidade antes de medir volume e revisar termos.

### Sequência executável sob a restrição atual de custo

O projeto opera em Neon/Vercel/GitHub gratuitos e o ambiente de desenvolvimento atual é Windows. Isso muda a ordem, não a arquitetura:

1. **Spike 0 — PWA/SOS, custo zero:** configurar e provar VAPID, `CRON_SECRET` e um acionador externo confiável por minuto, com healthcheck, usando dois aparelhos reais. Se falhar, não iniciar mobile: trocar runtime não cria um canal de emergência operacional.
2. **Spike 1 — Android shell/auth, custo zero:** gerar assets locais, introduzir base URL absoluta e autenticação bearer/Keychain atrás do `api-client`. Hoje existem 63 chamadas relativas `/api` em 30 arquivos e nenhuma `credentials:` explícita; no shell local elas resolveriam para `localhost`, não para a Vercel. O spike termina quando casca abre offline e login/leitura funcionam contra o backend remoto.
3. **Spike 2 — Android background tracking:** testar 60+ minutos com tela bloqueada, foreground service visível, perda de rede e fila local. Este é o ganho que o PWA não oferece.
4. **Spike 3 — Android mapa/performance:** medir memória, FPS, aquecimento e retomada com Leaflet, feed e partículas; só então decidir Leaflet versus MapLibre/native.
5. **iOS — gate explícito:** iniciar apenas depois dos quatro resultados anteriores e da aceitação dos requisitos de Apple Developer Program e de macOS/Xcode próprio ou CI macOS. Não criar uma implementação iOS que não possa ser assinada e testada em aparelho real.

A arquitetura continua preparada para Android e iOS, mas o primeiro produto nativo comprovável é Android; PWA permanece no iPhone até o gate iOS ser aprovado.

## 9. Métricas de sucesso

Definir baseline antes da migração e medir por plataforma/versão:

- crash-free users e sessões;
- cold/warm start;
- latência p50/p95/p99 das APIs críticas;
- taxa de login/refresh falho;
- push opt-in, token válido, envio aceito e abertura;
- pontos de trilha esperados vs recebidos e idade da última posição;
- bateria por hora de tracking;
- SOS: ACK, candidatos, pushes aceitos, primeiro humano `a_caminho`, escaladas e falhas;
- cache hit/stale e outbox pendente;
- denúncias, tempo de moderação e bloqueios;
- tamanho do app, bundle JS e memória/FPS do mapa.

Nenhum analytics deve incluir coordenada, mensagem privada, token, contato de emergência ou conteúdo de SOS.

## 10. Decisões que ainda exigem validação

1. Android/iOS mínimos suportados, conforme alcance real dos usuários.
2. Se tracking em background é exigido só no downwind ou em toda sessão individual.
3. Retenção exata de posições/trilhas/SOS e regras de exportação/exclusão.
4. Scheduler e observabilidade dentro do orçamento.
5. Licença/provedor para mapas offline, caso entre no escopo.
6. Endereço/domínio de políticas, suporte e Universal/App Links.
7. Conta jurídica/pessoal usada nas lojas e ownership de certificados/chaves.

Essas decisões não bloqueiam a Fase 0; bloqueiam implementação ou publicação das capacidades relacionadas.

## 11. Regra de implementação

Cada fase deve sair em mudanças pequenas, testáveis e reversíveis. Nenhum commit mistura:

- reorganização de diretórios;
- mudança de contrato;
- migração de banco;
- integração nativa;
- alteração visual ampla.

Primeiro criar contrato e adapter; depois migrar uma feature; só então remover o caminho antigo. O PWA deve permanecer funcional durante toda a migração.
