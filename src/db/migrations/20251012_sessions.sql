-- sessions storage for Telegraf
CREATE TABLE IF NOT EXISTS sessions(
  tg_id BIGINT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sessions'
      AND column_name = 'id'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sessions'
      AND column_name = 'tg_id'
  )
  THEN
    EXECUTE 'ALTER TABLE sessions RENAME COLUMN id TO tg_id';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS sessions_updated_at_idx ON sessions(updated_at DESC);

-- optional cleanup function & schedule (manual)
-- SELECT pg_sleep(0);
