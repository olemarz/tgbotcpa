import { query } from '../db/index.js';
import { config } from '../config.js';
import { buildTrackingUrl } from '../utils/tracking-link.js';

let offersColumnsCache;
async function getOfferColumns() {
  if (!offersColumnsCache) {
    const res = await query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'offers'`,
    );
    offersColumnsCache = new Set(res.rows.map((row) => row.column_name));
  }
  return offersColumnsCache;
}

function normalizeInt(value) {
  if (value == null) return 0;
  const num = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.trunc(num);
}

function centsToCurrency(value) {
  const cents = normalizeInt(value);
  return `${(cents / 100).toFixed(2)} ₽`;
}

function formatDate(value) {
  if (!value) return '-';
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toISOString().slice(0, 10);
  } catch {
    return '-';
  }
}

function buildTracking(offerId, ownerId) {
  const baseUrl = (config.baseUrl || process.env.BASE_URL || '').replace(/\/+$/, '');
  try {
    return buildTrackingUrl({ baseUrl, offerId, uid: ownerId ? String(ownerId) : undefined });
  } catch (error) {
    const safeBase = baseUrl || '';
    if (safeBase) {
      return `${safeBase}/click/${offerId}`;
    }
    return `/click/${offerId}`;
  }
}

async function fetchOffersForCreator(tgId) {
  const columns = await getOfferColumns();
  const selectParts = ['id', 'slug', 'event_type'];
  if (columns.has('title')) selectParts.push('title');
  else if (columns.has('name')) selectParts.push('name AS title');
  else selectParts.push("COALESCE(name, slug, id::text) AS title");
  if (columns.has('name') && !columns.has('title')) selectParts.push('name');
  if (columns.has('payout_cents')) selectParts.push('payout_cents');
  if (columns.has('caps_total')) selectParts.push('caps_total');
  if (columns.has('budget_cents')) selectParts.push('budget_cents');
  if (columns.has('paid_cents')) selectParts.push('paid_cents');
  if (columns.has('status')) selectParts.push('status');
  if (columns.has('created_at')) selectParts.push('created_at');
  if (columns.has('created_by_tg_id')) selectParts.push('created_by_tg_id');
  if (columns.has('created_by_tg')) selectParts.push('created_by_tg');
  if (columns.has('owner_tg_id')) selectParts.push('owner_tg_id');

  let sql = `SELECT ${selectParts.join(', ')} FROM offers`;
  const whereClauses = [];
  const params = [];
  const tgIdStr = tgId != null ? String(tgId) : null;

  if (tgIdStr != null) {
    if (columns.has('created_by_tg_id')) {
      params.push(tgIdStr);
      whereClauses.push(`created_by_tg_id::text = $${params.length}::text`);
    }
    if (columns.has('created_by_tg')) {
      params.push(tgIdStr);
      whereClauses.push(`created_by_tg::text = $${params.length}::text`);
    }
    if (columns.has('owner_tg_id')) {
      params.push(tgIdStr);
      whereClauses.push(`owner_tg_id::text = $${params.length}::text`);
    }
  }

  if (whereClauses.length) {
    sql += ` WHERE ${whereClauses.join(' OR ')}`;
  }

  sql += ' ORDER BY created_at DESC NULLS LAST, id DESC';

  let res;
  try {
    res = await query(sql, params);
  } catch (error) {
    if (error?.code !== '42703') throw error;
    // Fallback: fetch without filters and filter in JS
    res = await query('SELECT id, slug, event_type, created_at FROM offers ORDER BY created_at DESC NULLS LAST, id DESC');
  }

  const rows = res.rows || [];
  const filtered = tgIdStr == null
    ? rows
    : rows.filter((row) => {
        const candidates = [row.created_by_tg_id, row.created_by_tg, row.owner_tg_id];
        return candidates.some((value) => value != null && String(value) === tgIdStr);
      });

  return filtered.map((row) => ({
    id: row.id,
    slug: row.slug || String(row.id),
    event_type: row.event_type || '-',
    title: row.title || row.name || row.slug || String(row.id),
    payout_cents: normalizeInt(row.payout_cents),
    caps_total: row.caps_total != null ? normalizeInt(row.caps_total) : null,
    budget_cents: normalizeInt(row.budget_cents),
    paid_cents: normalizeInt(row.paid_cents),
    status: row.status || 'draft',
    created_at: row.created_at || null,
    owner_id:
      row.created_by_tg_id ||
      row.created_by_tg ||
      row.owner_tg_id ||
      tgIdStr,
  }));
}

async function fetchConversionsMap(offerIds, range) {
  if (!offerIds.length) return new Map();
  const params = [offerIds.map(String)];
  let sql = `
    SELECT offer_id::text AS offer_id,
           COUNT(*)::bigint AS conversions,
           COALESCE(SUM(amount_cents),0)::bigint AS amount_cents
      FROM conversions
     WHERE offer_id::text = ANY($1::text[])
  `;
  if (range?.from) {
    params.push(range.from);
    sql += ` AND created_at >= $${params.length}`;
  }
  if (range?.to) {
    params.push(range.to);
    sql += ` AND created_at < $${params.length}`;
  }
  sql += ' GROUP BY offer_id';

  try {
    const res = await query(sql, params);
    return new Map(
      res.rows.map((row) => [
        String(row.offer_id),
        {
          conversions: normalizeInt(row.conversions),
          amount_cents: normalizeInt(row.amount_cents),
        },
      ]),
    );
  } catch (error) {
    if (error?.code === '42P01') return new Map();
    throw error;
  }
}

async function fetchPremiumMap(offerIds, range) {
  if (!offerIds.length) return new Map();
  const params = [offerIds.map(String)];
  let sql = `
    SELECT offer_id::text AS offer_id,
           COUNT(*)::bigint AS premium
      FROM events
     WHERE offer_id::text = ANY($1::text[])
       AND is_premium IS TRUE
  `;
  if (range?.from) {
    params.push(range.from);
    sql += ` AND created_at >= $${params.length}`;
  }
  if (range?.to) {
    params.push(range.to);
    sql += ` AND created_at < $${params.length}`;
  }
  sql += ' GROUP BY offer_id';

  try {
    const res = await query(sql, params);
    return new Map(res.rows.map((row) => [String(row.offer_id), normalizeInt(row.premium)]));
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      return new Map();
    }
    throw error;
  }
}

async function fetchClicksMap(offerIds, range) {
  if (!offerIds.length) return new Map();
  const params = [offerIds.map(String)];
  let sql = `
    SELECT offer_id::text AS offer_id,
           COUNT(*)::bigint AS clicks
      FROM clicks
     WHERE offer_id::text = ANY($1::text[])
  `;
  if (range?.from) {
    params.push(range.from);
    sql += ` AND created_at >= $${params.length}`;
  }
  if (range?.to) {
    params.push(range.to);
    sql += ` AND created_at < $${params.length}`;
  }
  sql += ' GROUP BY offer_id';

  try {
    const res = await query(sql, params);
    return new Map(res.rows.map((row) => [String(row.offer_id), normalizeInt(row.clicks)]));
  } catch (error) {
    if (error?.code === '42P01') return new Map();
    throw error;
  }
}

function enrichOffersWithAggregates(offers, aggregates = {}, rangeAggregates = {}) {
  const conversionsTotal = aggregates.conversions || new Map();
  const premiumTotal = aggregates.premium || new Map();
  const conversionsRange = rangeAggregates.conversions || conversionsTotal;
  const premiumRange = rangeAggregates.premium || premiumTotal;
  const clicksRange = rangeAggregates.clicks || new Map();

  return offers.map((offer) => {
    const idKey = String(offer.id);
    const total = conversionsTotal.get(idKey) || { conversions: 0, amount_cents: 0 };
    const rangeConv = conversionsRange.get(idKey) || { conversions: 0, amount_cents: 0 };
    const rangePremium = premiumRange.get(idKey) || 0;
    const totalPremium = premiumTotal.get(idKey) || 0;
    const clicks = clicksRange.get(idKey) || 0;

    const spentTotal = normalizeInt(total.amount_cents);
    const spentRange = normalizeInt(rangeConv.amount_cents);
    const budgetCents = normalizeInt(offer.budget_cents);
    const leftCents = Math.max(0, budgetCents - spentTotal);

    return {
      ...offer,
      conversions_total: normalizeInt(total.conversions),
      premium_total: normalizeInt(totalPremium),
      spent_total_cents: spentTotal,
      conversions_range: normalizeInt(rangeConv.conversions),
      premium_range: normalizeInt(rangePremium),
      spent_range_cents: spentRange,
      clicks_range: normalizeInt(clicks),
      budget_left_cents: leftCents,
    };
  });
}

function toRangeBoundaries(rangeKey, fromArg, toArg) {
  const now = new Date();
  const end = new Date(now.getTime());
  const start = new Date(now.getTime());
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);

  if (rangeKey === 'today' || !rangeKey) {
    return { key: 'today', from: start, to: end, label: `${start.toISOString().slice(0, 10)}` };
  }
  if (rangeKey === '7d') {
    const from = new Date(end.getTime());
    from.setDate(from.getDate() - 7);
    return { key: '7d', from, to: end, label: `${from.toISOString().slice(0, 10)} – ${new Date(end.getTime() - 1).toISOString().slice(0, 10)}` };
  }
  if (rangeKey === '30d') {
    const from = new Date(end.getTime());
    from.setDate(from.getDate() - 30);
    return { key: '30d', from, to: end, label: `${from.toISOString().slice(0, 10)} – ${new Date(end.getTime() - 1).toISOString().slice(0, 10)}` };
  }

  if (rangeKey === 'custom') {
    if (!fromArg || !toArg) {
      return null;
    }
    const from = new Date(fromArg);
    const to = new Date(toArg);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return null;
    }
    const toExclusive = new Date(to.getTime());
    toExclusive.setDate(toExclusive.getDate() + 1);
    from.setHours(0, 0, 0, 0);
    toExclusive.setHours(0, 0, 0, 0);
    return { key: 'custom', from, to: toExclusive, label: `${from.toISOString().slice(0, 10)} – ${to.toISOString().slice(0, 10)}` };
  }

  // unknown key fallback: treat as custom single day value
  const maybeDate = new Date(rangeKey);
  if (!Number.isNaN(maybeDate.getTime())) {
    const dayStart = new Date(maybeDate.getTime());
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime());
    dayEnd.setDate(dayEnd.getDate() + 1);
    return { key: 'custom', from: dayStart, to: dayEnd, label: dayStart.toISOString().slice(0, 10) };
  }
  return null;
}

async function buildAdvertiserSummary(tgId) {
  const offers = await fetchOffersForCreator(tgId);
  if (!offers.length) return [];
  const ids = offers.map((offer) => String(offer.id));
  const conversionsTotal = await fetchConversionsMap(ids);
  const premiumTotal = await fetchPremiumMap(ids);
  return enrichOffersWithAggregates(offers, { conversions: conversionsTotal, premium: premiumTotal });
}

async function buildAdvertiserPeriodStats(tgId, range) {
  const offers = await fetchOffersForCreator(tgId);
  if (!offers.length) return [];
  const ids = offers.map((offer) => String(offer.id));
  const conversionsTotal = await fetchConversionsMap(ids);
  const premiumTotal = await fetchPremiumMap(ids);
  const conversionsRange = range ? await fetchConversionsMap(ids, range) : conversionsTotal;
  const premiumRange = range ? await fetchPremiumMap(ids, range) : premiumTotal;
  const clicksRange = range ? await fetchClicksMap(ids, range) : await fetchClicksMap(ids);
  return enrichOffersWithAggregates(
    offers,
    { conversions: conversionsTotal, premium: premiumTotal },
    { conversions: conversionsRange, premium: premiumRange, clicks: clicksRange },
  );
}

async function buildAdminPeriodStats(range) {
  const offers = await fetchOffersForCreator(null);
  if (!offers.length) return [];
  const ids = offers.map((offer) => String(offer.id));
  const conversionsTotal = await fetchConversionsMap(ids);
  const premiumTotal = await fetchPremiumMap(ids);
  const conversionsRange = range ? await fetchConversionsMap(ids, range) : conversionsTotal;
  const premiumRange = range ? await fetchPremiumMap(ids, range) : premiumTotal;
  const clicksRange = range ? await fetchClicksMap(ids, range) : await fetchClicksMap(ids);
  return enrichOffersWithAggregates(
    offers,
    { conversions: conversionsTotal, premium: premiumTotal },
    { conversions: conversionsRange, premium: premiumRange, clicks: clicksRange },
  );
}

async function fetchOfferDetail({ slug, tgId, allowAdmin = false }) {
  const offers = await fetchOffersForCreator(allowAdmin ? null : tgId);
  const match = offers.find((offer) => offer.slug === slug);
  if (!match && !allowAdmin) return null;

  let offer = match;
  if (!offer) {
    const res = await query(
      `SELECT id, slug, event_type, title, name, payout_cents, caps_total, budget_cents, paid_cents, status, created_at, created_by_tg_id, created_by_tg
         FROM offers
        WHERE slug = $1
        LIMIT 1`,
      [slug],
    );
    if (!res.rowCount) return null;
    const row = res.rows[0];
    offer = {
      id: row.id,
      slug: row.slug || slug,
      event_type: row.event_type || '-',
      title: row.title || row.name || row.slug || String(row.id),
      payout_cents: normalizeInt(row.payout_cents),
      caps_total: row.caps_total != null ? normalizeInt(row.caps_total) : null,
      budget_cents: normalizeInt(row.budget_cents),
      paid_cents: normalizeInt(row.paid_cents),
      status: row.status || 'draft',
      created_at: row.created_at || null,
      owner_id: row.created_by_tg_id || row.created_by_tg || (match?.owner_id ?? null),
    };
  }

  const ownerId = offer.owner_id || (match ? match.owner_id : tgId) || null;
  const ids = [String(offer.id)];
  const conversionsTotal = await fetchConversionsMap(ids);
  const premiumTotal = await fetchPremiumMap(ids);
  const totalEntry = conversionsTotal.get(String(offer.id)) || { conversions: 0, amount_cents: 0 };
  const premiumEntry = premiumTotal.get(String(offer.id)) || 0;
  const budgetCents = normalizeInt(offer.budget_cents);
  const spentCents = normalizeInt(totalEntry.amount_cents);
  const budgetLeft = Math.max(0, budgetCents - spentCents);

  return {
    ...offer,
    conversions_total: normalizeInt(totalEntry.conversions),
    premium_total: normalizeInt(premiumEntry),
    spent_total_cents: spentCents,
    budget_left_cents: budgetLeft,
    tracking_url: buildTracking(offer.id, ownerId),
  };
}

async function fetchPendingOffers() {
  const columns = await getOfferColumns();
  const selectParts = ['id', 'slug'];
  if (columns.has('title')) selectParts.push('title');
  else if (columns.has('name')) selectParts.push('name AS title');
  if (columns.has('budget_cents')) selectParts.push('budget_cents');
  if (columns.has('paid_cents')) selectParts.push('paid_cents');
  if (columns.has('created_by_tg_id')) selectParts.push('created_by_tg_id');
  if (columns.has('created_by_tg')) selectParts.push('created_by_tg');
  if (columns.has('status')) selectParts.push('status');
  if (columns.has('created_at')) selectParts.push('created_at');

  let whereClauses = [];
  if (columns.has('budget_cents') && columns.has('paid_cents')) {
    whereClauses.push('COALESCE(paid_cents,0) < COALESCE(budget_cents,0)');
  }
  if (columns.has('status')) {
    whereClauses.push("status IN ('draft','pending')");
  }

  const sql = `SELECT ${selectParts.join(', ')} FROM offers${whereClauses.length ? ` WHERE ${whereClauses.join(' AND ')}` : ''} ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 100`;
  try {
    const res = await query(sql);
    return (res.rows || []).map((row) => ({
      id: row.id,
      slug: row.slug || String(row.id),
      title: row.title || row.name || row.slug || String(row.id),
      budget_cents: normalizeInt(row.budget_cents),
      paid_cents: normalizeInt(row.paid_cents),
      status: row.status || 'draft',
      owner_id: row.created_by_tg_id || row.created_by_tg || null,
      created_at: row.created_at || null,
    }));
  } catch (error) {
    if (error?.code === '42703') {
      return [];
    }
    throw error;
  }
}

export {
  centsToCurrency,
  formatDate,
  buildAdvertiserSummary,
  buildAdvertiserPeriodStats,
  buildAdminPeriodStats,
  toRangeBoundaries,
  fetchOfferDetail,
  fetchPendingOffers,
  buildTracking,
};

export default {
  centsToCurrency,
  formatDate,
  buildAdvertiserSummary,
  buildAdvertiserPeriodStats,
  buildAdminPeriodStats,
  toRangeBoundaries,
  fetchOfferDetail,
  fetchPendingOffers,
  buildTracking,
};
