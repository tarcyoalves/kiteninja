# Rastreamento em Background — Android

## Status

**IMPLEMENTADO**: Backend (Next.js) + Foreground Service Android (Capacitor)
+ adapter TypeScript que finalmente liga os dois (`lib/downwindTracker.ts`,
integrado em `context/DownwindContext.tsx`).
`./gradlew assembleDebug` compila com sucesso (verificado em 2026-08-25) —
`com.google.android.gms:play-services-location:21.3.0` está resolvida e
pinada em `android/app/build.gradle`. O bloqueio de SSL/rede relatado
anteriormente neste arquivo não existe mais no ambiente atual.

**Correção nesta rodada (25/08/2026): o plugin existia e compilava, mas
nenhuma linha de TS/React o chamava.** `startTracking`/`stopTracking` nunca
eram invocados — o Foreground Service era código morto do ponto de vista do
app. Corrigido com `lib/downwindTracker.ts` (adapter + decisão pura,
testados) integrado em `DownwindContext`. Ao mesmo tempo, dois bugs no lado
Android foram corrigidos (ver "Correções de permissão" abaixo):
`DownwindTrackerPlugin.java` chamava `call.resolve()` antes do resultado real
da permissão e usava `@ActivityCallback` (incompatível com
`requestPermissions` manual do Capacitor); e `MainActivity` pedia localização
no primeiro launch, antes de qualquer downwind existir.

**NÃO IMPLEMENTADO** (fora do escopo desta etapa, ver "O que falta" abaixo):
isenção de otimização de bateria no app,
testes instrumentados (`androidTest`) de `DownwindTrackerPlugin`/
`RastreioDownwindService` (são Java Android — fora do runner Vitest deste
repo; a decisão de QUANDO rastrear e o adapter que chama o plugin, do lado
TypeScript, têm cobertura de teste — ver `lib/downwindTracker.test.ts`).

**IMPLEMENTADO NESTA RODADA (25/08/2026)**: alerta de silêncio no servidor
(detecção automática de participantes que param de reportar + notificação push
a organizadores e apoio). Ver item 2 na seção "Limitações conhecidas".

---

## Integração TypeScript/React (25/08/2026)

### O que faltava

`android/app/src/main/java/br/com/kiteninja/app/tracking/DownwindTrackerPlugin.java`
existia, compilava e expunha `startTracking`/`stopTracking`/`isTracking`/
`setAuthToken` — mas nenhum arquivo `.ts`/`.tsx` do app importava
`@capacitor/core` nem chamava esses métodos. O Foreground Service Android,
por mais correto que fosse, nunca era iniciado por ninguém.

### O que foi adicionado

- **`lib/downwindTracker.ts`** — adapter novo:
  - `DownwindTracker = registerPlugin<DownwindTrackerPlugin>('DownwindTracker')`
    — ponte real com o plugin nativo, no mesmo padrão de
    `lib/usePushNotifications.ts` (import de `@capacitor/core`, não lazy —
    `@capacitor/core` já é dependência direta do projeto e não carrega código
    nativo por si só, diferente do `@capacitor/push-notifications` que a
    função `init()` de `usePushNotifications` importa via `await import(...)`).
  - `estaNoAppNativo()` — mesmo teste de `'Capacitor' in window` usado por
    `useIsNativeApp()`, mas via `Capacitor.isNativePlatform()`.
  - `decidirTracking(estado)` — função **pura**, testável sem mock de
    Capacitor: recebe autenticação, papel, status do downwind e estado do
    participante, devolve `boolean`. É aqui que mora a regra "rastreia só
    quando velejador + downwind `em_andamento` + participante
    `confirmado`/`navegando` + dentro do app nativo" — o mesmo filtro que
    `app/api/downwind/[id]/tracking-token/route.ts` já aplica no servidor
    (a UI só evita uma chamada fadada a 409/403, o servidor é quem decide
    de verdade).
  - `iniciarTrackingNativo({ downwindId, baseUrl, obterToken })` — busca o
    token (via callback injetado, não `fetch` direto — mantém o adapter
    testável) e chama `startTracking`. Devolve `{ ok, permissaoNegada?, error? }`
    em vez de lançar, para a UI tratar permissão negada honestamente em vez
    de como erro genérico.
  - `pararTrackingNativo()` — chama `stopTracking()`, best-effort (nunca lança).

- **`context/DownwindContext.tsx`** — dois `useEffect` novos:
  - Liga o tracking nativo quando `decidirTracking()` fica `true` (entrada:
    `isAuthenticated`, `downwindAtivo.minhaParticipacao.papel/estado`,
    `downwindAtivo.status`) e desliga quando qualquer uma dessas condições
    deixa de valer — cobre downwind encerrado/cancelado (via `recarregar()`
    trazendo o novo `status`), participação encerrada/desistida (idem, via
    `estado`), e logout (`isAuthenticated` cai para `false`).
  - Não há cleanup de desmontagem da WebView: fechar/remover o app dos
    recentes é exatamente o caso em que o Foreground Service precisa continuar.
    A parada ocorre por mudança real de negócio (logout, encerramento,
    desistência/cancelamento), ação da notificação, token inválido, teto de
    duração ou excesso de falhas.
  - Expõe `statusTrackingNativo: 'inativo' | 'ativo' | 'permissao_negada' | null`
    no contexto — `null` em PWA/browser (o conceito não existe lá), os outros
    três só dentro do app nativo. Não expõe mais estado que isso: o pedido
    foi "estado mínimo", e qualquer tela que precise reagir a
    `'permissao_negada'` já tem o que precisa para mostrar um aviso.

- **`lib/downwindTracker.test.ts`** — cobre `decidirTracking` com uma matriz
  de estados (autenticado/não, papel, status do downwind, estado do
  participante, dentro/fora do app nativo) e `iniciarTrackingNativo`/
  `pararTrackingNativo` com o plugin mockado via `vi.mock('@capacitor/core')`.

### Por que não duplica o beacon web

`lib/useDownwindBeacon.ts` (o beacon web, `fetch` a cada 45s via
`setInterval`) continua rodando exatamente como antes, sem nenhuma alteração
neste arquivo. Os dois mecanismos cobrem cenários diferentes e sobrepostos de
propósito:

| Cenário | Beacon web | Foreground Service nativo |
|---|---|---|
| App aberto, tela ligada | Cobre | Cobre (redundante, sem problema) |
| App aberto, tela apagada (Wake Lock ativo) | Cobre | Cobre |
| App fechado / removido dos recentes | **Não cobre** (JS não roda) | Cobre |
| PWA / navegador (sem Capacitor) | Cobre | Não existe (`decidirTracking` retorna `false`) |

O servidor só grava a posição mais recente por `downwind_posicoes` — rodar os
dois ao mesmo tempo quando o app está aberto é redundância aceita, não um bug
de duplicação de linha ou de efeito colateral duplicado.

### Correções de permissão no lado Android nesta rodada

1. **`DownwindTrackerPlugin.java`**: a versão anterior chamava
   `ActivityCompat.requestPermissions(...)` manualmente e, na mesma função,
   `call.resolve()` **antes** de saber se a permissão foi concedida — o
   JavaScript recebia sucesso mesmo quando o usuário ia negar a permissão a
   seguir. O callback de resultado usava `@ActivityCallback`, anotação
   destinada a resultados de `Activity` (`startActivityForResult`), não a
   resultados de permissão — incompatível com o fluxo de
   `requestPermissions` manual que o método tentava implementar. Corrigido
   para o padrão oficial do Capacitor 8 (o mesmo que
   `@capacitor/push-notifications` usa): `@CapacitorPlugin(permissions =
   @Permission(strings = {...}, alias = "location"))` no nível da classe,
   `requestPermissionForAlias(LOCATION, call, "onLocationPermissionResult")`
   dentro de `startTracking`, e `@PermissionCallback` (não
   `@ActivityCallback`) no método `onLocationPermissionResult(PluginCall
   call)`. `call.resolve()`/`call.reject()` agora só acontecem dentro do
   callback, depois que `getPermissionState(LOCATION)` confirma o resultado
   real.
2. **`MainActivity.java`**: pedia `ACCESS_FINE_LOCATION`/
   `ACCESS_COARSE_LOCATION` em `onCreate()`, ou seja, no primeiro launch do
   app, antes de o usuário saber por quê. Removido — a permissão agora só é
   solicitada de forma contextual, no momento em que o velejador de fato
   confirma que vai rastrear uma travessia (`DownwindTrackerPlugin
   .startTracking()`, disparado por `lib/downwindTracker.ts`) ou quando o
   navegador/WebView pede via `navigator.geolocation` ao abrir o mapa (fluxo
   já tratado pelo `BridgeWebChromeClient` do Capacitor, sem código
   adicional). `MainActivity` ficou só com o registro do plugin.

---

## O que foi implementado

### Backend (Next.js)

1. **`registradoEm` no POST de posições** (`app/api/downwind/[id]/posicoes/route.ts`)
   - Aceita timestamp opcional para o app nativo reportar posição com o horário real de coleta
   - Valida: rejeita timestamp no futuro ou mais velho que 6h
   - Destrava outbox offline do PWA

2. **Tabela de tokens de rastreio** (`lib/schema.sql`)
   - `downwind_tracking_tokens` com hash SHA-256
   - Escopo por downwind (token só vale para o downwind que o gerou)
   - Expiração (24h) e revogação

3. **Emissão de token** (`app/api/downwind/[id]/tracking-token/route.ts`)
   - Gera token quando velejador inicia downwind em primeiro plano
   - Requer papel 'velejador' e estado 'navegando' ou 'confirmado'

4. **Bearer token na rota de posições** (`app/api/downwind/[id]/posicoes/route.ts`)
   - Aceita `Authorization: Bearer <token>` além de sessão web
   - Token é validado e escopo verificado

5. **Revogação ao encerrar** (`app/api/downwind/[id]/status/route.ts`)
   - Tokens são revogados quando downwind termina (encerrado ou cancelado)
   - Notificação FCM opcional para parar o serviço

### Android

1. **Foreground Service** (`RastreioDownwindService.java`)
   - Coleta GPS a cada 45s (mesma cadência do beacon web)
   - Notificação persistente enquanto ativo
   - Ação de parar na notificação
   - Fila local para posições offline (em memória — perdida se o processo
     for matado; ver limitação nº 4 abaixo)
   - Teto de duração de 8h (`MAX_SERVICE_DURATION_MS`): desliga sozinho
     mesmo que a mensagem FCM de encerramento se perca
   - Encerra ao receber HTTP 401/403 do servidor (token revogado/expirado) —
     não fica retentando uma credencial morta
   - Encerra após 10 falhas de envio consecutivas (rede fora do ar)

2. **Plugin Capacitor** (`DownwindTrackerPlugin.java`)
   - `startTracking(downwindId, authToken, baseUrl)`
   - `stopTracking()`
   - `isTracking()`

3. **Permissões Android** (`AndroidManifest.xml`)
   - `FOREGROUND_SERVICE`
   - `FOREGROUND_SERVICE_LOCATION`
   - `ACCESS_FINE_LOCATION`

---

## Limitações conhecidas

### 1. Force-stop do app
**Não funciona após force-stop.** Isso é comportamento padrão do Android — mesmo Foreground Services são mortos pelo sistema após force-stop, e nenhum código de app consegue se manter vivo depois disso. Isto NÃO é simulado como funcionando: é uma limitação de plataforma, documentada aqui e refletida na notificação/UX (o app não promete "funciona mesmo se você forçar o encerramento").

**Mitigação real possível**: alerta de silêncio no servidor (ver item 2 abaixo) — não recupera o rastreio, mas garante que alguém em terra saiba que ele parou.

### 2. Alerta de silêncio no servidor — IMPLEMENTADO
O plano original (`docs/PLANO-RASTREIO-BACKGROUND-ANDROID.md`) previa: se um
participante `navegando` parar de reportar por X minutos num downwind
`em_andamento`, avisar organizador e apoio em terra. **IMPLEMENTADO em 25/08/2026.**

**O que foi implementado:**

- **Tabela `downwind_silencio_alertas`** (`lib/schema.sql`): registra cada
  silêncio detectado para garantir idempotência — não notifica
  repetidamente sobre o mesmo período.
- **Motor de detecção** (`lib/downwindSilencio.ts`):
  - Varre participantes `navegando`/`confirmado` em downwinds `em_andamento`
  - Compara última posição com timestamp atual (ajustado por grace period desde
    `iniciado_em` do downwind)
  - Limiar configurável via `app_settings` (padrão: 5 minutos de silêncio)
  - Grace period de 2 minutos desde o início do downwind (para não alertar quem
    ainda não teve tempo de reportar)
- **Rota cron** (`app/api/cron/downwind-silencio/route.ts`):
  - Autenticada por `CRON_SECRET` (mesmo padrão do SOS)
  - Agenda real: GitHub Actions a cada 5 minutos (ver "Agendamento" abaixo —
    o Vercel Hobby não aceita frequência de minuto)
  - Limpa alertas resolvidos com mais de 7 dias
- **Integração com rota de posições** (`app/api/downwind/[id]/posicoes/route.ts`):
  - Quando uma nova posição é recebida, o silêncio é automaticamente marcado
    como "resolvido"
  - Permite que o sistema alerte novamente se houver novo silêncio posterior
- **Notificações**:
  - Usa `sendPushToUsers` (Web Push + FCM) para notificar organizadores e
    apoio designado
  - Tag `downwind_silencio_{downwindId}` agrupa notificações por downwind
  - URL de deep link para o mapa do downwind

**Configuração** (via `app_settings`, chave `downwind_silencio_config`):
```json
{
  "silencioSegundos": 300,
  "graceInicioSegundos": 120,
  "habilitado": true
}
```
- `silencioSegundos`: tempo máximo sem posição antes de alertar (padrão: 300s = 5min)
- `graceInicioSegundos`: grace period desde o início do downwind (padrão: 120s = 2min)
- `habilitado`: ativa/desativa o sistema de alertas

**Agendamento (corrigido em 25/08/2026 — a versão anterior deste documento
pedia `*/2 * * * *` no `vercel.json`, que o plano Hobby REJEITA no deploy;
só cron diário é aceito nesse plano):**

- `vercel.json` agenda `/api/cron/downwind-silencio` em `0 4 * * *`
  (1x/dia) — mesma limitação do Hobby documentada em `docs/OPERACAO-SOS.md`
  para o SOS. Sozinho, isso é quase inútil para um limiar de 5 minutos.
- A varredura frequente de verdade roda em
  `.github/workflows/cron-varredura.yml`: GitHub Actions `schedule` a cada
  5 minutos, chamando `/api/cron/sos-escalada` e `/api/cron/downwind-silencio`
  com `Authorization: Bearer $CRON_SECRET` (mesmo segredo do Vercel,
  guardado como **GitHub Actions secret** `CRON_SECRET` no repositório).
  A URL base é configurável via **GitHub Actions variable** `APP_BASE_URL`
  (cai em `https://kiteninja.vercel.app` se a variável não estiver
  definida).
- **Limitação conhecida do GitHub Actions**: `schedule` não garante o
  minuto exato — sob carga da plataforma a execução pode atrasar vários
  minutos. Isso significa que o tempo real de detecção de silêncio pode
  exceder os 5 minutos configurados em `downwind_silencio_config`. Não há
  contorno gratuito para isso; para precisão de minuto, é necessário o
  plano Pro da Vercel (cron `* * * * *`) ou um scheduler externo dedicado
  (cron-job.org, Upstash QStash).
- O workflow usa `curl --fail` (falha o job se a rota responder erro) e
  `concurrency` com `cancel-in-progress: false` para não duplicar chamadas
  se uma execução atrasada ainda estiver rodando quando a próxima disparar.

### 3. Fabricantes agressivos
Xiaomi, Huawei, Oppo, Vivo e Samsung matam serviços em background de forma mais agressiva que o Android puro, mesmo sendo Foreground Service.

**Mitigação**:
- Pedir isenção de otimização de bateria (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) — NÃO implementado nesta etapa
- Instruir usuário a fixar app em "sem restrições" (tela por fabricante) — NÃO implementado nesta etapa
- Alerta de silêncio no servidor (item 2 acima) — IMPLEMENTADO

### 4. Fila offline em memória, não persistente
`RastreioDownwindService.pendingLocations` é uma `List` em memória. Se o
processo do serviço for matado (fabricante agressivo, `onDestroy` chamado
pelo sistema por pressão de memória), a fila e as posições nela enfileiradas
são perdidas — elas não sobrevivem a um restart do serviço. O plano original
pede Room/SQLite para isso; não foi implementado nesta etapa. Limite atual:
100 posições em memória (~75 minutos de coleta a 45s/posição).

### 5. Testes automatizados do lado Android
`RastreioDownwindService.java` e `DownwindTrackerPlugin.java` não têm teste
automatizado (unitário ou instrumentado) nesta etapa. A validação foi:
compilação (`./gradlew assembleDebug`) e revisão do fluxo de código. Um teste
de integração real (serviço rodando, GPS mockado, app fechado) exige
instrumentação Android (`androidTest`) fora do runner Vitest deste repo.

---

## Fluxo de uso

1. **Usuário confirma participação e o downwind entra em `em_andamento`**
   (primeiro plano). `DownwindContext` recalcula `decidirTracking()` a cada
   mudança de `downwindAtivo`/`isAuthenticated`.
2. **`DownwindContext` chama** `iniciarTrackingNativo()`
   (`lib/downwindTracker.ts`), que primeiro faz
   `POST /api/downwind/{id}/tracking-token` → recebe token.
3. **`iniciarTrackingNativo` chama** `DownwindTracker.startTracking({ downwindId, authToken, baseUrl })`.
4. **Se a permissão de localização não foi concedida ainda**, o plugin nativo
   pede agora — de forma contextual, não no primeiro launch do app (ver
   correção em `MainActivity.java` acima). Se negada,
   `statusTrackingNativo` vira `'permissao_negada'` no contexto.
5. **Foreground Service inicia** - notificação persistente aparece.
   `statusTrackingNativo` vira `'ativo'`.
6. **Usuário pode fechar o app** - serviço continua coletando.
7. **A cada 45s**: serviço coleta GPS e envia com Bearer token.
8. **Downwind encerra, participação encerra/desiste, ou logout** (qualquer
   um dos três):
   - Servidor revoga tokens (downwind encerrado/cancelado) e envia FCM opcional.
   - `DownwindContext` detecta a mudança de estado na próxima revalidação e
     chama `pararTrackingNativo()` — `statusTrackingNativo` volta a `'inativo'`.
   - A WebView pode ser destruída quando o app sai dos recentes sem desligar o
     serviço; o Foreground Service continua independente da árvore React.

---

## Segurança

- Token é 32 bytes (alta entropia), só hash é guardado no banco
- Escopo restrito: token só funciona para o downwind que o gerou
- Não dá acesso à conta, apenas reporta posições
- Expiração de 24h (ou quando downwind encerra)
- Rate limiting aplicado mesmo para Bearer token

---

## Testes recomendados

### Backend
- `POST /api/downwind/{id}/tracking-token` → 200 com token
- `POST /api/downwind/{id}/posicoes` com Bearer token → 200
- `POST /api/downwind/{id}/posicoes` com Bearer token errado → 401
- `POST /api/downwind/{id}/posicoes` com `registradoEm` válido
- `POST /api/downwind/{id}/status` com `para: 'encerrado'` → tokens revogados

### Android (manual)
- Iniciar downwind no app
- Verificar que notificação de rastreamento aparece
- Fechar o app (remover dos recentes)
- Verificar que posições continuam sendo enviadas
- Encerrar downwind
- Verificar que serviço para

---

## Files modificados/criados

### Backend
- `app/api/downwind/[id]/posicoes/route.ts` - registradoEm + Bearer
- `app/api/downwind/[id]/tracking-token/route.ts` - NOVO
- `app/api/downwind/[id]/status/route.ts` - revoga tokens
- `lib/trackingToken.ts` - NOVO
- `lib/schema.sql` - downwind_tracking_tokens

### Android
- `android/app/src/main/AndroidManifest.xml` - permissões + serviço
- `android/app/src/main/java/br/com/kiteninja/app/RastreioDownwindService.java` - NOVO nesta linha do trabalho; teto de duração (8h), encerramento em HTTP 401/403 e por excesso de falhas consecutivas (rede de segurança independente do FCM); nesta rodada (25/08/2026) — timeouts de conexão/leitura (15s), `disconnect()` em `finally`, mudança para `START_NOT_STICKY` (ver seção "Correções de bugs" abaixo)
- `android/app/src/main/java/br/com/kiteninja/app/tracking/DownwindTrackerPlugin.java` - permissões reescritas para o sistema `@CapacitorPlugin`/`@Permission`/`@PermissionCallback` do Capacitor 8 (antes: `@ActivityCallback` incompatível + `call.resolve()` antes do resultado real da permissão); nesta rodada (25/08/2026) — validação de `baseUrl` (só https em produção), estado de `isTracking` persistido em `SharedPreferences` + checagem via `ActivityManager` (ver seção "Correções de bugs" abaixo)
- `android/app/src/main/java/br/com/kiteninja/app/MainActivity.java` - removida a solicitação de localização no primeiro launch; ficou só com o registro do plugin
- `android/app/build.gradle` - dependência `play-services-location:21.3.0` pinada e ativa (não está mais comentada; `assembleDebug` compila)

### TypeScript/React (integração nesta rodada — 25/08/2026)
- `lib/downwindTracker.ts` - NOVO. Adapter (`registerPlugin`) + decisão pura
  (`decidirTracking`) + `iniciarTrackingNativo`/`pararTrackingNativo`.
- `lib/downwindTracker.test.ts` - NOVO. Cobre `decidirTracking` (matriz de
  estados) e o adapter com `@capacitor/core` mockado.
- `context/DownwindContext.tsx` - integra o adapter: liga/desliga o
  Foreground Service conforme `downwindAtivo`/`isAuthenticated`, expõe
  `statusTrackingNativo` no contexto.

### Alerta de silêncio no servidor (25/08/2026)
- `lib/downwindSilencio.ts` - NOVO. Motor de detecção de silêncios,
  configuração via app_settings, resolução automática quando o velejador volta
  a reportar.
- `lib/downwindSilencio.test.ts` - NOVO. Testes unitários do motor
  (config padrão/customizada, grace period, detecção, resolução).
- `app/api/cron/downwind-silencio/route.ts` - NOVO. Rota cron autenticada
  por CRON_SECRET.
- `app/api/downwind/[id]/posicoes/route.ts` - chama resolverSilencio() ao
  receber nova posição.
- `lib/schema.sql` - tabela `downwind_silencio_alertas` para idempotência.
- `scripts/verify-sql.ts` - adiciona `downwind_silencio_alertas` à lista de
  tabelas verificadas.
- `lib/authz.test.ts` - declara `cron/downwind-silencio/route.ts` como rota
  de máquina (mesma categoria de `cron/sos-escalada`).
- `vercel.json` - cron job diário (`0 4 * * *`) para
  `/api/cron/downwind-silencio` — manutenção/fallback, não a varredura
  principal (ver "Agendamento" acima: Hobby não aceita frequência de minuto).
- `.github/workflows/cron-varredura.yml` - NOVO. Workflow com `schedule` a
  cada 5 minutos que chama `/api/cron/sos-escalada` e
  `/api/cron/downwind-silencio` com `Authorization: Bearer` — é esta a
  varredura frequente de verdade, não o cron do Vercel.

---

## Correções de bugs (25/08/2026)

Esta seção documenta as correções aplicadas nesta rodada aos arquivos Java
do Android (`RastreioDownwindService.java` e `DownwindTrackerPlugin.java`).

### 1. HttpURLConnection sem timeout

**Problema**: As conexões HTTP em `sendLocation()` e `flushPendingLocations()` não
definiam `connectTimeout` nem `readTimeout`. Isso podia travar o executor
indefinidamente se a rede ficasse lenta ou o servidor não respondesse.

**Correção**: Adicionados timeouts de 15 segundos para conexão e leitura:
```java
conn.setConnectTimeout(15000);  // 15s - tempo razoável para rede móvil
conn.setReadTimeout(15000);     // 15s - tempo para resposta do servidor
```

### 2. disconnect() não estava em finally

**Problema**: `conn.disconnect()` era chamado apenas após sucesso na leitura da
resposta. Se ocorresse exceção entre `openConnection()` e `getResponseCode()`,
a conexão ficava aberta.

**Correção**: `disconnect()` agora está em bloco `finally`, garantindo sempre
fecha a conexão:
```java
try {
    responseCode = conn.getResponseCode();
} finally {
    conn.disconnect();  // Sempre desconecta, mesmo em caso de exceção
}
```

### 3. START_STICKY sem persistência

**Problema**: O serviço retornava `START_STICKY`, que reinicia o serviço após
ser morto pelo sistema. Porém, se o serviço fosse morto e restartado pelo
sistema sem uma Intent (ex: app foi fechado e reopened), os dados do Intent
(`downwindId`, `authToken`, `apiBaseUrl`) seriam `null`, causando falha na
validação e encerramento desnecessário.

**Correção**: Mudado para `START_NOT_STICKY`. O serviço NÃO é reiniciado
automaticamente após morte pelo sistema. A persistência de estado agora está
no plugin (SharedPreferences), não no serviço — se o app for reaberto, o
`DownwindContext` recalcula e reinicia o tracking corretamente. Isso também
evita o cenário onde um restart acidental sem Intent válido tenta rodar
indefinidamente com dados nulos.

### 4. Validação de URL (https em produção)

**Problema**: O plugin aceitava qualquer URL, incluindo HTTP em produção, o que
poderia expor dados sensíveis em texto puro.

**Correção**: Adicionada validação em `DownwindTrackerPlugin.validarBaseUrl()`:
- Produção (`debuggable == false`): apenas HTTPS
- Desenvolvimento: permite HTTP para localhost e redes locais (127.x.x.x,
  10.x.x.x, 192.168.x.x)

### 5. isTracking usa estado volátil

**Problema**: `isTracking()` no plugin verificava apenas `currentDownwindId`,
uma variável de instância. Após recreation do plugin (ex: mudança de
configuração, reinício do app), esse estado era perdido, retornando
incorretamente `false`.

**Correção**:
- Adicionado `SharedPreferences` para persistir `downwindId` entre recreations
  do plugin.
- A fonte de verdade de `isTracking()` passou a ser o **serviço realmente em
  execução**, verificado via `ActivityManager.getRunningServices()` — não o
  SharedPreferences isoladamente. Isso importa porque o serviço pode se
  autoencerrar (teto de 8h, HTTP 401/403, falhas consecutivas — ver
  `RastreioDownwindService.stopSelfService()`) sem nunca avisar o plugin; se
  `isTracking()` confiasse só no SharedPreferences, reportaria `true` para um
  tracking que já parou.
- Quando `isTracking()` detecta essa divergência (serviço parado mas
  SharedPreferences ainda diz `true`), corrige o estado persistido na hora
  (autocura), evitando que o valor obsoleto seja lido novamente depois.
- O estado é salvo em `startTrackingService()` e limpo em `stopTracking()`.

### 6. registradoEm formato

**Verificado**: O servidor aceita `registradoEm` como número (timestamp Unix
millis) ou string ISO. O código Java envia `location.getTime()` que retorna
milliseconds desde epoch — formato aceito pela validação `validarRegistroEm()`
em `app/api/downwind/[id]/posicoes/route.ts`. O formato está correto.

---

Arquivos explicitamente NÃO tocados nesta rodada, por instrução: FCM
(`lib/push.ts`, `lib/usePushNotifications.ts`), SOS, CI.
