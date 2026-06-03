CREATE TABLE IF NOT EXISTS outreach_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,            -- owner (the logged-in user)
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_outreach_templates_owner
  ON outreach_templates (email, created_at);
