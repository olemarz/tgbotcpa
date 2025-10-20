CREATE OR REPLACE VIEW v_offer_stats AS
WITH periods AS (
  SELECT 'day'::text   AS period, now() - INTERVAL '1 day'   AS since
  UNION ALL
  SELECT 'week'::text  AS period, now() - INTERVAL '7 days'  AS since
  UNION ALL
  SELECT 'month'::text AS period, now() - INTERVAL '30 days' AS since
  UNION ALL
  SELECT 'all'::text   AS period, NULL                      AS since
),
lifetime_events AS (
  SELECT
    e.offer_id,
    COUNT(*)::bigint AS events_total
  FROM events e
  GROUP BY e.offer_id
)
SELECT
  o.id AS offer_id,
  p.period,
  COALESCE(c.clicks, 0)::bigint AS clicks,
  COALESCE(c.linked_users, 0)::bigint AS linked_users,
  COALESCE(ev.events_total, 0)::bigint AS events_total,
  COALESCE(ev.events_premium, 0)::bigint AS events_premium,
  CASE
    WHEN COALESCE(ev.events_total, 0) = 0 OR COALESCE(o.payout_cents, 0) = 0 THEN 0::bigint
    ELSE CEIL((COALESCE(o.payout_cents, 0)::numeric * COALESCE(ev.events_total, 0)::numeric) / 100)::bigint
  END AS spent_stars_est,
  CASE
    WHEN o.caps_total IS NULL THEN NULL
    ELSE GREATEST(o.caps_total - COALESCE(le.events_total, 0), 0)::bigint
  END AS caps_left
FROM offers o
CROSS JOIN periods p
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::bigint AS clicks,
    COUNT(DISTINCT CASE WHEN c.tg_id IS NOT NULL THEN c.tg_id END)::bigint AS linked_users
  FROM clicks c
  WHERE c.offer_id = o.id
    AND (p.since IS NULL OR c.created_at >= p.since)
) c ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::bigint AS events_total,
    SUM(CASE WHEN COALESCE(e.is_premium, false) THEN 1 ELSE 0 END)::bigint AS events_premium
  FROM events e
  WHERE e.offer_id = o.id
    AND (p.since IS NULL OR e.created_at >= p.since)
) ev ON TRUE
LEFT JOIN lifetime_events le ON le.offer_id = o.id;
