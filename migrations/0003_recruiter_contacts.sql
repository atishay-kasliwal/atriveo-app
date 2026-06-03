CREATE TABLE IF NOT EXISTS recruiter_contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,            -- owner (the logged-in user)
  contact_email   TEXT NOT NULL,       -- the recruiter's email we found
  name       TEXT NOT NULL DEFAULT '',
  company    TEXT NOT NULL DEFAULT '',
  domain     TEXT NOT NULL DEFAULT '',
  linkedin_url    TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT 'guess',  -- 'guess' | provider name (apollo/hunter/quickenrich/skrapp)
  score      INTEGER NOT NULL DEFAULT 0,      -- 0–100 confidence (0 for guesses)
  notes      TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'saved',   -- 'saved' | 'sent' | 'bounced' | 'replied'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (owner, contact_email) so re-saving the same address updates
-- rather than duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recruiter_contacts_owner_email
  ON recruiter_contacts (email, contact_email);
