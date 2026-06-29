CREATE TABLE IF NOT EXISTS top500_companies (
  id             TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',(abs(random())%4)+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  name           TEXT    NOT NULL,
  domain         TEXT,
  normalized_name TEXT   NOT NULL,
  ticker         TEXT,
  sector         TEXT,
  logo_url       TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_top500_domain      ON top500_companies(domain)          WHERE domain IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_top500_normalized  ON top500_companies(normalized_name);
