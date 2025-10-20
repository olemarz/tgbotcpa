ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS caps_reached_notified_at timestamptz;
