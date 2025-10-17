ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS created_by_tg_id BIGINT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft',                -- draft|active|paused|stopped
  ADD COLUMN IF NOT EXISTS budget_cents BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_cents BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_cents BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS geo TEXT;

CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);
CREATE INDEX IF NOT EXISTS idx_offers_creator ON offers(created_by_tg_id);
