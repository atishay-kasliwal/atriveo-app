-- How the console is used: per day, per page or action, the seconds spent and the number of uses. Counts and time only:
-- no job, company, resume, email or any other content is ever stored here.
CREATE TABLE IF NOT EXISTS usage_daily (
  email TEXT NOT NULL,
  day TEXT NOT NULL,            -- America/New_York calendar day, YYYY-MM-DD
  kind TEXT NOT NULL,           -- 'page' | 'action'
  key TEXT NOT NULL,            -- e.g. 'matching' or 'matching.apply'
  seconds INTEGER NOT NULL DEFAULT 0,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email, day, kind, key)
);
CREATE INDEX IF NOT EXISTS idx_usage_daily_email_day ON usage_daily (email, day);
