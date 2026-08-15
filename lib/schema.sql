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
