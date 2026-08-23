-- KiteNinja — schema Postgres (Neon)
-- Idempotente: pode rodar várias vezes sem erro.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- usuários
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'rider' CHECK (role IN ('admin', 'moderator', 'instructor', 'rider')),
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  deactivated_at  TIMESTAMPTZ,
  avatar_url      TEXT,
  rider_id        TEXT NOT NULL,
  nationality     TEXT NOT NULL DEFAULT 'Brasil',
  country_flag    TEXT NOT NULL DEFAULT '🇧🇷',
  weight_kg       NUMERIC(5,2) NOT NULL DEFAULT 75,
  rider_level     TEXT NOT NULL DEFAULT 'Intermediário',
  home_spot       TEXT,
  disciplines     TEXT[] NOT NULL DEFAULT ARRAY['Kitesurf Twintip'],
  quiver_kites    NUMERIC(3,1)[] NOT NULL DEFAULT '{}',
  quiver_boards   TEXT[] NOT NULL DEFAULT '{}',
  preferred_wind_unit TEXT NOT NULL DEFAULT 'knots' CHECK (preferred_wind_unit IN ('knots', 'kmh', 'mph', 'ms')),
  highest_jump_m  NUMERIC(4,1),
  bio             TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS quiver_kites NUMERIC(3,1)[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS quiver_boards TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_wind_unit TEXT NOT NULL DEFAULT 'knots';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_user_agent TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ip TEXT;
-- Altura do velejador, ao lado de weight_kg no perfil auto-atendido.
ALTER TABLE users ADD COLUMN IF NOT EXISTS height_cm NUMERIC(5,1);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users (is_active);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users (last_login_at DESC);
-- GET /api/riders/search filtra por LOWER(name) ILIKE '%termo%'. Um substring
-- no meio do texto não usa este índice como igualdade pura, mas com poucos
-- milhares de riders o planner do Postgres ainda prefere varrer o índice
-- (mais compacto que a tabela inteira, que carrega bio/quiver/e-mail) a
-- varrer a tabela — o ganho cresce junto com a base, que é exatamente quando
-- table scan linha a linha começa a doer.
CREATE INDEX IF NOT EXISTS idx_users_busca_nome ON users (LOWER(name));

-- ------------------------------------------------------- convites (1 uso só)
-- O admin gera um link único. `token_hash` guarda SHA-256 do token: se o banco
-- vazar, os links em aberto não são utilizáveis. `used_at` garante uso único.
CREATE TABLE IF NOT EXISTS invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   TEXT NOT NULL UNIQUE,
  email        TEXT,
  note         TEXT,
  created_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  used_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invites_token_hash ON invites (token_hash);
CREATE INDEX IF NOT EXISTS idx_invites_open ON invites (expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

-- ---------------------------------------------------------------- sessões
CREATE TABLE IF NOT EXISTS auth_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  user_agent  TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id);

-- ------------------------------------------------------------------- spots
CREATE TABLE IF NOT EXISTS spots (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  location             TEXT NOT NULL,
  state                TEXT NOT NULL,
  country              TEXT NOT NULL DEFAULT 'Brasil',
  country_flag         TEXT NOT NULL DEFAULT '🇧🇷',
  lat                  DOUBLE PRECISION NOT NULL,
  lng                  DOUBLE PRECISION NOT NULL,
  wind_safety          TEXT NOT NULL,
  water_condition      TEXT NOT NULL,
  bottom_type          TEXT NOT NULL,
  difficulty           TEXT NOT NULL,
  ideal_wind_directions TEXT[] NOT NULL DEFAULT '{}',
  hazards              TEXT[] NOT NULL DEFAULT '{}',
  amenities            TEXT[] NOT NULL DEFAULT '{}',
  webcam_url           TEXT,
  webcam_live_stream   BOOLEAN NOT NULL DEFAULT FALSE,
  cover_image          TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- favoritos por usuário (antes era campo global no spot)
CREATE TABLE IF NOT EXISTS favorites (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spot_id    TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, spot_id)
);

-- --------------------------------------------------- histórico de navegações
CREATE TABLE IF NOT EXISTS sessions_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spot_id          TEXT REFERENCES spots(id) ON DELETE SET NULL,
  spot_name        TEXT NOT NULL,
  spot_location    TEXT NOT NULL,
  date             DATE NOT NULL,
  start_time       TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  discipline       TEXT NOT NULL,
  kite_size_m2     NUMERIC(4,1) NOT NULL,
  board_model      TEXT,
  avg_wind_knots   NUMERIC(5,2) NOT NULL,
  max_gust_knots   NUMERIC(5,2),
  wind_direction   TEXT,
  tide_condition   TEXT,
  water_condition  TEXT,
  rating           SMALLINT NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  distance_km      NUMERIC(6,2),
  max_speed_knots  NUMERIC(5,2),
  highest_jump_m   NUMERIC(4,1),
  notes            TEXT,
  photo_url        TEXT,
  is_public        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions_log (user_id, date DESC);

-- Trilha da sessão solo (Modo Navegação) — mesmo formato e mesma redução de
-- downwind_participantes.trilha_reduzida (ver comentário lá): JSONB com no
-- máximo ~200 pontos [[lat, lng, tsMs], ...], reduzido por amostrarTrilha()
-- antes de gravar. Sem isso o feed social (fase futura) não teria geometria
-- para desenhar no card da sessão.
--
-- lat_inicial/lng_inicial existem para o feed conseguir enquadrar o mapa (ou
-- decidir o zoom/centro de um mini-mapa) sem precisar ler e desserializar o
-- JSONB inteiro só para achar o primeiro ponto — útil sobretudo numa lista
-- com várias sessões renderizando ao mesmo tempo.
ALTER TABLE sessions_log ADD COLUMN IF NOT EXISTS trilha_reduzida JSONB;
ALTER TABLE sessions_log ADD COLUMN IF NOT EXISTS lat_inicial NUMERIC(9,6);
ALTER TABLE sessions_log ADD COLUMN IF NOT EXISTS lng_inicial NUMERIC(9,6);

-- Curtir/comentar a SESSÃO diretamente (Fase 3 do plano de rede social,
-- seção 4.2) — mesmo desenho de post_likes/post_comments abaixo, só que
-- pendurado em sessions_log em vez de posts. Antes desta tabela, "curtir um
-- velejo" só funcionava indiretamente (via post_likes JOIN posts, e só se o
-- autor também tivesse criado um post sobre a sessão) — na prática o contador
-- do feed era sempre 0. GET /api/feed passa a ler daqui, não da consulta velha.
CREATE TABLE IF NOT EXISTS session_likes (
  session_id UUID NOT NULL REFERENCES sessions_log(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- PK composta, sem coluna `id` avulsa — mesmo motivo de user_follows e
  -- post_likes: a EXISTÊNCIA da linha já é o estado "curtiu". Consequência
  -- direta (e o ponto principal desta constraint): curtir a mesma sessão duas
  -- vezes é violação de chave primária no banco, não uma checagem que a UI
  -- precisa lembrar de fazer — a rota usa ON CONFLICT DO NOTHING por cima,
  -- mas mesmo um INSERT cru (bug de cliente, replay de rede) nunca duplica.
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS session_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions_log(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_comments ON session_comments (session_id, created_at);

-- Resposta a comentário de sessão (Fase 6, estilo Facebook: só 1 nível — uma
-- resposta nunca pode ter outra resposta pendurada nela, ver lib/social.ts
-- podeResponderComentario). NULL = comentário de primeiro nível (como hoje).
ALTER TABLE session_comments ADD COLUMN IF NOT EXISTS parent_comment_id UUID REFERENCES session_comments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_session_comments_parent ON session_comments (parent_comment_id);

-- Central de notificações in-app (Fase 6) — SEM push de propósito (decisão
-- do dono: "só dentro do app"). actor_id é quem PRATICOU a ação (curtiu,
-- comentou, respondeu, seguiu); recipient_id é quem RECEBE o aviso. CHECK
-- (actor_id <> recipient_id) é a segunda camada de defesa contra
-- auto-notificação (a primeira é o código da rota — lib/notificacoes.ts,
-- criarNotificacao — nunca inserir quando os dois IDs são iguais) — mesmo
-- princípio de duas camadas já usado no CHECK de auto-follow (user_follows)
-- e auto-DM (parseRoomName em lib/chat.ts).
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('curtida_sessao', 'comentario_sessao', 'resposta_comentario', 'novo_seguidor')),
  session_id   UUID REFERENCES sessions_log(id) ON DELETE CASCADE,
  comment_id   UUID REFERENCES session_comments(id) ON DELETE CASCADE,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (actor_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications (recipient_id, created_at DESC);

-- Consulta do feed (GET /api/feed, Fase 3): keyset por created_at DESC,
-- SEMPRE filtrando por is_public = TRUE para toda sessão que não é a minha
-- (lib/social.ts, podeVerSessao) — a própria sessão privada do usuário nunca
-- passa por este índice porque cai no outro ramo do OR (ver a rota), então um
-- índice PARCIAL "WHERE is_public" cobre exatamente o ramo caro da consulta:
-- sessões de quem eu sigo. Sem o parcial, o Postgres teria que varrer e
-- ordenar TODA sessions_log (inclusive as privadas de todo mundo, que nunca
-- aparecem no feed de ninguém) só para achar as 15 públicas mais recentes.
-- Mesmo princípio de idx_sos_active/idx_downwinds_ativos acima.
CREATE INDEX IF NOT EXISTS idx_sessions_feed ON sessions_log (created_at DESC) WHERE is_public;

-- -------------------------------------------------------- feed da comunidade
CREATE TABLE IF NOT EXISTS posts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id     UUID REFERENCES sessions_log(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,
  spot_name      TEXT,
  spot_location  TEXT,
  photo_url      TEXT,
  wind_knots     NUMERIC(5,2),
  wind_kite_used TEXT,
  wind_condition TEXT,
  tag            TEXT,
  shares         INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON post_comments (post_id, created_at);

-- --------------------------------------------------------------- grafo social
-- Seguir assimétrico (Strava/Surfr), não amizade com pedido/aceite — ver
-- seção 4.1 do plano (docs/PLANO-REDE-SOCIAL.md). "Amigo" não existe como
-- linha aqui: é o que a UI mostra quando as duas linhas (A segue B, B segue
-- A) existem ao mesmo tempo — lib/social.ts, relacaoComRider().
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- PK composta (não um `id` avulso): a existência da linha JÁ É o estado do
  -- follow, mesmo desenho de post_likes/listing_favorites acima. Consequência
  -- direta: seguir alguém que já se segue é violação de chave primária no
  -- banco, não uma regra que a UI precisa lembrar de checar — o mesmo INSERT
  -- que criaria o duplicado é rejeitado antes de existir.
  PRIMARY KEY (follower_id, following_id),
  -- Barreira no banco contra auto-follow, além da checagem em lib/social.ts
  -- (podeSeguir) — duas camadas, mesmo princípio de `salaDireta` rejeitar
  -- auto-DM em lib/chat.ts: a rota erra bonito com 400, e o banco garante que
  -- nenhum outro caminho de escrita (script, migração futura, bug) consiga
  -- criar a linha mesmo assim.
  CHECK (follower_id <> following_id)
);

-- "Quem me segue": todo perfil e toda notificação de novo seguidor consulta
-- por following_id (a PK já cobre "quem eu sigo", que entra por follower_id).
CREATE INDEX IF NOT EXISTS idx_follows_following ON user_follows (following_id);

-- ------------------------------------------------------ segurança e eventos
CREATE TABLE IF NOT EXISTS safety_alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  spot_name   TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('alerta', 'perigo', 'informativo')),
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'Ativo' CHECK (status IN ('Ativo', 'Resolvido')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_status ON safety_alerts (status, created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  event_date  TEXT NOT NULL,
  location    TEXT NOT NULL,
  spot_name   TEXT,
  type        TEXT NOT NULL,
  description TEXT NOT NULL,
  organizer   TEXT NOT NULL,
  image_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_registrations (
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

-- ------------------------------------------- marketplace de equipamento usado
-- Classificados da comunidade: kite, prancha, barra, trapézio, foil, wing.
--
-- `price_cents` é BIGINT em centavos, nunca NUMERIC/float: preço de equipamento
-- é dinheiro, e float acumula erro em soma/comparação (0,1 + 0,2 ≠ 0,3). Todo o
-- app converte para reais só na hora de exibir.
CREATE TABLE IF NOT EXISTS listings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  category          TEXT NOT NULL CHECK (category IN (
                      'Kite', 'Prancha', 'Barra', 'Trapézio', 'Foil',
                      'Wing', 'Neoprene', 'Acessório', 'Outro')),
  condition         TEXT NOT NULL CHECK (condition IN (
                      'Novo', 'Semi-novo', 'Usado', 'Bem usado', 'Para reparo')),
  price_cents       BIGINT NOT NULL CHECK (price_cents >= 0),
  negotiable        BOOLEAN NOT NULL DEFAULT TRUE,
  brand             TEXT,
  model             TEXT,
  year_manufactured SMALLINT,
  -- Tamanho depende da categoria: kite/wing/foil vendem em m², prancha em cm.
  size_m2           NUMERIC(4,1),
  size_cm           SMALLINT,
  city              TEXT NOT NULL,
  state             TEXT NOT NULL,
  -- 'Removido' em vez de DELETE: quem já negociou pelo anúncio mantém o
  -- histórico, e o velejador consegue reativar sem recadastrar tudo.
  status            TEXT NOT NULL DEFAULT 'Ativo' CHECK (status IN (
                      'Ativo', 'Reservado', 'Vendido', 'Removido')),
  views_count       INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- O feed padrão é "ativos, mais recentes primeiro": índice composto cobre a
-- ordenação sem sort em disco.
CREATE INDEX IF NOT EXISTS idx_listings_status_created ON listings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings (category);
CREATE INDEX IF NOT EXISTS idx_listings_state ON listings (state);
CREATE INDEX IF NOT EXISTS idx_listings_user ON listings (user_id);

-- Fotos em tabela separada porque são até 6 por anúncio e cada data URL pesa
-- centenas de KB: manter no listings faria o feed carregar tudo em cada linha.
CREATE TABLE IF NOT EXISTS listing_photos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  data_url   TEXT NOT NULL,
  position   SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listing_photos_order ON listing_photos (listing_id, position);

-- Chave composta e sem coluna `id`, igual a favorites/post_likes: a existência
-- da linha é o próprio estado do favorito, o que torna o toggle atômico.
CREATE TABLE IF NOT EXISTS listing_favorites (
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (listing_id, user_id)
);

-- ------------------------------------------------ chat de velejadores online
-- Uma sala geral mais uma sala por spot. `room` guarda 'geral' ou 'spot:<id>'
-- em vez de uma FK para spots: a sala geral não tem spot, e um spot removido do
-- catálogo não deve apagar a conversa de quem velejou lá. Em troca, o formato
-- do nome é validado na rota (lib/chat.ts) — sem isso, qualquer texto viraria
-- uma sala fantasma que ninguém encontra.
CREATE TABLE IF NOT EXISTS chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room       TEXT NOT NULL,
  -- O CHECK repete o limite da validação de propósito: a rota pode ter bug, o
  -- banco não. 1000 caracteres é recado de praia, não artigo.
  text       TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A leitura do chat é sempre "últimas N desta sala" e o polling incremental
-- ainda filtra por created_at: o índice composto cobre as duas sem sort.
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages (room, created_at DESC);

-- Presença é DERIVADA de `last_seen_at`, nunca um booleano `is_online`.
--
-- O navegador do celular fecha sem avisar: o velejador perde sinal ao entrar na
-- água, a tela apaga, o iOS mata a aba em background. Nenhum desses casos gera
-- um evento de "saída" que possamos gravar, então um flag ficaria travado em
-- TRUE para sempre e a lista de "quem está na água" encheria de fantasmas.
-- Com timestamp, ausência de heartbeat já significa offline:
--   online = last_seen_at > NOW() - INTERVAL '2 minutes'
-- A janela de 2 min está em PRESENCE_WINDOW_MS (lib/chat.ts) e dá margem para
-- uma batida de 30s perdida no 3G sem manter ninguém a mais na lista.
CREATE TABLE IF NOT EXISTS user_presence (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  room         TEXT,
  -- "estou neste spot" declarado pelo velejador. ON DELETE SET NULL porque a
  -- saída de um spot do catálogo não deve derrubar a presença de quem está lá.
  at_spot_id   TEXT REFERENCES spots(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_presence_seen ON user_presence (last_seen_at DESC);

-- --------------------------------------------------- recuperação de senha
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_hash ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_open ON password_reset_tokens (expires_at)
  WHERE used_at IS NULL;

-- -------------------------------------------- log de auditoria administrativa
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT,
  metadata    JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_id);

-- ------------------------------------------- moderação e denúncias de conteúdo
CREATE TABLE IF NOT EXISTS content_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment', 'listing', 'alert', 'message', 'user')),
  target_id   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Investigando', 'Resolvido', 'Rejeitado')),
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports (status, created_at DESC);

-- ------------------------------------------------ preferências de notificação
-- Configuração global do app, editável pelo admin sem novo deploy.
-- Guardamos como chave/valor JSONB em vez de uma coluna por ajuste: cada novo
-- controle no painel viraria uma migração, e o valor da abertura já é um objeto
-- (url + trecho + poster), não um escalar.
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id                    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  wind_alerts_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  wind_min_knots             NUMERIC(4,1) NOT NULL DEFAULT 18.0,
  favorite_spots_only        BOOLEAN NOT NULL DEFAULT TRUE,
  community_replies_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  safety_alerts_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  event_reminders_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  channel_push               BOOLEAN NOT NULL DEFAULT TRUE,
  channel_email              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------- SOS (socorro)
-- Contato de emergência opcional: o velejador cadastra no perfil, em momento
-- calmo. Se um SOS for disparado, o app oferece compartilhar a posição com
-- esse contato via link/WhatsApp. Nome e telefone ficam em users porque são
-- atributos do velejador, não do SOS.
ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;

-- A CHECK constraint de users.role em produção nasceu só com 'admin'/'rider',
-- antes de 'moderator'/'instructor' entrarem no código. CREATE TABLE IF NOT
-- EXISTS nunca atualiza constraint de tabela já existente, então o banco
-- ficou defasado do schema em texto: promover alguém a moderador quebrava
-- com "new row for relation users violates check constraint". DROP + ADD é
-- idempotente, roda de novo sem erro.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'moderator', 'instructor', 'rider'));

-- user_presence não tinha coordenada nenhuma, só "estou neste spot". A
-- seleção de candidatos para notificar um SOS precisa saber ONDE cada
-- velejador está de verdade, não só o spot declarado — por isso lat/lng
-- aqui. pos_updated_at é separado de last_seen_at porque o heartbeat bate
-- a cada poucos segundos (só prova "app aberto"), mas o navegador só manda
-- coordenada nova quando o GPS de fato se move; sem o campo próprio não dá
-- para saber se a última posição gravada ainda é fresca o suficiente para
-- confiar nela na hora de notificar um socorro.
ALTER TABLE user_presence ADD COLUMN IF NOT EXISTS lat NUMERIC(9,6);
ALTER TABLE user_presence ADD COLUMN IF NOT EXISTS lng NUMERIC(9,6);
ALTER TABLE user_presence ADD COLUMN IF NOT EXISTS pos_updated_at TIMESTAMPTZ;

-- Pedido de socorro. Coordenada é NULLABLE de propósito: o GPS pode não
-- resolver a tempo (dentro d'água, sinal ruim, celular sacudindo) e um SOS
-- sem posição é infinitamente melhor que nenhum SOS. O servidor calcula
-- spot_id com nearestSpot() se houver coordenada; nunca aceita do cliente.
CREATE TABLE IF NOT EXISTS sos_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat             NUMERIC(9,6),
  lng             NUMERIC(9,6),
  -- Precisão relatada pelo navegador em metros. 2 km de erro muda a
  -- interpretação de quem vai ajudar: "a 300m daqui" vs "em algum lugar num
  -- raio de 2 km".
  accuracy_m      NUMERIC(7,2),
  spot_id         TEXT REFERENCES spots(id) ON DELETE SET NULL,
  -- Opcional: ninguém digita se afogando, mas serve para "prancha quebrada,
  -- sem vento, derivando" quando o velejador está seguro mas precisa de ajuda.
  message         TEXT,
  status          TEXT NOT NULL DEFAULT 'ativo'
                    CHECK (status IN ('ativo', 'em_atendimento', 'resolvido', 'cancelado', 'falso_alarme')),
  -- Raio atual da escalada dinâmica. Começa em 5 km; se ninguém confirmar em
  -- 2 min, sobe para 15 km; depois de mais 2 min, 50 km. Um pedido não pode
  -- morrer sem resposta em praia vazia.
  radius_km       NUMERIC(6,2) NOT NULL DEFAULT 5,
  escalated_at    TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Parcial: 99% das consultas querem só os ativos. Sem WHERE, o índice
-- carregaria todos os SOS já resolvidos desde o início dos tempos.
CREATE INDEX IF NOT EXISTS idx_sos_active
  ON sos_alerts (created_at DESC)
  WHERE status IN ('ativo', 'em_atendimento');

CREATE INDEX IF NOT EXISTS idx_sos_user
  ON sos_alerts (user_id, created_at DESC);

-- Quem viu e quem vai. PK composta sem coluna id — mesmo padrão de favorites,
-- post_likes e event_registrations: a existência da linha é o estado.
CREATE TABLE IF NOT EXISTS sos_responders (
  sos_id       UUID NOT NULL REFERENCES sos_alerts(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state        TEXT NOT NULL CHECK (state IN ('notificado', 'a_caminho', 'no_local', 'nao_posso')),
  -- Distância no momento da notificação, em km. Serve para o pedinte saber
  -- quem está mais perto e estimar tempo de chegada.
  distance_km  NUMERIC(6,2),
  lat          NUMERIC(9,6),
  lng          NUMERIC(9,6),
  notified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  PRIMARY KEY (sos_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_sos_responders_sos ON sos_responders (sos_id);

-- Inscrições de Web Push (VAPID). Cada navegador/dispositivo gera um endpoint
-- único; endpoint UNIQUE evita duplicar a mesma inscrição a cada reload ou
-- revisita.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  -- Para o velejador reconhecer "meu celular" numa lista de dispositivos.
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ,
  -- Endpoint que falha várias vezes está morto (usuário desinstalou ou o
  -- browser revogou a inscrição). Limpe em vez de tentar para sempre.
  failure_count INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions (user_id);

-- ----------------------------------------------------------------- downwind
-- Downwind: navegação em grupo de um ponto A a um ponto B ao longo da costa,
-- com apoio em terra acompanhando pelo carro. É atividade de risco: a razão
-- de ser da feature é ninguém ficar para trás sem que alguém saiba.

-- admin/moderator/instructor já podem organizar por causa do role. Um
-- 'rider' comum só organiza se ganhar essa liberação explícita do admin —
-- por PESSOA, uma vez, sem aprovação por evento. Por isso o downwind não tem
-- status "pendente" nem colunas de aprovação: quem tem a flag (ou o role já
-- privilegiado) organiza direto, sem passar por revisão a cada evento.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pode_organizar_downwind BOOLEAN NOT NULL DEFAULT FALSE;

-- spot_saida/spot_chegada usam ON DELETE SET NULL: um spot removido do
-- catálogo não pode apagar o histórico do downwind, só perder a referência
-- (mesmo raciocínio de sessions_log.spot_id e sos_alerts.spot_id). criado_por
-- também é SET NULL, não CASCADE: apagar a conta de quem organizou não pode
-- arrastar junto a trilha e a lista de participantes de um evento que já
-- aconteceu — isso é histórico de segurança do grupo, não pertence só ao
-- organizador.
CREATE TABLE IF NOT EXISTS downwinds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          TEXT NOT NULL,
  spot_saida    TEXT REFERENCES spots(id) ON DELETE SET NULL,
  spot_chegada  TEXT REFERENCES spots(id) ON DELETE SET NULL,
  criado_por    UUID REFERENCES users(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'aberto'
                  CHECK (status IN ('aberto', 'em_andamento', 'encerrado', 'cancelado')),
  previsto_para TIMESTAMPTZ,
  iniciado_em   TIMESTAMPTZ,
  encerrado_em  TIMESTAMPTZ,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Painel do organizador lista "os que estão abertos/em andamento" — parcial,
-- no espírito de idx_sos_active: sem WHERE, o índice carregaria também todo
-- downwind já encerrado ou cancelado desde o início dos tempos.
CREATE INDEX IF NOT EXISTS idx_downwinds_ativos
  ON downwinds (previsto_para)
  WHERE status IN ('aberto', 'em_andamento');

-- Vínculo com o evento que originou o downwind: o organizador cria um evento
-- normal (tabela `events`, tipo 'Downwind') e a rota, na mesma requisição,
-- cria a linha em `downwinds` apontando de volta pra ele — permite achar "o
-- downwind deste evento" e mostrar o downwind na lista de Eventos, que é onde
-- o velejador já espera encontrá-lo. SET NULL, não CASCADE, pelo mesmo motivo
-- de `criado_por` acima: apagar o evento (ex.: post administrativo removido)
-- não pode arrastar a trilha de segurança do downwind, que é histórico
-- próprio. O índice desta coluna é o `ux_downwinds_event` no fim desta seção
-- (UNIQUE parcial) — ele nasceu para garantir o invariante "um evento tem no
-- máximo um downwind" e serve ao lookup de graça. Este comentário antes dizia
-- que não valia índice nenhum aqui, porque a consulta por `event_id` era um
-- lookup avulso; deixou de ser quando `GET /api/events` passou a resolver o
-- downwind de TODO evento listado, para o card saber se tem mapa ao vivo.
ALTER TABLE downwinds ADD COLUMN IF NOT EXISTS event_id UUID
  REFERENCES events(id) ON DELETE SET NULL;

-- Cogitei um CHECK de coerência temporal aqui (encerrado_em só com status
-- 'encerrado'/'cancelado'; iniciado_em obrigatório a partir de
-- 'em_andamento'), mas decidi NÃO adicionar. Um UPDATE que só troca `status`
-- (ex.: `UPDATE downwinds SET status = 'em_andamento' WHERE id = $1`, sem
-- tocar `iniciado_em` na mesma instrução) é um padrão comum e legítimo de se
-- escrever, e um CHECK cross-column reprovaria esse UPDATE isoladamente — a
-- constraint é avaliada por statement, não "no fim da transação". Isso
-- obrigaria toda rota que muda status a lembrar de sempre setar o timestamp
-- junto, na mesma query, ou o schema vira uma armadilha para quem só quer
-- corrigir um status manualmente (ex.: um admin resolvendo um downwind
-- travado). Prefiro manter os timestamps como o que são — registro histórico
-- de quando cada evento aconteceu — e deixar a rota (lib/downwind.ts) decidir
-- ATOMICAMENTE, no mesmo UPDATE, setar iniciado_em/encerrado_em junto com o
-- status quando a transição exigir (ex.: `SET status = 'em_andamento',
-- iniciado_em = COALESCE(iniciado_em, NOW())`). Coerência de máquina de
-- estados pertence à camada que conhece as transições válidas, não a um
-- CHECK que só vê a linha final.

-- PK composta sem coluna id — mesmo padrão de favorites/post_likes/
-- sos_responders: a existência da linha já É o estado da participação.
-- CASCADE nos dois lados: sem o downwind ou sem o usuário, a linha de
-- participação não tem mais sentido nenhum (mesmo raciocínio de
-- sos_responders, que também é vínculo evento+pessoa).
--
-- `papel` (onde a pessoa está: água ou terra) e `eh_organizador` (se ela
-- administra o evento) são dimensões DELIBERADAMENTE separadas, em colunas
-- diferentes — não junte isso de volta numa coluna só achando que simplifica.
-- A versão anterior tinha 'organizador' como um terceiro valor de `papel`, e
-- isso era um furo de segurança: o organizador é justamente quem tem mais
-- chance de estar velejando, mas como o quórum de encerramento só olha
-- `papel = 'velejador'`, um organizador com papel='organizador' não bloqueava
-- o encerramento — o grupo conseguia fechar o downwind com o próprio
-- organizador ainda na água, sem ninguém saber. Com as dimensões separadas,
-- o organizador que veleja é (papel='velejador', eh_organizador=true) e entra
-- no quórum como qualquer outro velejador, que é o comportamento seguro.
CREATE TABLE IF NOT EXISTS downwind_participantes (
  downwind_id    UUID NOT NULL REFERENCES downwinds(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  papel          TEXT NOT NULL CHECK (papel IN ('velejador', 'apoio_terra')),
  eh_organizador BOOLEAN NOT NULL DEFAULT FALSE,
  -- Só `papel = 'velejador'` entra no quórum de encerramento (todos em
  -- 'encerrado' ou 'desistiu' fecha o downwind), independente de
  -- eh_organizador; apoio em terra não navega, então nunca precisa "chegar"
  -- para o grupo poder encerrar.
  estado         TEXT NOT NULL DEFAULT 'confirmado'
                   CHECK (estado IN ('confirmado', 'navegando', 'encerrado', 'desistiu')),
  entrou_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  encerrou_em    TIMESTAMPTZ,
  PRIMARY KEY (downwind_id, user_id)
);

-- A PK (downwind_id, user_id) cobre o sentido downwind→pessoas ("quem está
-- neste downwind"), mas não ajuda a busca inversa. A tela inicial faz
-- exatamente o inverso a cada abertura de app, para todo usuário: "em quais
-- downwinds ATIVOS eu estou?" — WHERE user_id = $1. Sem índice com user_id
-- na ponta esquerda, essa busca cai em seq scan na tabela inteira. Este
-- índice cobre o sentido pessoa→downwinds.
CREATE INDEX IF NOT EXISTS idx_downwind_participantes_user
  ON downwind_participantes (user_id);

-- Trilha de posições: muitas linhas por participante (reporte a cada 30-60s,
-- navegação de até 3h+). PK é BIGINT IDENTITY, não UUID como o resto do
-- schema — de propósito: é tabela de série temporal, append-only, e nada
-- referencia uma linha dela por FK, então não precisa de PK globalmente
-- imprevisível. Um UUID v4 aqui custaria o dobro do espaço (16 vs 8 bytes)
-- por linha e fragmentaria o índice da PK com inserções em ordem aleatória —
-- exatamente a tabela onde isso mais pesa, porque é a que mais cresce do
-- sistema (20 participantes × 3h × 1 ponto/40s já passa de 5000 linhas por
-- evento).
CREATE TABLE IF NOT EXISTS downwind_posicoes (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  downwind_id   UUID NOT NULL REFERENCES downwinds(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat           NUMERIC(9,6) NOT NULL,
  lng           NUMERIC(9,6) NOT NULL,
  accuracy_m    NUMERIC(7,2),
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Um índice só serve às duas consultas da UI: "última posição de cada
-- participante" é DISTINCT ON (user_id) ... WHERE downwind_id = $1 ORDER BY
-- user_id, registrado_em DESC — casa exatamente com esta ordem de colunas; e
-- "trilha de um participante em ordem cronológica" é WHERE downwind_id = $1
-- AND user_id = $2 ORDER BY registrado_em — o mesmo índice, percorrido pelo
-- outro lado. Não precisa de um segundo índice para isso.
CREATE INDEX IF NOT EXISTS idx_downwind_posicoes_user_tempo
  ON downwind_posicoes (downwind_id, user_id, registrado_em DESC);

-- Convite por link, reutilizável (vários participantes entram com o mesmo
-- token). Hoje serve o link de 12h para apoio em terra sem conta (pedido do
-- dono): quem abre o link e digita o nome ganha uma conta-convidada
-- descartável (users.downwind_guest_of aponta para cá — ver a coluna logo
-- abaixo) e uma sessão scoped a ESTE downwind, expirando com o convite. É
-- por isso que fica em tabela separada de `invites` (que é convite de conta
-- de verdade, de uso único, gerado só pelo admin) — mesmo padrão de token:
-- token_hash guarda SHA-256, o token em claro nunca é gravado. criado_por é
-- CASCADE, igual a invites.created_by: se quem gerou o link perde a conta,
-- os convites em aberto dele saem de circulação junto.
CREATE TABLE IF NOT EXISTS downwind_convites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  downwind_id   UUID NOT NULL REFERENCES downwinds(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  criado_por    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  papel_destino TEXT NOT NULL CHECK (papel_destino IN ('velejador', 'apoio_terra')),
  expira_em     TIMESTAMPTZ NOT NULL,
  revogado_em   TIMESTAMPTZ,
  -- NULL = sem limite de usos (só expira ou é revogado).
  max_usos      INT,
  usos          INT NOT NULL DEFAULT 0,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Parcial para "convites em aberto deste downwind", no espírito de
-- idx_invites_open. UNIQUE em token_hash já cria índice próprio para a busca
-- exata por token — um segundo índice igual seria redundante, então este
-- cobre só o caso de listagem (convites ainda válidos de um downwind).
CREATE INDEX IF NOT EXISTS idx_downwind_convites_open
  ON downwind_convites (downwind_id, expira_em)
  WHERE revogado_em IS NULL;

-- Marca uma conta como CONVIDADA de um downwind específico — o link de 12h
-- para apoio em terra sem conta (ver downwind_convites acima). NULL para
-- toda conta normal, que é a esmagadora maioria das linhas desta tabela.
--
-- Por que aqui, e não uma flag genérica `is_guest`: aponta para O DOWNWIND
-- exato, então lib/auth.ts consegue recusar a sessão fora do escopo dela
-- sem outra consulta (`requireUser()` rejeita QUALQUER conta com esta coluna
-- preenchida por padrão — só as poucas rotas de mapa/chat do próprio
-- downwind leem o valor para conferir o escopo, via getSessionUser()
-- direto). "12 horas" não é só a validade do convite: a SESSÃO do convidado
-- nasce com expires_at = +12h em auth_sessions (não os 30 dias padrão), e
-- sem senha cadastrada não há como logar de novo depois disso — o acesso
-- morre sozinho, sem precisar de um passo de "encerrar" explícito.
--
-- ON DELETE CASCADE: a conta-convidada não tem propósito nenhum fora do
-- downwind que a criou. Se o downwind for apagado, a conta (e a sessão, e
-- qualquer posição/mensagem que ela tenha deixado, via as CASCADEs já
-- existentes de downwind_id/user_id) some junto — não fica um usuário
-- órfão de e-mail falso vivendo pra sempre no banco.
ALTER TABLE users ADD COLUMN IF NOT EXISTS downwind_guest_of UUID
  REFERENCES downwinds(id) ON DELETE CASCADE;

-- Vínculo do velejador com o carro de apoio que o atende. Um motorista apoia
-- vários velejadores; um velejador tem no máximo um apoio. Existe porque a
-- pergunta "cadê o MEU carro?" é de logística real: num downwind com 12
-- pessoas e 3 carros, o seu é o que tem suas chaves, sua água e sua roupa —
-- hoje isso se resolve no grito.
--
-- SET NULL e não CASCADE: apagar a conta do motorista não pode tirar o
-- velejador do downwind, só deixá-lo sem apoio designado — mesmo raciocínio
-- de downwinds.criado_por, que também não arrasta histórico de segurança.
--
-- INVARIANTE QUE A FK NÃO GARANTE, e que a aplicação PRECISA validar (ver
-- `apoioValido` em lib/downwindAcesso.ts): o apontado tem que ser
-- participante DO MESMO downwind, com papel='apoio_terra', e diferente do
-- próprio user_id. A FK só garante que o usuário existe em algum lugar.
--
-- Sem índice de propósito: são dezenas de linhas por downwind e toda leitura
-- já entra pelo prefixo da PK (downwind_id). Um índice a mais só custaria
-- escrita na tabela que mais recebe UPDATE de estado durante a travessia.
ALTER TABLE downwind_participantes
  ADD COLUMN IF NOT EXISTS apoio_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Resumo da travessia, gravado NO ENCERRAMENTO da participação, para a trilha
-- bruta poder ser apagada depois sem destruir o que o velejador quer rever.
-- A trilha virou informação visível no mapa (o rastro de cada um), então
-- apagar os pontos sem guardar nada seria perder produto, não só histórico.
--
-- Colunas na própria linha do participante em vez de tabela nova: é fato 1:1
-- de uma linha que já existe, e uma tabela separada só criaria PK, FK e regra
-- de cascata novas para zero ganho.
--
-- trilha_reduzida é JSONB com no máximo ~200 pontos [[lat, lng, tsMs], ...]:
-- ~5 KB contra os ~540 KB da trilha bruta de um downwind, redução de ~100x.
-- JSONB e não tabela de pontos porque isto é lido inteiro ou nada, nunca
-- filtrado ou ordenado por ponto.
ALTER TABLE downwind_participantes
  ADD COLUMN IF NOT EXISTS distancia_km        NUMERIC(7,2);
ALTER TABLE downwind_participantes
  ADD COLUMN IF NOT EXISTS velocidade_max_nos  NUMERIC(5,2);
ALTER TABLE downwind_participantes
  ADD COLUMN IF NOT EXISTS trilha_reduzida     JSONB;

-- Um evento tem no máximo um downwind. O código de criação já assume isso —
-- app/api/events/route.ts cria os dois na mesma requisição e faz rollback
-- manual se o segundo INSERT falhar. Sem a constraint, uma retentativa depois
-- de um erro parcial deixaria dois downwinds apontando para o mesmo evento, e
-- o card do evento passaria a abrir um downwind arbitrário dos dois.
--
-- UNIQUE PARCIAL (WHERE event_id IS NOT NULL) porque downwind sem evento é
-- legítimo e vários NULLs precisam conviver — um UNIQUE comum trataria os
-- NULLs como distintos no Postgres, mas o parcial deixa a intenção explícita
-- e mantém o índice menor.
CREATE UNIQUE INDEX IF NOT EXISTS ux_downwinds_event
  ON downwinds (event_id) WHERE event_id IS NOT NULL;

