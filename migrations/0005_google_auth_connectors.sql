-- Add Google OAuth support to existing users table
ALTER TABLE users ADD COLUMN google_id TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;

-- Allow password_hash to be NULL (Google-only accounts won't have one)
-- SQLite doesn't support ALTER COLUMN, so we handle this at app layer (INSERT without password_hash)

-- Unique index on google_id for fast lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;

-- Connectors: each user can have multiple named backend instances
CREATE TABLE IF NOT EXISTS connectors (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_email   TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT 'My Instance',
  endpoint_url TEXT NOT NULL,
  api_key      TEXT NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 0,
  last_ping    TEXT,
  last_status  INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_connectors_user ON connectors(user_email);
CREATE INDEX IF NOT EXISTS idx_connectors_active ON connectors(user_email, is_active);

-- OAuth state table (prevents CSRF in Google callback)
CREATE TABLE IF NOT EXISTS oauth_state (
  state      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
