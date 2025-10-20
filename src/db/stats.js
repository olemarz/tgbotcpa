import pool from './pool.js';

const PERIOD_ALIASES = new Map([
  ['day', 'day'],
  ['d1', 'day'],
  ['24h', 'day'],
  ['week', 'week'],
  ['w1', 'week'],
  ['7d', 'week'],
  ['month', 'month'],
  ['m1', 'month'],
  ['30d', 'month'],
  ['all', 'all'],
  ['total', 'all'],
  ['lifetime', 'all'],
  ['ever', 'all'],
]);

const DEFAULT_PERIOD = 'all';

function normalizePeriod(period) {
  const key = String(period ?? DEFAULT_PERIOD).trim().toLowerCase();
  const normalized = PERIOD_ALIASES.get(key);
  if (!normalized) {
    throw new Error(`Unsupported stats period: ${period}`);
  }
  return normalized;
}

function mapStatsRow(row) {
  if (!row) return null;
  const capsLeft = row.caps_left;
  return {
    offer_id: row.offer_id ?? null,
    advertiser_id: row.advertiser_id ?? null,
    period: row.period,
    clicks: Number(row.clicks ?? 0),
    linked_users: Number(row.linked_users ?? 0),
    events_total: Number(row.events_total ?? 0),
    events_premium: Number(row.events_premium ?? 0),
    spent_stars_est: Number(row.spent_stars_est ?? 0),
    caps_left: capsLeft === null || capsLeft === undefined ? null : Number(capsLeft),
  };
}

export async function getOfferStats(offerId, period = DEFAULT_PERIOD) {
  if (!offerId) {
    throw new Error('offerId is required');
  }
  const normalized = normalizePeriod(period);
  const result = await pool.query(
    `SELECT offer_id, period, clicks, linked_users, events_total, events_premium, spent_stars_est, caps_left
       FROM v_offer_stats
      WHERE offer_id = $1 AND period = $2`,
    [offerId, normalized],
  );
  if (!result.rowCount) {
    return null;
  }
  return mapStatsRow(result.rows[0]);
}

export async function getUserStats(advertiserId, period = DEFAULT_PERIOD) {
  if (!advertiserId) {
    throw new Error('advertiserId is required');
  }
  const normalized = normalizePeriod(period);
  const result = await pool.query(
    `SELECT
        $1::bigint AS advertiser_id,
        $2::text AS period,
        COALESCE(SUM(s.clicks), 0)::bigint AS clicks,
        COALESCE(SUM(s.linked_users), 0)::bigint AS linked_users,
        COALESCE(SUM(s.events_total), 0)::bigint AS events_total,
        COALESCE(SUM(s.events_premium), 0)::bigint AS events_premium,
        COALESCE(SUM(s.spent_stars_est), 0)::bigint AS spent_stars_est,
        SUM(s.caps_left)::bigint AS caps_left
     FROM v_offer_stats s
     WHERE s.period = $2
       AND s.offer_id IN (
         SELECT id FROM offers WHERE created_by_tg_id = $1
       )`,
    [advertiserId, normalized],
  );
  return mapStatsRow(result.rows[0]);
}

export async function getAllStatsForAdmin(period = DEFAULT_PERIOD) {
  const normalized = normalizePeriod(period);
  const result = await pool.query(
    `SELECT
        NULL::bigint AS advertiser_id,
        $1::text AS period,
        COALESCE(SUM(clicks), 0)::bigint AS clicks,
        COALESCE(SUM(linked_users), 0)::bigint AS linked_users,
        COALESCE(SUM(events_total), 0)::bigint AS events_total,
        COALESCE(SUM(events_premium), 0)::bigint AS events_premium,
        COALESCE(SUM(spent_stars_est), 0)::bigint AS spent_stars_est,
        SUM(caps_left)::bigint AS caps_left
     FROM v_offer_stats
     WHERE period = $1`,
    [normalized],
  );
  return mapStatsRow(result.rows[0]);
}

export const __testables = {
  normalizePeriod,
};
