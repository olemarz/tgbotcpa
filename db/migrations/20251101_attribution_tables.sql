-- Adds core attribution and tracking tables
CREATE TABLE IF NOT EXISTS clicks (
  id               bigserial PRIMARY KEY,
  offer_id         bigint NOT NULL REFERENCES offers(id),
  uid              text,
  click_id         text,
  start_token      text UNIQUE,
  tg_id            bigint,
  user_ip          inet,
  user_agent       text,
  referer          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  used_at          timestamptz
);
CREATE INDEX IF NOT EXISTS clicks_offer_created_idx ON clicks(offer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id               bigserial PRIMARY KEY,
  offer_id         bigint NOT NULL REFERENCES offers(id),
  tg_id            bigint NOT NULL,
  event_type       text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_premium       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS event text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_type text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS meta jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS payload jsonb;

UPDATE events SET event_type = COALESCE(event_type, event);
UPDATE events SET event_type = 'join_group' WHERE event_type IS NULL;
ALTER TABLE events ALTER COLUMN event_type SET NOT NULL;

UPDATE events SET payload = COALESCE(payload, meta, '{}'::jsonb);
ALTER TABLE events ALTER COLUMN payload SET DEFAULT '{}'::jsonb;
ALTER TABLE events ALTER COLUMN payload SET NOT NULL;

ALTER TABLE events DROP COLUMN IF EXISTS event;
ALTER TABLE events DROP COLUMN IF EXISTS meta;

CREATE INDEX IF NOT EXISTS events_offer_event_idx ON events(offer_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS events_tg_offer_idx   ON events(tg_id, offer_id);

CREATE TABLE IF NOT EXISTS attribution (
  id               bigserial PRIMARY KEY,
  click_id         bigint NOT NULL REFERENCES clicks(id),
  offer_id         bigint NOT NULL REFERENCES offers(id),
  tg_id            bigint NOT NULL,
  event_id         bigint REFERENCES events(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (click_id, tg_id)
);

CREATE TABLE IF NOT EXISTS postbacks (
  id               bigserial PRIMARY KEY,
  offer_id         bigint NOT NULL REFERENCES offers(id),
  event_id         bigint NOT NULL REFERENCES events(id),
  url              text NOT NULL,
  method           text NOT NULL DEFAULT 'GET',
  status_code      integer,
  response_ms      integer,
  response_body    text,
  payload          text,
  event_type       text,
  attempt          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS postbacks_offer_event_idx ON postbacks(offer_id, event_id);
