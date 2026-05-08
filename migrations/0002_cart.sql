CREATE TABLE IF NOT EXISTS cart (
  email      TEXT PRIMARY KEY,
  data       TEXT NOT NULL DEFAULT '{"items":[]}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
