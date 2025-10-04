import { query } from './index.js';

const sql = `
CREATE TABLE IF NOT EXISTS offers (
  id UUID PRIMARY KEY,
  advertiser_id UUID,
  target_url TEXT NOT NULL,
  event_type TEXT NOT NULL,
  premium_rate INT,
  base_rate INT NOT NULL,
  caps_total INT DEFAULT 0,
  caps_window JSONB,
  reaction_whitelist JSONB,
  chat_ref JSONB,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clicks (
  id UUID PRIMARY KEY,
  offer_id UUID NOT NULL,
  uid TEXT NOT NULL,
  subs JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS start_tokens (
  token TEXT PRIMARY KEY,
  offer_id UUID NOT NULL,
  uid TEXT NOT NULL,
  exp_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS attribution (
  user_id BIGINT NOT NULL,
  offer_id UUID NOT NULL,
  uid TEXT NOT NULL,
  is_premium BOOLEAN DEFAULT FALSE,
  first_seen TIMESTAMPTZ DEFAULT now(),
  last_seen TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, offer_id)
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY,
  offer_id UUID NOT NULL,
  uid TEXT NOT NULL,
  user_id BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  chat_id BIGINT,
  message_id BIGINT,
  thread_id BIGINT,
  poll_id TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  idempotency_key TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS postbacks (
  id UUID PRIMARY KEY,
  offer_id UUID NOT NULL,
  uid TEXT NOT NULL,
  url TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending',
  attempts INT DEFAULT 0,
  last_try_at TIMESTAMPTZ
);
`;

await query(sql);
console.log('Migration complete');
process.exit(0);
