import { pool } from './index.js';

let offersColumnsPromise;
async function getOfferColumns() {
  if (!offersColumnsPromise) {
    offersColumnsPromise = pool
      .query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'offers'`,
      )
      .then((res) => new Set(res.rows.map((row) => row.column_name)));
  }
  return offersColumnsPromise;
}

function centsToUnits(value) {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num / 100);
}

export async function insertOffer(o) {
  const columns = await getOfferColumns();
  const insertColumns = [];
  const values = [];
  const params = [];

  const push = (column, value) => {
    if (!columns.has(column)) return;
    insertColumns.push(column);
    values.push(value);
    params.push(`$${values.length}`);
  };

  const title = o.title ?? null;
  if (columns.has('title')) push('title', title);
  else if (columns.has('name')) push('name', title);

  push('slug', o.slug ?? null);

  if (columns.has('target_url')) push('target_url', o.target_url ?? null);
  if (columns.has('target_link') && o.target_link != null) push('target_link', o.target_link);
  if (columns.has('event_type')) push('event_type', o.event_type ?? 'join_group');

  if (columns.has('payout_cents')) push('payout_cents', o.payout_cents ?? 0);
  if (columns.has('budget_cents')) push('budget_cents', o.budget_cents ?? o.payout_cents ?? 0);
  if (columns.has('budget_xtr') && o.budget_xtr != null) push('budget_xtr', o.budget_xtr);

  if (columns.has('base_rate_cents')) push('base_rate_cents', o.base_rate_cents ?? null);
  if (columns.has('premium_rate_cents')) push('premium_rate_cents', o.premium_rate_cents ?? null);

  if (columns.has('base_rate')) {
    const baseRate = o.base_rate ?? centsToUnits(o.base_rate_cents);
    if (baseRate != null) push('base_rate', baseRate);
  }

  if (columns.has('premium_rate')) {
    const premiumRate = o.premium_rate ?? centsToUnits(o.premium_rate_cents);
    if (premiumRate != null) push('premium_rate', premiumRate);
  }

  if (columns.has('caps_total') && o.caps_total != null) push('caps_total', o.caps_total);
  if (columns.has('geo')) push('geo', o.geo ?? null);
  if (columns.has('geo_input') && o.geo_input != null) push('geo_input', o.geo_input);
  if (columns.has('geo_list') && o.geo_list != null) push('geo_list', o.geo_list);
  if (columns.has('geo_mode') && o.geo_mode != null) push('geo_mode', o.geo_mode);

  if (columns.has('created_by_tg_id') && o.created_by_tg_id != null)
    push('created_by_tg_id', o.created_by_tg_id);
  if (columns.has('created_by_tg') && o.created_by_tg != null)
    push('created_by_tg', o.created_by_tg);

  if (columns.has('status')) push('status', o.status || 'draft');

  const sql = `
    INSERT INTO offers (id${insertColumns.length ? ',' + insertColumns.join(',') : ''})
    VALUES (gen_random_uuid()${params.length ? ',' + params.join(',') : ''})
    RETURNING id, created_at
  `;

  const { rows } = await pool.query(sql, values);
  return rows[0];
}

export async function listRecentOffers(limit = 10) {
  const { rows } = await pool.query(
    `SELECT id, slug, title, event_type, payout_cents, caps_total, budget_cents, geo, status, created_at
     FROM offers
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}
