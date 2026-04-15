-- Users table (auth)
CREATE TABLE IF NOT EXISTS users (
  email         TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User-specific exclusions (blocked companies + title keywords)
CREATE TABLE IF NOT EXISTS user_prefs (
  email      TEXT PRIMARY KEY,
  exclusions TEXT NOT NULL DEFAULT '{"companies":[],"keywords":[]}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-job apply tracker (click count, status, timestamps)
CREATE TABLE IF NOT EXISTS apply_tracker (
  email      TEXT PRIMARY KEY,
  data       TEXT NOT NULL DEFAULT '{"count":0,"lastClickAt":null,"lastJobTitle":null,"lastCompany":null,"appliedJobs":{}}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
