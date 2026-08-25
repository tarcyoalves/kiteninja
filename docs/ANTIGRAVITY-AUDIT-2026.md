# KITE NINJA — AUDITORIA MASTER COMPLETA (2026)
## AGENTE: ANTIGRAVITY · MODO AUDITORIA PROFUNDA & PLANEJAMENTO
## STATUS: INVESTIGAÇÃO CONCLUÍDA · NENHUMA ALTERAÇÃO DE CÓDIGO REALIZADA

---

## 1. SUMÁRIO EXECUTIVO

Esta auditoria foi conduzida com rigor multidisciplinar (Engenharia de Software Staff, Arquitetura de Sistemas, Segurança da Informação, Engenharia de Banco de Dados, Engenharia Mobile/PWA/Capacitor, SRE e Especialistas em Sistemas de Localização e Emergência Life-Safety).

O KiteNinja é um aplicativo híbrido de alta fidelidade desenvolvido sobre **Next.js 16.3.1 (App Router)**, **React 19.2.8**, **Neon Serverless Postgres** (driver HTTP), **TypeScript 5**, **Tailwind CSS v4**, **Leaflet 1.9.4** e **Web Push VAPID**. O aplicativo encontra-se atualmente em produção em `https://kiteninja.vercel.app` e distribuído na **Google Play Store via Trusted Web Activity (TWA)**.

A auditoria cobriu **100% da superfície de código**:
- **59 Rotas de API** em `app/api/`
- **33 Tabelas e Estruturas Relacionais** em `lib/schema.sql`
- **Subsistema de Emergência Life-Safety (SOS)** e Máquina de Estados
- **Subsistema de Rastreamento em Tempo Real (Downwind & Modo Navegação)**
- **Mecanismos de Geolocalização (Beacons, WakeLock, Watchers)**
- **Motor Meteorológico e Oceanográfico (Open-Meteo Atmospheric & Marine API)**
- **Camada de Autenticação, RBAC e Sessões Scoped (Convidados 12h)**
- **PWA, Service Worker (`public/sw.js`), Manifest e Integração Play Store (TWA)**
- **Segurança da Informação (OWASP Top 10, Injeções, DOM XSS, Headers, Rate Limiting)**
- **Performance, Polling, Concorrência, Memory Leaks e Escalabilidade**
- **Arquitetura de Monetização (Free 2 Spots vs Pro Ilimitado)**

---

## 2. RESPOSTAS DIRETAS ÀS 23 PERGUNTAS ESTRATÉGICAS

### 1. O app está realmente seguro?
**Parcialmente.** A base criptográfica (SHA-256 para tokens, bcrypt com 12 rounds para senhas, isolamento de DMs por `canAccessDm`, ausência de `dangerouslySetInnerHTML`) é sólida. Contudo, há vulnerabilidades reais:
- **Ausência total de Security Headers e CSP** em `next.config.ts` (sem HSTS, X-Frame-Options, CSP, Permissions-Policy).
- **DOM XSS confirmado em marcadores Leaflet** (`LeafletMap.tsx:184, 203`) onde nomes de velejadores são injetados sem sanitização HTML em `L.divIcon({ html })`.
- **Rate limiting em memória serverless (`Map`)** ineficaz contra ataques distribuídos ou rotatividade de lambdas.

### 2. Existe algum P0?
**SIM, 1 P0 CONFIRMADO:**
- **ANT-001 (P0): SOS sem GPS disparado fora de downwind ativo falha em notificar qualquer socorrista.** Se o velejador estiver velejando sozinho ou em sessão livre e o GPS do celular falhar/estourar o timeout de 3s (comum com celular molhado na água), o servidor busca candidatos por raio (que dá zero sem coordenadas) e por downwind (que dá zero fora de evento). O SOS é gravado, a tela do velejador exibe "SOS Enviado", mas **0 notificações são disparadas, 0 socorristas são associados e a escalada de 5km ➔ 15km ➔ 50km permanece com 0 notificados indefinidamente**.

### 3. Existe algum P1?
**SIM, 6 P1s CONFIRMADOS:**
- **ANT-002 (P1): Rate Limit de SOS cobrado antes de deduplicar atualizações de coordenadas.** Se o acidentado na água aperta SOS mais de 3 vezes em 1h enquanto deriva para atualizar sua posição, a 4ª chamada é barrada por HTTP 429.
- **ANT-003 (P1): Tracking GPS de Downwind e Presença para 100% ao bloquear tela / background (`document.hidden`).** Em PWA/TWA, a Screen Wake Lock API não mantém a execução do JS quando o usuário bloqueia a tela para guardar o celular no colete.
- **ANT-004 (P1): Ausência de manipulador de Cache/Offline no Service Worker (`sw.js`).** O app não abre e exibe tela de erro de rede no Android TWA se a praia estiver com sinal oscilando ou offline.
- **ANT-005 (P1): Injeção DOM XSS em marcadores Leaflet DivIcon de SOS e Socorristas.** Interpolação de `authorName` e `name` sem `escaparHtml`.
- **ANT-006 (P1): Login permite autenticação com sucesso de contas suspensas (`is_active = FALSE`).** Cria sessão em `auth_sessions`, retorna 200 OK e desloga na requisição seguinte (`GET /api/auth/me`).
- **ANT-007 (P1): Cron de escalada SOS na Vercel roda apenas 1x/dia no plano Hobby (`0 3 * * *`).** A escalada em minutos depende exclusivamente de usuários com o app aberto.

### 4. O SOS é confiável?
**Parcialmente.** Possui máquina de estados e unicidade por constraint `uniq_sos_aberto_por_usuario` muito bem concebidas, mas falha silenciosamente no caso crítico de disparo sem GPS fora de downwind (ANT-001) e sofre bloqueio de atualização de coordenadas por rate limit (ANT-002).

### 5. O GPS é confiável?
**Apenas com a tela desbloqueada e ativa em primeiro plano.** `lerPosicaoAlta` usa `enableHighAccuracy: true`, mas a precisão em água depende de tempo de fix e não possui filtro de Kalman para descartar saltos espúrios de GPS.

### 6. O tracking é confiável?
**Não para uso com tela desligada no bolso/colete.** O beacon para de enviar requisições imediatamente quando `document.hidden === true`. Não há outbox local (IndexedDB) para acumular pontos offline e sincronizar em lote ao reconectar o 4G.

### 7. A localização está protegida?
**Sim.** `GET /api/sos/active` aplica a trava `canSeePos` (autor, notificado em `sos_responders` ou moderador). As salas de DM não expõem presença no `user_presence`.

### 8. A autenticação está segura?
**Sim no núcleo criptográfico**, mas inconsistente no fluxo de suspensão de usuários (`app/api/auth/login/route.ts` não valida `is_active = TRUE`).

### 9. As APIs estão seguras?
**Sim contra IDOR e SQL Injection**, pois usam template-tags parametrizadas `sql\`...\`` e verificações de ownership com `WHERE user_id = ${user.id}`.

### 10. O banco está saudável?
**Sim**, com 33 tabelas normalizadas, chaves compostas e integridade referencial com CASCADEs testados em 227 checagens PGlite. Porém, faltam índices essenciais em chaves estrangeiras (`sessions_log.spot_id`, `chat_messages(user_id, created_at)`).

### 11. Existem race conditions?
**Minimizadas no banco**, mas existentes na criação de downwinds em `app/api/events/route.ts` (operações sem transações reais no driver HTTP Neon) e no rate limiting em memória serverless.

### 12. Existem memory leaks?
**Não foram detectados vazamentos graves de timers** (todos os `useEffect` possuem `clearInterval`/`clearTimeout` e `removeEventListener`), mas há retenção excessiva de objetos em state nos loops de polling se o payload crescer.

### 13. Existem problemas de performance?
**Sim.** `GET /api/spots` faz requests externos em paralelo para a Open-Meteo sem cache distribuído compartilhado; `GET /api/sessions` traz até 500 sessões com arrays JSONB de coordenadas completas em uma única chamada.

### 14. Existem bugs de UX?
- Botão "Minha localização" no mapa perde o watch de GPS se o usuário alternar para outro app e voltar (não reata o watcher automaticamente).
- Ordenação de eventos oficiais em `app/api/events/route.ts` é alfabética por texto (`ORDER BY event_date ASC`), ordenando meses em português por ordem alfabética ("Abril" antes de "Janeiro").
- Ausência de feedback quando pontos de downwind falham no envio por falta de sinal.

### 15. O PWA está saudável?
**Incompleto.** O Web Manifest está correto, mas o Service Worker (`public/sw.js`) só escuta `push` e `notificationclick`. Não há listener de `fetch`, impedindo qualquer cache de casca (App Shell) ou modo offline.

### 16. O projeto está pronto para Capacitor?
**Não de imediato.** Requer substituição da Geolocation API da web por `@capacitor/geolocation` + Foreground Service nativo para tracking em background, além de `@capacitor/push-notifications` para APNs/FCM nativos.

### 17. O que precisa ser alterado para Android (Play Store TWA / Nativo)?
- **TWA Atual**: Adicionar verificação de Digital Asset Links em `public/.well-known/assetlinks.json` para ocultar a barra de URL do Chrome e evitar a tarja do navegador.
- Implementar cache offline no Service Worker para não exibir crash de WebView sem rede.
- Adicionar Foreground Service nativo para persistir o tracking de downwind com a tela bloqueada.

### 18. O que precisa ser alterado para iOS?
- No iOS PWA (Safari), Web Push só funciona se o app estiver adicionado à Tela de Início (`display: standalone`).
- A Apple desliga conexões de WebSocket e timers em abas de segundo plano em menos de 30 segundos.
- Para a App Store (Capacitor/SwiftUI), é obrigatório integrar Apple StoreKit 2 para compras e declarar permissões `NSLocationAlwaysAndWhenInUseUsageDescription` e `UIBackgroundModes: location`.

### 19. O projeto está preparado para monetização?
**Não há infraestrutura de billing hoje.** Para suportar o modelo planejado (Free: 2 spots favoritos; Pro: ilimitado, dados de vento avançados e histórico completo), será necessário criar a tabela `subscriptions` / `entitlements`, middleware de verificação de cota e integração com Google Play Billing e RevenueCat/Stripe.

### 20. Onde estão os maiores custos?
1. **Compute Hours do Neon Postgres** devido ao polling agressivo contínuo (SOS a cada 12s, chat a cada 4s, presença a cada 90s).
2. **Quota da API Open-Meteo** (limite gratuito de 10.000 chamadas/dia pode estourar com ~1.000 usuários ativos diários).
3. **Egress de banco** causado por fotos em Data URL base64 armazenadas em colunas `TEXT`.

### 21. Onde estão os maiores riscos de escala?
1. **Polling HTTP Serverless vs WebSockets/SSE**: 1.000 usuários conectados geram ~150 queries SQL por segundo no Neon Serverless.
2. **Rate Limit em Memória**: Ineficaz quando distribuído entre centenas de instâncias serverless.
3. **Falta de Cache Distribuído (Redis/Upstash)** para dados meteorológicos.

### 22. Quais são as 10 correções mais importantes?
1. Fallback de coordenadas para SOS sem GPS (ANT-001).
2. Isenção de rate limit em reenvios/atualizações de SOS ativo (ANT-002).
3. Sanitização HTML em DivIcons do Leaflet contra DOM XSS (ANT-005).
4. Bloqueio de login para contas inativas (`is_active = FALSE`) (ANT-006).
5. Cache offline básico no Service Worker (`sw.js`) para suporte a PWA/TWA (ANT-004).
6. Configuração de Digital Asset Links (`.well-known/assetlinks.json`) para Android TWA (ANT-011).
7. Validação de UUID e unicidade em `PATCH /api/sos/[id]` (ANT-012).
8. Índice composto em `chat_messages(user_id, created_at)` para o rate limiter (ANT-014).
9. Ordenação cronológica real de eventos com coluna `DATE` (ANT-015).
10. Headers de Segurança HTTP (HSTS, CSP, X-Frame-Options) em `next.config.ts` (ANT-008).

### 23. Quais são as 10 melhorias com maior impacto?
1. **Sincronização Offline de Trilha (Outbox IndexedDB)** para navegação e downwind.
2. **Tracking GPS com Foreground Service nativo** (via Capacitor / TWA Plugin).
3. **Push Notifications Nativas via Firebase Cloud Messaging (FCM)** para Android.
4. **Armazenamento de Fotos no Vercel Blob** em substituição ao Base64 inline no Postgres.
5. **Arquitetura de Entitlements e Paywall (Free 2 spots vs Pro)**.
6. **Cache Distribuído de Clima (Upstash Redis / Vercel KV)** para blindar a cota da Open-Meteo.
7. **Substituição de Polling por Server-Sent Events (SSE) / WebSockets** no chat e SOS.
8. **Paginação por Keyset no Logbook (`GET /api/sessions`)**.
9. **Centralização de Rate Limiting no Postgres / Redis**.
10. **Observabilidade e Crash Reporting com Sentry / Axiom**.

---

## 3. MAPA DA ARQUITETURA

### 3.1 Stack Tecnológico
- **Frontend Core**: Next.js 16.3.1 (App Router), React 19.2.8, TypeScript 5.8
- **Estilização & Design**: Tailwind CSS v4 (PostCSS engine), Lucide React
- **Mapas & Geometria**: Leaflet 1.9.4, React-Leaflet 5.0.0, Canvas customizado de partículas de vento
- **Banco de Dados**: Neon Serverless Postgres (`@neondatabase/serverless` HTTP connection pooler)
- **Validação Local**: Vitest 4.1.10, PGlite 0.5.5 (Postgres WASM in-memory)
- **Notificações**: Web Push 3.6.7 (VAPID)
- **Deployment**: Vercel Serverless Functions (Node.js 24 runtime)
- **Distribuição Mobile**: Google Play Store (TWA - Trusted Web Activity)

### 3.2 Estrutura de Diretórios
```
kiteninja/
├── app/                        # Next.js App Router (Rotas e Telas)
│   ├── api/                    # 59 Endpoints de API REST
│   │   ├── admin/              # Gestão de usuários, convites, métricas
│   │   ├── auth/               # Login, logout, sessão, recuperação
│   │   ├── chat/               # Mensagens gerais, por spot e DMs privadas
│   │   ├── cron/               # Cron jobs de escalada de emergência
│   │   ├── downwind/           # Travessias em grupo, convites 12h, posições
│   │   ├── events/             # Calendário de eventos e ocorrências
│   │   ├── feed/               # Feed social com paginação keyset
│   │   ├── listings/           # Marketplace de equipamentos
│   │   ├── notifications/      # Central de notificações in-app
│   │   ├── posts/              # Posts e relatos da comunidade
│   │   ├── profile/            # Perfil do velejador e sessões
│   │   ├── push/               # Inscrição de push subscriptions VAPID
│   │   ├── riders/             # Busca de velejadores e perfis públicos
│   │   ├── sessions/           # Logbook pessoal de navegações
│   │   ├── sos/                # Disparo, consulta ativa, atendimento e encerramento
│   │   └── spots/              # Catálogo de spots e meteorologia
│   ├── convite/[token]/        # Onboarding de convite de uso único
│   ├── dw-motorista/[token]/   # Tela de acompanhamento do apoio em terra
│   ├── manifest.webmanifest/   # Web App Manifest JSON
│   ├── layout.tsx              # Shell raiz, Safe-Areas do iPhone e Viewport
│   └── page.tsx                # Orquestrador de tabs, modals e painéis
├── components/                 # Componentes React reutilizáveis (45+ arquivos)
├── context/                    # Contextos globais (Auth, KiteData, Downwind)
├── data/                       # MockSpots e dados de bootstrap de estações
├── docs/                       # Documentação técnica e arquitetural
├── lib/                        # Regras de negócio puras, DB, auth e testes
├── public/                     # Manifest, Service Worker, logos e ícones
└── scripts/                    # Migrações, seeds e testes de integridade SQL
```

---

## 4. INVENTÁRIO COMPLETO DE ROTAS DE API (59 ROTAS)

| Rota | Método | Auth | Permissão / Ownership | Validação | Rate Limit | Cache |
|---|---|---|---|---|---|---|
| `/api/auth/login` | POST | Pública | Valida credenciais | Email, string | 5 / 15m | `no-store` |
| `/api/auth/logout` | POST | Pública | Invalida cookie | N/A | N/A | `no-store` |
| `/api/auth/me` | GET | Requerida | Retorna perfil próprio | N/A | N/A | `no-store` |
| `/api/auth/recover-password` | POST | Pública | Gera token se existir | Email | 3 / 1h | `no-store` |
| `/api/auth/reset-password` | POST | Pública | Consome token único | Token, senha | N/A | `no-store` |
| `/api/auth/change-password` | POST | Requerida | Senha atual + nova | Senha | N/A | `no-store` |
| `/api/invites/validate` | GET | Pública | Consulta token aberto | Token | 10 / 1h | `no-store` |
| `/api/invites/accept` | POST | Pública | Consome convite | Email, senha | 10 / 1h | `no-store` |
| `/api/admin/users` | GET | Admin | `requireAdmin()` | Query params | N/A | `no-store` |
| `/api/admin/users/[id]` | PATCH | Admin | `requireAdmin()` | Role, active | N/A | `no-store` |
| `/api/admin/invites` | GET, POST | Admin | `requireAdmin()` | Email, note | N/A | `no-store` |
| `/api/admin/invites/[id]` | DELETE | Admin | `requireAdmin()` | UUID | N/A | `no-store` |
| `/api/admin/intro-video` | GET, POST | Admin | `requireAdmin()` | URL / Base64 | N/A | `no-store` |
| `/api/intro-video` | GET | Requerida | Usuário ativo | N/A | N/A | `max-age=300` |
| `/api/spots` | GET | Opcional | Leitura pública | SearchParams | N/A | 10m mem |
| `/api/favorites` | GET, POST, DELETE | Requerida | `WHERE user_id = ${user.id}` | spotId | N/A | `no-store` |
| `/api/feed` | GET | Requerida | `podeVerSessao()` | Cursor ISO | N/A | `no-store` |
| `/api/sessions` | GET, POST | Requerida | `WHERE user_id = ${user.id}` | JSON completo | N/A | `no-store` |
| `/api/sessions/[id]` | GET, PATCH, DELETE | Requerida | Autor da sessão | Campos parciais | N/A | `no-store` |
| `/api/sessions/[id]/like` | POST | Requerida | `WHERE user_id = ${user.id}` | UUID | N/A | `no-store` |
| `/api/sessions/[id]/comments` | GET, POST | Requerida | `WHERE user_id = ${user.id}` | 1 a 1000 chars | N/A | `no-store` |
| `/api/sessions/[id]/comments/[commentId]` | DELETE | Requerida | Autor ou Moderador | UUIDs | N/A | `no-store` |
| `/api/posts` | GET, POST | Requerida | `WHERE user_id = ${user.id}` | Textos | N/A | `no-store` |
| `/api/posts/[id]/like` | POST | Requerida | `WHERE user_id = ${user.id}` | UUID | N/A | `no-store` |
| `/api/posts/[id]/comments` | GET, POST | Requerida | `WHERE user_id = ${user.id}` | Textos | N/A | `no-store` |
| `/api/chat/messages` | GET, POST | Requerida/Convidado | `canAccessDm()` / Downwind | 1000 chars | 10 / min | `no-store` |
| `/api/chat/messages/[id]` | DELETE | Requerida | Autor ou Moderador | UUID | N/A | `no-store` |
| `/api/chat/presence` | POST | Requerida | Atualiza `user_presence` | lat, lng [-90,90] | N/A | `no-store` |
| `/api/chat/dms` | GET | Requerida | Participante da DM | N/A | N/A | `no-store` |
| `/api/riders/search` | GET | Requerida | Usuário autenticado | Min 2 chars | N/A | `no-store` |
| `/api/riders/[id]` | GET | Requerida | Usuário ativo | UUID | N/A | `no-store` |
| `/api/riders/[id]/follow` | POST, DELETE | Requerida | `follower_id <> following_id` | UUID | N/A | `no-store` |
| `/api/notifications` | GET, POST | Requerida | `WHERE recipient_id = ${user.id}` | N/A | N/A | `no-store` |
| `/api/listings` | GET, POST | Requerida | Filtros de busca / Criação | Preço centavos | N/A | `no-store` |
| `/api/listings/[id]` | GET, PATCH, DELETE | Requerida | Autor ou Moderador | Status, dados | N/A | `no-store` |
| `/api/listings/[id]/favorite` | POST, DELETE | Requerida | `WHERE user_id = ${user.id}` | UUID | N/A | `no-store` |
| `/api/events` | GET, POST | Requerida | `canCreateOfficialEvent()` | Tipo evento | N/A | `no-store` |
| `/api/events/[id]` | GET, DELETE | Requerida | Organizador / Admin | UUID | N/A | `no-store` |
| `/api/events/[id]/register` | POST | Requerida | `WHERE user_id = ${user.id}` | UUID | N/A | `no-store` |
| `/api/alerts` | GET, POST | Requerida | Usuário autenticado | Gravidade | N/A | `no-store` |
| `/api/alerts/[id]` | PATCH | Requerida | `canResolveAlert()` | Status | N/A | `no-store` |
| `/api/sos` | POST | Requerida | Disparo de emergência | lat, lng [-90,90] | 3 / 1h | `force-dynamic` |
| `/api/sos/active` | GET | Requerida | Autor, Notificado, Mod | N/A | N/A | `force-dynamic` |
| `/api/sos/[id]/respond` | POST | Requerida | `podeResponderSos()` | Estado, lat, lng | N/A | `force-dynamic` |
| `/api/sos/[id]` | PATCH | Requerida | `canResolveSos()` | Status terminal | N/A | `force-dynamic` |
| `/api/cron/sos-escalada` | GET | Máquina (Bearer) | `CRON_SECRET` obrigatório | N/A | N/A | `force-dynamic` |
| `/api/push/subscribe` | POST, DELETE | Requerida | `WHERE user_id = ${user.id}` | Endpoint, keys | N/A | `force-dynamic` |
| `/api/downwind/ativo` | GET | Requerida | Participante ativo | N/A | N/A | `force-dynamic` |
| `/api/downwind/[id]/posicoes` | GET, POST | Requerida/Convidado | Participante do downwind | lat, lng [-90,90] | 120 / min | `force-dynamic` |
| `/api/downwind/[id]/status` | PATCH | Requerida | Organizador do downwind | Transições válidas | N/A | `force-dynamic` |
| `/api/downwind/[id]/resumo` | GET | Requerida | Participante do downwind | UUID | N/A | `force-dynamic` |
| `/api/downwind/[id]/entrar` | POST | Requerida | Usuário autenticado | Papel | 10 / min | `force-dynamic` |
| `/api/downwind/[id]/participantes/[userId]` | PATCH, DELETE | Requerida | Próprio ou Organizador | Estado, papel | N/A | `force-dynamic` |
| `/api/downwind/[id]/convites` | GET, POST, DELETE | Requerida | Organizador | Papel destino | N/A | `force-dynamic` |
| `/api/downwind/convite/[token]/entrar` | POST | Pública | Token válido | Nome convidado | 10 / min | `force-dynamic` |
| `/api/downwind/convite/sessao` | GET | Convidado | Sessão de convidado 12h | N/A | N/A | `force-dynamic` |
| `/api/profile` | PATCH | Requerida | `WHERE id = ${user.id}` | Allowlist de campos | N/A | `no-store` |
| `/api/profile/sessions` | GET | Requerida | `WHERE user_id = ${user.id}` | N/A | N/A | `no-store` |
| `/api/profile/sessions/[id]` | DELETE | Requerida | `WHERE user_id = ${user.id}` | UUID | N/A | `no-store` |

---

## 5. AUDITORIA DOS 20 CENÁRIOS ADVERSARIAIS DE SOS

| Cenário | Comportamento Observado | Status | Classificação |
|---|---|---|---|
| **CASO 1: SOS Normal com GPS** | Dispara, resolve spot mais próximo, busca candidatos por proximidade (5km), insere socorristas em lote e envia Web Push. | OK | Aprovado |
| **CASO 2: SOS sem GPS fora de Downwind** | Disparo gravado com `lat: null, lng: null`. `selectSosCandidates` retorna `[]`. Zero socorristas notificados. Escalada permanece com 0 notificados. | **FALHA CRÍTICA** | **P0 (ANT-001)** |
| **CASO 3: GPS Inválido (lat: 999)** | Validação em `app/api/sos/route.ts` rejeita com HTTP 400 (`min: -90, max: 90`). | OK | Aprovado |
| **CASO 4: Duplo SOS do mesmo usuário** | Constraint `uniq_sos_aberto_por_usuario` barra duplicatas no banco; código atualiza coordenadas do SOS existente. | OK | Aprovado |
| **CASO 5: Dois SOS simultâneos (usuários distintos)** | Cada usuário possui seu próprio alerta; ambos escalam e notificam independentemente. | OK | Aprovado |
| **CASO 6: Dois requests concorrentes do mesmo SOS** | Cláusula `try/catch` com tratamento de violação de unicidade (código 23505) intercepta a corrida e reaproveita o vencedor. | OK | Aprovado |
| **CASO 7: Nenhum responder disponível** | Alerta permanece em `status: ativo` e aguarda o prazo de escalada (2 min) para ampliar o raio para 15km e depois 50km. | OK | Aprovado |
| **CASO 8: Responder aceita ("a caminho")** | `POST /api/sos/[id]/respond` transiciona alerta para `em_atendimento` e congela escalada. | OK | Aprovado |
| **CASO 9: Responder abandona ("não posso")** | Antiflapping recalcula responsáveis vivos; se count = 0, reabre alerta para `ativo` e reinicia relógio de escalada. | OK | Aprovado |
| **CASO 10: Atacante tenta fingir proximidade** | `podeResponderSos` valida `user_presence` gravada pelo servidor, rejeitando coordenadas forjadas no body. | OK | Aprovado |
| **CASO 11: Escalada de Raio (5 ➔ 15 ➔ 50 km)** | Motor `escalarUmSos` aplica `UPDATE ... AND radius_km = $raioLido`, garantindo idempotência e evitando saltos duplos. | OK | Aprovado |
| **CASO 12: Cron Indisponível (Plano Hobby)** | Cron da Vercel roda apenas 1x/dia. Escalada ocorre em modo preguiçoso via polling de `GET /api/sos/active`. | **PARCIAL** | **P1 (ANT-007)** |
| **CASO 13: Push Indisponível (VAPID ausente/falha)** | Envio em `Promise.allSettled` não aborta a rota; polling in-app de 12s garante recebimento por quem está com o app aberto. | OK | Aprovado |
| **CASO 14: Internet Perdida pelo Acidentado** | Botão SOS exibe estado de falha de rede (`TEXTO_FALHA_REDE`) e destaca botões nativos `tel:193` e `tel:185`. | OK | Aprovado |
| **CASO 15: App Fechado pelo Socorrista (Android/iOS)** | Se Web Push estiver configurado e o dispositivo permitir, o Service Worker desperta e exibe notificação com vibração. | OK | Aprovado |
| **CASO 16: App em Background (Acidentado)** | Se o SOS já foi disparado, o estado persiste no Neon; se o acidentado bloquear a tela, o painel reabre ao desbloquear. | OK | Aprovado |
| **CASO 17: Usuário troca de dispositivo** | Sessão consulta `/api/sos/active` e recupera o SOS ativo emitido pelo seu `user_id`. | OK | Aprovado |
| **CASO 18: SOS Duplicado em Escalada** | Cláusula `ON CONFLICT (sos_id, user_id) DO NOTHING` e set `alreadyNotified` barram envio repetido para o mesmo socorrista. | OK | Aprovado |
| **CASO 19: Race Condition na Escalada (Cron x Poll)** | `UPDATE` condicionado a `radius_km = $raioAtual` faz o segundo request retornar 0 linhas sem reenviar push. | OK | Aprovado |
| **CASO 20: Vazamento de Localização GPS** | `canSeePos` em `GET /api/sos/active` só entrega `lat`/`lng` para o autor, moderadores e socorristas em `sos_responders`. | OK | Aprovado |

---

## 6. AUDITORIA DE PREPARAÇÃO MOBILE & DISTRIBUIÇÃO PLAY STORE

### 6.1 Estado Atual: Google Play Store (TWA)
O aplicativo já está publicado e instalado via Play Store utilizando a tecnologia **Trusted Web Activity (TWA)**.
- **Vantagens**: Atualizações instantâneas de código sem necessidade de aprovação da loja; reutilização total da base Next.js.
- **Gargalos Detectados**:
  1. **Ausência de `/.well-known/assetlinks.json`**: Se o arquivo de associação de domínio não estiver servido com SHA-256 da chave de assinatura da Play Store, o Android exibe a barra superior do navegador Chrome (URL bar), quebrando a imersão de app nativo.
  2. **Ausência de Modo Offline no Service Worker**: Se o velejador abrir o app na praia sem sinal de 4G, a WebView do Android exibe erro nativo de rede em vez de carregar a casca do app.
  3. **Suspensão de Background Geolocation**: O Android suspende o WebView após alguns minutos de tela bloqueada, interrompendo o tracking de downwind.

### 6.2 Matriz de Prontidão de Recursos Mobile

| Recurso | Web (Browser) | Play Store (TWA) | Capacitor (Híbrido Nativo) | iOS App Store (Nativo) |
|---|---|---|---|---|
| **Geolocalização Foreground** | Total | Total | Total | Total |
| **Geolocalização Background** | Bloqueia ao fechar tela | Bloqueia ao fechar tela | Requer Background Plugin | Requer Location Always Mode |
| **Web Push (VAPID)** | Total (Chrome/Edge) | Total (FCM via Chrome) | Requer `@capacitor/push` | Requer APNs + PWA Standalone |
| **Screen Wake Lock** | Chrome/Safari 16.4+ | Total | Plugin nativo | Plugin nativo |
| **Vibração Táctil** | Android sim / iOS não | Total no Android | Plugin Haptics | Plugin Haptics |
| **Monetização In-App** | Stripe Web | Google Play Billing (Digital Goods API) | `@capacitor-community/purchases` | StoreKit 2 Nativo |
| **Modo Offline** | Parcial (se houver cache) | Parcial | Total (assets locais) | Total (assets locais) |

---

## 7. ARQUITETURA DE MONETIZAÇÃO (FREE VS PRO)

Para atender ao modelo de negócio solicitado (plano Free limitado a 2 spots favoritos e histórico reduzido; plano Pro com spots ilimitados, radar de vento em alta definição e exportação GPX):

### Modelo Relacional Proposto (Sem Impacto no Schema Atual)
```sql
CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier           TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'vip', 'founder')),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'trialing')),
  provider       TEXT CHECK (provider IN ('play_store', 'app_store', 'stripe', 'manual')),
  provider_sub_id TEXT,
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Pontos de Aplicação de Entitlements (Gates)
1. **Spots Favoritos**: Em `app/api/favorites/route.ts:POST`, checar contagem `SELECT COUNT(*) FROM favorites WHERE user_id = $1`. Se `tier === 'free'` e `count >= 2`, rejeitar com HTTP 402/403 e código `UPGRADE_REQUIRED`.
2. **Histórico de Velejos (Logbook)**: Em `app/api/sessions/route.ts:GET`, filtrar sessões com mais de 30 dias para contas free.
3. **Métricas Avançadas**: Radar de maré harmônica calibrada e rajadas máximas disponíveis na visualização detalhada.
