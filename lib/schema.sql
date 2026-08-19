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

CREATE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users (is_active);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users (last_login_at DESC);

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

