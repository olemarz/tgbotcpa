ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS target_link TEXT,
  ADD COLUMN IF NOT EXISTS payout_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS postback_url TEXT;

CREATE TABLE IF NOT EXISTS conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL,
  tg_id bigint NOT NULL,
  amount_cents INTEGER NOT NULL,
  postback_status TEXT,
  postback_response TEXT,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversions_offer ON conversions(offer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversions_tg ON conversions(tg_id, created_at DESC);
