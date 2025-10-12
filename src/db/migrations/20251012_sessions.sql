-- sessions storage for Telegraf
CREATE TABLE IF NOT EXISTS sessions(
  tg_id BIGINT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_updated_at_idx ON sessions(updated_at DESC);

-- optional cleanup function & schedule (manual)
-- SELECT pg_sleep(0);
