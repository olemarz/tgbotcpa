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
  event            text NOT NULL,
  is_premium       boolean NOT NULL DEFAULT false,
  meta             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_offer_event_idx ON events(offer_id, event, created_at DESC);
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
  attempt          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS postbacks_offer_event_idx ON postbacks(offer_id, event_id);
