ALTER TABLE offers
  DROP COLUMN IF EXISTS cap_window,
  DROP COLUMN IF EXISTS time_targeting;

ALTER TABLE offers
  ADD COLUMN geo_mode TEXT NOT NULL DEFAULT 'any',
  ADD COLUMN geo_list TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE offers
  ADD CONSTRAINT offers_geo_mode_chk CHECK (geo_mode IN ('any','whitelist','blacklist'));
