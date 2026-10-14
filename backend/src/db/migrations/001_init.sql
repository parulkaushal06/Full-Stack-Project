-- ============================================================================
-- 001_init.sql - full relational schema (see docs/DATABASE_DESIGN.md for the
-- ER diagram, normalization notes and indexing rationale)
-- ============================================================================

-- ---------------------------------------------------------------- users ----
CREATE TABLE users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  username       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT    NOT NULL,            -- scrypt: N$r$p$salt$hash
  role           TEXT    NOT NULL DEFAULT 'user'
                       CHECK (role IN ('user', 'admin')),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_users_role ON users(role);

-- ------------------------------------------------------------- sessions ----
-- Server side (database backed) sessions - "session-based authentication".
CREATE TABLE sessions (
  id            TEXT    PRIMARY KEY,          -- opaque id stored in the sid cookie
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent    TEXT,
  ip            TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at    INTEGER NOT NULL,             -- unix epoch ms
  revoked_at    INTEGER                          -- unix epoch ms, NULL = active
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- -------------------------------------------------------- refresh_tokens ----
-- Rotating refresh tokens (JWT jti stored server side for revocation and
-- reuse detection).
CREATE TABLE refresh_tokens (
  jti         TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,                         -- set when rotated (reuse => attack)
  revoked_at  INTEGER,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);

-- --------------------------------------------------------- oauth_clients ----
-- Registered OAuth 2.0 client applications.
CREATE TABLE oauth_clients (
  client_id         TEXT    PRIMARY KEY,
  client_secret_h   TEXT    NOT NULL,          -- scrypt hash, plain secret shown once
  name              TEXT    NOT NULL,
  owner_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  redirect_uri      TEXT    NOT NULL,
  grant_types       TEXT    NOT NULL DEFAULT 'authorization_code',
  scopes            TEXT    NOT NULL DEFAULT 'read',
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------- oauth_codes ----
-- Short lived authorization codes (OAuth 2.0 authorization code flow, PKCE).
CREATE TABLE oauth_codes (
  code                 TEXT    PRIMARY KEY,
  client_id            TEXT    NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri         TEXT    NOT NULL,
  scope                TEXT    NOT NULL DEFAULT 'read',
  code_challenge       TEXT,                   -- PKCE S256 challenge
  code_challenge_method TEXT,
  expires_at           INTEGER NOT NULL,
  used_at              INTEGER,
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_oauth_codes_client ON oauth_codes(client_id);
CREATE INDEX idx_oauth_codes_user ON oauth_codes(user_id);

-- ------------------------------------------------------------ roadmaps ----
CREATE TABLE roadmaps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL UNIQUE,
  title         TEXT    NOT NULL,
  brief_title   TEXT,
  description   TEXT,
  category      TEXT    NOT NULL DEFAULT 'other',  -- filter facet
  difficulty    TEXT    NOT NULL DEFAULT 'beginner'
                        CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  tag           TEXT    NOT NULL DEFAULT 'general', -- filter facet
  order_index   INTEGER NOT NULL DEFAULT 0,         -- editorial ordering
  is_forkable   INTEGER NOT NULL DEFAULT 1,
  has_topics    INTEGER NOT NULL DEFAULT 1,
  article_md    TEXT,                               -- "what is X?" markdown
  image_url     TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_roadmaps_category ON roadmaps(category);
CREATE INDEX idx_roadmaps_tag ON roadmaps(tag);
CREATE INDEX idx_roadmaps_difficulty ON roadmaps(difficulty);
CREATE INDEX idx_roadmaps_order ON roadmaps(order_index);

-- -------------------------------------------------------- roadmap_topics ----
-- One row per topic node of a roadmap (directory under content/).
CREATE TABLE roadmap_topics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  roadmap_slug  TEXT    NOT NULL REFERENCES roadmaps(slug) ON DELETE CASCADE,
  topic_key     TEXT    NOT NULL,               -- e.g. 102-css
  label         TEXT    NOT NULL,               -- e.g. CSS
  order_index   INTEGER NOT NULL DEFAULT 0,
  content_md    TEXT,                           -- topic overview (index.md)
  UNIQUE (roadmap_slug, topic_key)
);
CREATE INDEX idx_topics_roadmap ON roadmap_topics(roadmap_slug, order_index);

-- ------------------------------------------------------- topic_articles ----
-- Long form resource articles that belong to a topic.
CREATE TABLE topic_articles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  roadmap_slug  TEXT    NOT NULL,
  topic_key     TEXT    NOT NULL,
  article_key   TEXT    NOT NULL,               -- e.g. 101-what-is-http
  title         TEXT    NOT NULL,
  content_md    TEXT    NOT NULL,
  order_index   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (roadmap_slug, topic_key, article_key),
  FOREIGN KEY (roadmap_slug, topic_key)
    REFERENCES roadmap_topics(roadmap_slug, topic_key) ON DELETE CASCADE
);
CREATE INDEX idx_articles_topic ON topic_articles(roadmap_slug, topic_key, order_index);

-- --------------------------------------------------------- user_progress ----
-- "Mark topic as done" state per user (optimistic UI + server side truth).
CREATE TABLE user_progress (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  roadmap_slug  TEXT    NOT NULL REFERENCES roadmaps(slug) ON DELETE CASCADE,
  topic_key     TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'done'
                       CHECK (status IN ('done', 'learning', 'skipped')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX idx_progress_unique
  ON user_progress(user_id, roadmap_slug, topic_key);
CREATE INDEX idx_progress_roadmap ON user_progress(roadmap_slug);

-- ------------------------------------------------------ idempotency_keys ----
-- Idempotency-Key header support for safe POST retries.
CREATE TABLE idempotency_keys (
  key            TEXT    NOT NULL,
  endpoint       TEXT    NOT NULL,
  user_id        INTEGER NOT NULL DEFAULT 0,
  request_hash   TEXT    NOT NULL,
  response_status INTEGER NOT NULL,
  response_body  TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (key, endpoint, user_id)
);
