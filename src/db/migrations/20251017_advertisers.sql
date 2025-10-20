CREATE TABLE IF NOT EXISTS advertisers (
  tg_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  contact TEXT,
  blocked BOOLEAN NOT NULL DEFAULT FALSE,
  blocked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_advertisers_blocked ON advertisers(blocked);
