import pool from './pool.js';

let cachedColumns;

async function loadOfferColumns() {
  if (!cachedColumns) {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'offers'`,
    );
    cachedColumns = new Set(result.rows.map((row) => row.column_name));
  }
  return cachedColumns;
}

function pushColumn(available, columns, values, params, column, value) {
  if (!available.has(column)) return;
  if (value === undefined) return;
  columns.push(column);
  values.push(value);
  params.push(`$${values.length}`);
}

export async function insertOffer(form) {
  const available = await loadOfferColumns();
  const columns = [];
  const values = [];
  const params = [];

  pushColumn(available, columns, values, params, 'slug', form.slug ?? null);
  pushColumn(available, columns, values, params, 'title', form.title ?? null);
  pushColumn(available, columns, values, params, 'target_url', form.target_url ?? null);
  pushColumn(available, columns, values, params, 'event_type', form.event_type ?? null);
  pushColumn(available, columns, values, params, 'payout_cents', form.payout_cents ?? null);
  pushColumn(available, columns, values, params, 'caps_total', form.caps_total ?? null);
  pushColumn(available, columns, values, params, 'budget_cents', form.budget_cents ?? null);
  pushColumn(available, columns, values, params, 'paid_cents', form.paid_cents ?? null);
  pushColumn(available, columns, values, params, 'geo', form.geo ?? null);
  pushColumn(available, columns, values, params, 'status', form.status ?? null);
  pushColumn(available, columns, values, params, 'postback_url', form.postback_url ?? null);
  pushColumn(available, columns, values, params, 'postback_secret', form.postback_secret ?? null);
  pushColumn(available, columns, values, params, 'action_payload', form.action_payload ?? null);
  pushColumn(available, columns, values, params, 'created_by_tg_id', form.created_by_tg_id ?? null);

  const sql = `
    INSERT INTO offers (id${columns.length ? `, ${columns.join(', ')}` : ''})
    VALUES (gen_random_uuid()${params.length ? `, ${params.join(', ')}` : ''})
    RETURNING id, slug
  `;

  const result = await pool.query(sql, values);
  return result.rows[0] ?? null;
}

function mapOfferRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug ?? null,
    title: row.title ?? null,
    target_url: row.target_url ?? null,
    event_type: row.event_type ?? null,
    payout_cents: row.payout_cents ?? null,
    caps_total: row.caps_total ?? null,
    budget_cents: row.budget_cents ?? null,
    paid_cents: row.paid_cents ?? null,
    geo: row.geo ?? null,
    status: row.status ?? null,
    postback_url: row.postback_url ?? null,
    postback_secret: row.postback_secret ?? null,
    action_payload: row.action_payload ?? null,
    created_at: row.created_at ?? null,
    created_by_tg_id: row.created_by_tg_id ?? null,
  };
}

export async function getOfferById(id) {
  const result = await pool.query(
    `SELECT id, slug, title, target_url, event_type, payout_cents, caps_total, budget_cents, paid_cents, geo, status, postback_url, postback_secret, action_payload, created_at, created_by_tg_id
       FROM offers
      WHERE id = $1
      LIMIT 1`,
    [id],
  );
  return mapOfferRow(result.rows[0]);
}

export async function getOfferBySlug(slug) {
  const result = await pool.query(
    `SELECT id, slug, title, target_url, event_type, payout_cents, caps_total, budget_cents, paid_cents, geo, status, postback_url, postback_secret, action_payload, created_at, created_by_tg_id
       FROM offers
      WHERE slug = $1
      LIMIT 1`,
    [slug],
  );
  return mapOfferRow(result.rows[0]);
}

export async function listOffersByOwner(ownerTgId) {
  const result = await pool.query(
    `SELECT id, slug, title, target_url, event_type, payout_cents, caps_total, budget_cents, paid_cents, geo, status, postback_url, postback_secret, action_payload, created_at, created_by_tg_id
       FROM offers
      WHERE created_by_tg_id = $1
      ORDER BY created_at DESC`,
    [ownerTgId],
  );
  return result.rows.map(mapOfferRow);
}

export async function listAllOffers(limit = 50) {
  const result = await pool.query(
    `SELECT id, slug, title, target_url, event_type, payout_cents, caps_total, budget_cents, paid_cents, geo, status, postback_url, postback_secret, action_payload, created_at, created_by_tg_id
       FROM offers
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
  return result.rows.map(mapOfferRow);
}
