import { fileURLToPath } from 'node:url';
import { query } from './index.js';

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_url text NOT NULL,
  event_type text NOT NULL,
  name text,
  slug text UNIQUE,
  base_rate int,
  premium_rate int,
  caps_total int,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE offers ADD COLUMN IF NOT EXISTS caps_window interval;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS time_targeting jsonb;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS chat_ref jsonb;

CREATE TABLE IF NOT EXISTS clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE clicks ADD COLUMN IF NOT EXISTS uid text;
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS click_id text;
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS start_token text;
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS tg_id bigint;
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS ip inet;
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS ua text;
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS subs jsonb;
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS used_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clicks_start_token ON clicks(start_token);
CREATE INDEX IF NOT EXISTS idx_clicks_offer_id ON clicks(offer_id);
CREATE INDEX IF NOT EXISTS idx_clicks_tg_id ON clicks(tg_id);

CREATE TABLE IF NOT EXISTS attribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  click_id uuid REFERENCES clicks(id),
  offer_id uuid NOT NULL,
  uid text,
  tg_id bigint NOT NULL,
  state text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attr_tg ON attribution(tg_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attr_offer ON attribution(offer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL,
  tg_id bigint NOT NULL,
  type text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_tg ON events(tg_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_offer ON events(offer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS postbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL,
  tg_id bigint NOT NULL,
  uid text,
  event text NOT NULL,
  http_status int,
  status text,
  error text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_postbacks_tg ON postbacks(tg_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_postbacks_offer ON postbacks(offer_id, created_at DESC);
`;

export async function runMigrations() {
  await query(MIGRATION_SQL);
}

async function main() {
  await runMigrations();
  console.log('Migration complete');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error('Migration failed', error);
    process.exit(1);
  });
}
