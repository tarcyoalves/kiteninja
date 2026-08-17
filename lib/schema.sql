-- KiteNinja — schema Postgres (Neon)
-- Idempotente: pode rodar várias vezes sem erro.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- usuários
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'rider' CHECK (role IN ('admin', 'rider')),
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_url      TEXT,
  rider_id        TEXT NOT NULL,
  nationality     TEXT NOT NULL DEFAULT 'Brasil',
  country_flag    TEXT NOT NULL DEFAULT '🇧🇷',
  weight_kg       NUMERIC(5,2) NOT NULL DEFAULT 75,
  rider_level     TEXT NOT NULL DEFAULT 'Intermediário',
  home_spot       TEXT,
  disciplines     TEXT[] NOT NULL DEFAULT ARRAY['Kitesurf Twintip'],
  highest_jump_m  NUMERIC(4,1),
  bio             TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));

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
