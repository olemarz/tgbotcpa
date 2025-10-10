import { fileURLToPath } from 'node:url';
import { query } from './index.js';

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL,
  uid text,
  click_id text,
  start_token text UNIQUE NOT NULL,
  tg_id bigint,
  ip text,
  ua text,
  created_at timestamptz DEFAULT now(),
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS attribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  click_id uuid REFERENCES clicks(id),
  offer_id uuid NOT NULL,
  uid text,
  tg_id bigint NOT NULL,
  state text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL,
  tg_id bigint NOT NULL,
  type text NOT NULL,
  created_at timestamptz DEFAULT now()
);

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

CREATE INDEX IF NOT EXISTS idx_clicks_token ON clicks(start_token);
CREATE INDEX IF NOT EXISTS idx_attr_tg ON attribution(tg_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_tg ON events(tg_id, created_at DESC);
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
