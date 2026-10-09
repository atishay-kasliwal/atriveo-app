-- Failed sign-in attempts for the login rate limit (functions/_lib/loginLimit.ts). Rows older than a day are pruned.
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts (email, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts (ip, created_at);
