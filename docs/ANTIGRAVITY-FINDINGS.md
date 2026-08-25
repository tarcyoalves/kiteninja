# KITE NINJA — REGISTRO DETALHADO DE ACHADOS (FINDINGS)
## AGENTE: ANTIGRAVITY · MODO AUDITORIA PROFUNDA
## CLASSIFICAÇÃO RIGOROSA · PROVAS E EVIDÊNCIAS DE CÓDIGO

---

### ANT-001
- **SEVERIDADE**: P0
- **CATEGORIA**: SOS / Life-Safety
- **TÍTULO**: Disparo de SOS sem coordenadas fora de downwind ativo falha silenciosamente em notificar qualquer socorrista
- **PROVA**:
  - **Arquivo**: `lib/sosCandidates.ts`
  - **Linhas**: 74-79, 91-96, 156-160
  - **Funções**: `selectSosCandidates`, `candidatosPorProximidade`, `candidatosPorDownwind`
  - **Comportamento observado**:
    ```ts
    // Em app/api/sos/route.ts:168:
    const candidatos = await selectSosCandidates({
      excludeUserId: user.id,
      origin: lat !== null && lng !== null ? { lat, lng } : null,
      radiusKm,
    });

    // Em lib/sosCandidates.ts:74-79:
    const [porDownwind, porProximidade] = await Promise.all([
      candidatosPorDownwind(args.excludeUserId, args.origin),
      args.origin
        ? candidatosPorProximidade(args.excludeUserId, args.origin, args.radiusKm)
        : Promise.resolve([] as CandidatoSos[]),
    ]);
    ```
    Quando o GPS do celular falha ou atinge o timeout de 3s na água (`origin === null`):
    1. `candidatosPorProximidade` é ignorado e retorna `[]`.
    2. `candidatosPorDownwind` busca participantes onde `d.status = 'em_andamento'`. Se o velejador estiver velejando sozinho ou fora de um evento de downwind, retorna `[]`.
    3. `selectSosCandidates` retorna `[]`.
    4. `app/api/sos/route.ts` insere zero linhas em `sos_responders` e dispara zero Web Pushes.
    5. A escalada em `lib/sosEscalada.ts:113` repete exatamente a mesma condição (`origin: alerta.lat !== null && alerta.lng !== null ? ... : null`), mantendo a lista vazia a 15km e 50km.
- **IMPACTO**: Risco direto à vida. O velejador em apuros vê na tela "SOS Enviado", mas ninguém na comunidade é avisado, nenhum socorrista é escalado e o alerta morre silencioso no banco de dados.
- **REPRODUÇÃO**:
  1. Logar com um usuário que não está em nenhum downwind em andamento.
  2. Disparar SOS com geolocalização desativada ou simulando timeout de GPS (`POST /api/sos` com `{}`).
  3. Verificar o retorno da API: `notificados: 0`.
  4. Consultar a tabela `sos_responders`: zero linhas associadas ao alerta.
- **RISCO**: Crítico (Life-Safety).
- **SOLUÇÃO RECOMENDADA**:
  Quando `origin === null`:
  1. Consultar a última presença do usuário em `user_presence` (`pos_updated_at` recente ou `at_spot_id`).
  2. Se houver spot declarado (`at_spot_id`) ou `home_spot` no perfil do usuário, usar as coordenadas do spot como origem de fallback.
  3. Se não houver coordenada nenhuma, notificar os moderadores/administradores do sistema e todos os velejadores com presença online ativa nas últimas 2 horas no mesmo estado/região.
- **COMPLEXIDADE**: Média.
- **REGRESSÃO**: Testar em `scripts/verify-sos.ts` cenário de disparo sem GPS fora de downwind garantindo notificação de fallback por spot declarado ou perfil.

---

### ANT-002
- **SEVERIDADE**: P1
- **CATEGORIA**: SOS / Rate Limiting
- **TÍTULO**: Rate limit de SOS é cobrado antes de deduplicar e bloqueia atualização de coordenadas de quem está à deriva
- **PROVA**:
  - **Arquivo**: `app/api/sos/route.ts`
  - **Linhas**: 24-25, 48-53
  - **Função**: `POST`
  - **Comportamento observado**:
    ```ts
    const user = await requireUser();
    rateLimiters.sos(user.id); // <-- Linha 25: cobra cota (limite 3/hora)

    const aberto = await sql`
      SELECT id, lat, lng, spot_id, radius_km, status
      FROM sos_alerts
      WHERE user_id = ${user.id} AND status IN ('ativo', 'em_atendimento')
    `;
    ```
    A chamada a `rateLimiters.sos(user.id)` ocorre na linha 25, ANTES de consultar se já existe um SOS ativo na linha 48. O limite é de 3 chamadas por hora (`lib/rateLimit.ts:117`). Se o velejador aperta o botão SOS para atualizar suas coordenadas enquanto deriva no mar (ex: 1º disparo, 2º reenvio após 500m, 3º reenvio após 1km), na 4ª tentativa a requisição é rejeitada com HTTP 429 ("Aguarde 1 hora").
- **IMPACTO**: O acidentado é impedido de atualizar sua localização de deriva para os socorristas.
- **REPRODUÇÃO**:
  1. Executar 3 requisições seguidas para `POST /api/sos` com o mesmo usuário.
  2. Executar a 4ª requisição com novas coordenadas GPS.
  3. Observar retorno: `HTTP 429 - Limite de chamadas SOS atingido`.
- **RISCO**: Alto.
- **SOLUÇÃO RECOMENDADA**:
  Mover a cobrança do rate limit para depois da checagem de SOS aberto, aplicando rate limit apenas na criação de um NOVO alerta, e aplicando uma taxa bem mais permissiva (ex: 60/hora) para atualizações de posição do mesmo alerta.
- **COMPLEXIDADE**: Baixa.
- **REGRESSÃO**: Testar 5 disparos consecutivos do mesmo usuário garantindo que atualizações de posição passem e que apenas criação de novo alerta respeite o limite.

---

### ANT-003
- **SEVERIDADE**: P1
- **CATEGORIA**: GPS / Tracking / Mobile
- **TÍTULO**: Rastreamento de Downwind e Presença cessa imediatamente quando a tela é bloqueada ou app vai para background
- **PROVA**:
  - **Arquivo**: `lib/useDownwindBeacon.ts` e `lib/usePositionBeacon.ts`
  - **Linhas**: 47 em `useDownwindBeacon.ts`, 84 em `usePositionBeacon.ts`
  - **Função**: `useDownwindBeacon`, `usePositionBeacon`
  - **Comportamento observado**:
    ```ts
    const enviar = async () => {
      if (emVoo.current || document.hidden) return; // <-- Interrompe ao bloquear a tela
      ...
    ```
    Ao colocar o celular no bolso ou estojo estanque, a tela apaga e `document.hidden` torna-se `true`. O `setInterval` do beacon é abortado pela guarda `document.hidden`. Nenhum ponto de GPS é transmitido enquanto a tela estiver desligada.
- **IMPACTO**: Em travessias longas de downwind (1h a 3h), o carro de apoio e os outros velejadores deixam de receber a posição do atleta assim que ele guarda o celular.
- **REPRODUÇÃO**:
  1. Iniciar o rastreamento em `DownwindAoVivoView`.
  2. Minimizar o navegador ou bloquear a tela do celular.
  3. Monitorar os logs de rede: nenhuma requisição para `/api/downwind/[id]/posicoes` é disparada.
- **RISCO**: Alto (Segurança em travessia).
- **SOLUÇÃO RECOMENDADA**:
  1. Para Web/PWA: Avisar explicitamente o velejador para manter a tela ligada no suporte ou braçadeira via Modo Navegação com `useWakeLock`.
  2. Para App Android (Play Store) / Capacitor: Integrar Foreground Service nativo com notificação persistente para manter a coleta de GPS ativa em background.
- **COMPLEXIDADE**: Média.
- **REGRESSÃO**: Testar ciclo de vida do beacon em segundo plano.

---

### ANT-004
- **SEVERIDADE**: P1
- **CATEGORIA**: PWA / Android Play Store
- **TÍTULO**: Ausência de manipulador de cache/offline no Service Worker (`public/sw.js`)
- **PROVA**:
  - **Arquivo**: `public/sw.js`
  - **Linhas**: 1-79
  - **Comportamento observado**:
    O `sw.js` implementa apenas os listeners `push`, `notificationclick`, `install` e `activate`. Não existe listener de `fetch` ou estratégia de cache (Cache-First / Stale-While-Revalidate) para a casca do app e assets estáticos (`/_next/static/*`).
- **IMPACTO**: Ao abrir o aplicativo instalado pela Google Play Store (TWA) em uma praia com sinal fraco ou sem 4G, o app trava em tela branca ou exibe a página de erro de conexão do Chromium (`ERR_INTERNET_DISCONNECTED`).
- **REPRODUÇÃO**:
  1. Abrir o app no celular.
  2. Ativar o Modo Avião.
  3. Fechar e reabrir o aplicativo.
  4. O app falha em carregar qualquer tela inicial.
- **RISCO**: Alto (UX e conformidade PWA).
- **SOLUÇÃO RECOMENDADA**:
  Implementar cache de casca (App Shell) e assets imutáveis no Service Worker com fallback offline gracioso informando que os dados em tempo real dependem de conexão.
- **COMPLEXIDADE**: Média.
- **REGRESSÃO**: Testar abertura offline do app em ambiente PWA e navegador.

---

### ANT-005
- **SEVERIDADE**: P1
- **CATEGORIA**: Security / DOM XSS
- **TÍTULO**: Injeção HTML / DOM XSS em marcadores Leaflet DivIcon de SOS e Socorristas
- **PROVA**:
  - **Arquivo**: `components/LeafletMap.tsx`
  - **Linhas**: 177-195, 198-214
  - **Funções**: `createSosMarkerIcon`, `createResponderMarkerIcon`
  - **Comportamento observado**:
    ```ts
    function createSosMarkerIcon(reduceMotion: boolean, authorName?: string): L.DivIcon {
      const html = `
        ...
        <span>SOS${authorName ? ` • ${authorName}` : ''}</span>
      `;
      return L.divIcon({ html, ... });
    }
    ```
    O Leaflet injeta a string `html` diretamente via `innerHTML` no DOM. `authorName` e `name` são campos de texto livre cadastrados em `users.name` e não passam por `escaparHtml` (diferente de `DownwindMapa.tsx`, onde `escaparHtml` é utilizado).
- **IMPACTO**: Um usuário malicioso pode cadastrar um nome contendo payloads HTML/SVG (ex: `<img src=x onerror=... />`), que serão executados no navegador de todos os velejadores que abrirem o mapa com SOS ativo.
- **REPRODUÇÃO**:
  1. Alterar o nome no perfil para `Velejador <img src=x onerror="alert(document.domain)">`.
  2. Disparar um SOS.
  3. Abrir a aba Mapa em outro dispositivo conectado.
  4. O script é executado no contexto do DOM do visualizador.
- **RISCO**: Alto (Vulnerabilidade de Execução de Script).
- **SOLUÇÃO RECOMENDADA**:
  Importar e aplicar `escaparHtml(authorName)` e `escaparHtml(name)` de `lib/htmlEscape.ts` em todas as interpolações de strings para `L.divIcon`.
- **COMPLEXIDADE**: Baixa.
- **REGRESSÃO**: Testar exibição de nomes com caracteres especiais (`<`, `>`, `&`, `"`) no mapa.

---

### ANT-006
- **SEVERIDADE**: P1
- **CATEGORIA**: Autenticação / Segurança
- **TÍTULO**: Rota de login permite autenticação com sucesso de contas suspensas (`is_active = FALSE`)
- **PROVA**:
  - **Arquivo**: `app/api/auth/login/route.ts`
  - **Linhas**: 26-37
  - **Função**: `POST`
  - **Comportamento observado**:
    ```ts
    const rows = await sql`
      SELECT id, password_hash, name, role, must_change_password
      FROM users WHERE LOWER(email) = ${email} LIMIT 1
    `;
    ```
    A consulta do login não inclui `AND is_active = TRUE`. Se a senha estiver correta, `createSession` é executado, a sessão é gravada no banco e a API responde HTTP 200 com os dados do usuário. Contudo, na requisição seguinte (`GET /api/auth/me`), `getSessionUser()` filtra por `u.is_active = TRUE` e retorna `null`, gerando comportamento inconsistente e deslogando o usuário imediatamente sem mensagem clara de suspensão.
- **IMPACTO**: Falha de integridade no fluxo de desativação administrativa de contas.
- **REPRODUÇÃO**:
  1. Desativar um usuário via painel admin (`is_active = FALSE`).
  2. Realizar login com as credenciais corretas desse usuário.
  3. A resposta do login é 200 OK, mas o app entra em loop de deslogamento na tela seguinte.
- **RISCO**: Médio.
- **SOLUÇÃO RECOMENDADA**:
  Adicionar `AND is_active = TRUE` na consulta de login ou retornar HTTP 403 explícito ("Esta conta foi suspensa pela moderação").
- **COMPLEXIDADE**: Baixa.
- **REGRESSÃO**: Testar tentativa de login com conta desativada.

---

### ANT-007
- **SEVERIDADE**: P1
- **CATEGORIA**: SOS / Infraestrutura
- **TÍTULO**: Cron Job de escalada de SOS na Vercel roda apenas 1x ao dia (`0 3 * * *`) no plano Hobby
- **PROVA**:
  - **Arquivo**: `vercel.json`
  - **Linhas**: 1-10
  - **Comportamento observado**:
    `vercel.json` define `"schedule": "0 3 * * *"`. Como a Vercel restringe cron jobs a no máximo 1 execução por dia no plano gratuito (Hobby), a varredura periódica de escaladas não roda de minuto em minuto. A escalada em minutos depende exclusivamente de usuários ativos fazendo polling na rota `/api/sos/active`.
- **IMPACTO**: Em uma terça-feira de manhã com praia vazia e nenhum velejador com o app aberto por perto, um SOS emitido sem socorristas iniciais demora até que alguém abra o app para escalar o raio.
- **REPRODUÇÃO**:
  1. Disparar um SOS em ambiente isolado.
  2. Fechar todos os navegadores.
  3. Aguardar 5 minutos sem abrir o app: o raio permanece em 5 km.
- **RISCO**: Alto.
- **SOLUÇÃO RECOMENDADA**:
  Configurar um webhook/cron externo confiável (ex: GitHub Actions, cron-job.org, Cloudflare Worker) batendo em `/api/cron/sos-escalada` a cada 1 minuto com o header `Authorization: Bearer $CRON_SECRET`.
- **COMPLEXIDADE**: Baixa.
- **REGRESSÃO**: Testar chamada autenticada ao endpoint de cron e verificar escalada autônoma de SOS no banco.

---

### ANT-008
- **SEVERIDADE**: P1
- **CATEGORIA**: Segurança / Headers
- **TÍTULO**: `next.config.ts` vazio sem nenhum cabeçalho de segurança HTTP (HSTS, CSP, X-Frame-Options)
- **PROVA**:
  - **Arquivo**: `next.config.ts`
  - **Linhas**: 1-8
  - **Comportamento observado**:
    O arquivo `next.config.ts` possui apenas `const nextConfig: NextConfig = {};`. Não há configuração de `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` nem `Content-Security-Policy`.
- **IMPACTO**: Vulnerabilidade a clickjacking (enquadramento do KiteNinja em iframe malicioso), downgrade de HTTPS e vazamento de `Referer` para serviços externos.
- **REPRODUÇÃO**:
  1. Inspecionar os headers de resposta de `https://kiteninja.vercel.app/` via `curl -I`.
  2. Verificar ausência de `Content-Security-Policy` e `X-Frame-Options`.
- **RISCO**: Médio.
- **SOLUÇÃO RECOMENDADA**:
  Adicionar a função `headers()` em `next.config.ts` com CSP estrito configurado para permitir tiles do Leaflet (OpenStreetMap, ArcGIS, CartoDB), APIs da Open-Meteo e Vercel Blob.
- **COMPLEXIDADE**: Média.
- **REGRESSÃO**: Verificar que o mapa, webcams e uploads continuem carregando normalmente após ativação do CSP.

---

### ANT-009
- **SEVERIDADE**: P2
- **CATEGORIA**: Performance / Banco de Dados
- **TÍTULO**: Armazenamento de imagens em Base64 Data URL diretamente no PostgreSQL (`TEXT`)
- **PROVA**:
  - **Arquivo**: `app/api/profile/route.ts` e `lib/schema.sql`
  - **Linhas**: 37 em `app/api/profile/route.ts`, 380 em `lib/schema.sql`
  - **Comportamento observado**:
    `avatarUrl` aceita strings de até 1.500.000 caracteres (1.5MB) gravadas diretamente na coluna `users.avatar_url`. Da mesma forma, `listing_photos.data_url` armazena fotos completas no banco relacional.
- **IMPACTO**: Bloat massivo das tabelas no Neon Postgres, consumo excessivo de memória ao listar usuários ou feed e alto custo de egress de rede.
- **REPRODUÇÃO**:
  1. Fazer upload de foto de perfil via `PATCH /api/profile`.
  2. Verificar que o payload JSON armazena 1.5MB de base64 no banco.
- **RISCO**: Médio.
- **SOLUÇÃO RECOMENDADA**:
  Utilizar o `@vercel/blob` já presente em `package.json` para realizar upload direto para o bucket e armazenar apenas a URL HTTPS no banco de dados.
- **COMPLEXIDADE**: Média.
- **REGRESSÃO**: Testar upload e exibição de fotos de perfil e anúncios.

---

### ANT-010
- **SEVERIDADE**: P2
- **CATEGORIA**: Performance / Weather Engine
- **TÍTULO**: `GET /api/spots` faz requests concorrentes sem cache distribuído compartilhado
- **PROVA**:
  - **Arquivo**: `lib/weather.ts` e `app/api/spots/route.ts`
  - **Linhas**: 35 em `lib/weather.ts`, 119 em `app/api/spots/route.ts`
  - **Comportamento observado**:
    O cache de meteorologia é mantido em um `Map` na memória da instância lambda (`CACHE_TTL_MS = 10 * 60 * 1000`). Em cold starts ou quando múltiplos usuários acessam instâncias diferentes, cada lambda dispara dezenas de chamadas HTTP para `api.open-meteo.com` e `marine-api.open-meteo.com`.
- **IMPACTO**: Risco de estourar o limite gratuito diário da Open-Meteo (10.000 requisições/dia) e lentidão de até 8s na carga inicial dos spots.
- **REPRODUÇÃO**:
  1. Forçar cold start da rota `/api/spots`.
  2. Monitorar latência e quantidade de requisições de saída para a Open-Meteo.
- **RISCO**: Médio.
- **SOLUÇÃO RECOMENDADA**:
  Integrar camada de cache compartilhado (Upstash Redis ou Vercel KV) para armazenar as previsões por coordenada com TTL de 15 minutos.
- **COMPLEXIDADE**: Média.
- **REGRESSÃO**: Testar atualização de dados de vento e maré nos spots.

---

### ANT-011
- **SEVERIDADE**: P2
- **CATEGORIA**: Mobile / Play Store TWA
- **TÍTULO**: Ausência de `assetlinks.json` para verificação de Digital Asset Links no Android TWA
- **PROVA**:
  - **Arquivo**: `public/.well-known/assetlinks.json`
  - **Comportamento observado**:
    O diretório `.well-known` não existe em `public/`. Em aplicativos Android TWA, a ausência de Digital Asset Links impede a verificação da assinatura do APK com a origem web, forçando o Chrome a exibir a barra superior do navegador.
- **IMPACTO**: Degradação da experiência visual do app instalado pela Google Play Store.
- **REPRODUÇÃO**:
  1. Acessar `https://kiteninja.vercel.app/.well-known/assetlinks.json`.
  2. Receber HTTP 404.
- **RISCO**: Médio (UX / Mobile).
- **SOLUÇÃO RECOMENDADA**:
  Criar o arquivo `public/.well-known/assetlinks.json` contendo o pacote `app.kiteninja.twa` e o fingerprint SHA-256 da chave de assinatura da Play Store.
- **COMPLEXIDADE**: Baixa.
- **REGRESSÃO**: Validar abertura do app sem barra de navegação no Android.

---

### ANT-012
- **SEVERIDADE**: P2
- **CATEGORIA**: API / Validação
- **TÍTULO**: `app/api/sos/[id]/route.ts` não valida formato UUID do parâmetro `id`
- **PROVA**:
  - **Arquivo**: `app/api/sos/[id]/route.ts`
  - **Linhas**: 14, 19-21
  - **Comportamento observado**:
    ```ts
    const { id } = await context.params;
    const sosId = id; // <-- Não usa uuid({ id }, 'id')
    const alerts = await sql`SELECT user_id FROM sos_alerts WHERE id = ${sosId}`;
    ```
    Diferente de `sos/[id]/respond/route.ts:32`, este endpoint não valida o formato UUID. Um parâmetro malformado como `/api/sos/invalido` gera erro 500 de conversão do Postgres em vez de 400.
- **IMPACTO**: Respostas 500 desnecessárias no log do servidor.
- **REPRODUÇÃO**:
  1. Executar `PATCH /api/sos/teste-invalido` com payload de status.
  2. Observar retorno 500 do Postgres.
- **RISCO**: Baixo.
- **SOLUÇÃO RECOMENDADA**:
  Adicionar `const sosId = uuid({ id }, 'id');`.
- **COMPLEXIDADE**: Baixa.
- **REGRESSÃO**: Testar encerramento de SOS com IDs válidos e inválidos.

---

### ANT-013
- **SEVERIDADE**: P2
- **CATEGORIA**: UX / GPS Watcher
- **TÍTULO**: Watcher de GPS do mapa não é restabelecido automaticamente ao retornar de segundo plano
- **PROVA**:
  - **Arquivo**: `views/MapView.tsx`
  - **Linhas**: 92-113
  - **Comportamento observado**:
    O hook escuta `visibilitychange` e, se `document.hidden === true`, executa `limparWatch()`. Contudo, ao retornar para o app (`document.hidden === false`), não há gatilho para reiniciar o `watchPosition`.
- **IMPACTO**: O usuário precisa tocar manualmente no botão de localização toda vez que alterna entre apps.
- **REPRODUÇÃO**:
  1. Ativar a localização no mapa.
  2. Trocar de aplicativo e retornar ao KiteNinja.
  3. O ponto do usuário deixa de se mover automaticamente.
- **RISCO**: Baixo (UX).
- **SOLUÇÃO RECOMENDADA**:
  Adicionar reinício automático do watch caso o status anterior fosse `success`.
- **COMPLEXIDADE**: Baixa.
- **REGRESSÃO**: Testar persistência do indicador de localização ao minimizar e reabrir a aba.

---

### ANT-014
- **SEVERIDADE**: P2
- **CATEGORIA**: Banco de Dados / Índices
- **TÍTULO**: Consulta de rate limit de chat não possui índice em `(user_id, created_at)`
- **PROVA**:
  - **Arquivo**: `app/api/chat/messages/route.ts` e `lib/schema.sql`
  - **Linhas**: 231-236 em `app/api/chat/messages/route.ts`, 414 em `lib/schema.sql`
  - **Comportamento observado**:
    A rota de envio de mensagem executa:
    `SELECT COUNT(*)::int FROM chat_messages WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 minute'`
    O único índice existente em `chat_messages` é `(room, created_at DESC)`. Como o filtro é por `user_id`, a query realiza Bitmap Heap Scan ou Filter sobre a tabela toda.
- **IMPACTO**: Degradação de performance no chat conforme a tabela `chat_messages` acumula milhares de mensagens.
- **REPRODUÇÃO**:
  1. Popular a tabela `chat_messages` com 100.000 mensagens.
  2. Executar `EXPLAIN ANALYZE` na query de rate limit.
  3. Observar custo elevado de busca por `user_id`.
- **RISCO**: Médio (Escalabilidade).
- **SOLUÇÃO RECOMENDADA**:
  Adicionar índice: `CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created ON chat_messages (user_id, created_at DESC);`.
- **COMPLEXIDADE**: Baixa.
- **REGRESSÃO**: Executar `verify-sql.ts`.

---

### ANT-015
- **SEVERIDADE**: P3
- **CATEGORIA**: UX / Eventos
- **TÍTULO**: Ordenação de eventos oficiais em `app/api/events/route.ts` é alfabética por texto
- **PROVA**:
  - **Arquivo**: `app/api/events/route.ts` e `lib/schema.sql`
  - **Linhas**: 36 em `app/api/events/route.ts`, 316 em `lib/schema.sql`
  - **Comportamento observado**:
    A tabela `events` armazena `event_date TEXT NOT NULL`. A consulta executa `ORDER BY e.event_date ASC`. Como o campo contém texto como `"15 de Outubro"` ou `"20 de Janeiro"`, a ordenação é lexicográfica pelas letras do texto e não cronológica por data.
- **IMPACTO**: Eventos são exibidos em ordem temporal incorreta na lista.
- **REPRODUÇÃO**:
  1. Cadastrar um evento para "10 de Dezembro" e outro para "20 de Janeiro".
  2. O evento de Dezembro aparece antes do de Janeiro por causa do "1" vs "2".
- **RISCO**: Baixo.
- **SOLUÇÃO RECOMENDADA**:
  Adicionar coluna `event_timestamp TIMESTAMPTZ` na tabela `events` para ordenação cronológica precisa.
- **COMPLEXIDADE**: Baixa.
- **REGRESSÃO**: Testar listagem do calendário de eventos.

---

### ANT-016
- **SEVERIDADE**: P3
- **CATEGORIA**: Performance / API
- **TÍTULO**: Carga do Logbook (`GET /api/sessions`) carrega até 500 trilhas JSONB em uma única requisição
- **PROVA**:
  - **Arquivo**: `app/api/sessions/route.ts`
  - **Linhas**: 78
  - **Comportamento observado**:
    `GET /api/sessions` possui `LIMIT 500` e retorna o array completo de sessões incluindo `trilha_reduzida` (JSONB) para cada sessão.
- **IMPACTO**: Se um velejador assíduo tiver 200 sessões gravadas com GPS, a resposta JSON pode ultrapassar 1.5MB a cada abertura da aba Logbook.
- **REPRODUÇÃO**:
  1. Criar 200 sessões com trilhas completas.
  2. Chamar `GET /api/sessions`.
  3. Observar tamanho do payload de resposta.
- **RISCO**: Baixo.
- **SOLUÇÃO RECOMENDADA**:
  Implementar paginação por cursor/keyset (ex: 20 por página) ou não devolver a `trilha_reduzida` na listagem geral, carregando a geometria apenas ao abrir a sessão individual (`GET /api/sessions/[id]`).
- **COMPLEXIDADE**: Média.
- **REGRESSÃO**: Testar renderização do histórico de sessões.
