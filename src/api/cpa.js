import express from 'express';
import { config } from '../config.js';
import { query } from '../db/index.js';

export const cpaRouter = express.Router();

const UUID_REGEXP = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const baseTrackingOrigin = (() => {
  const base = config.baseUrl || '';
  try {
    return new URL(base).origin;
  } catch (_error) {
    return base.replace(/\/?$/, '');
  }
})();

function getHeaderApiKey(req) {
  const raw = req.get('X-Api-Key');
  return typeof raw === 'string' ? raw.trim() : '';
}

function ensureAuthorized(req, res, next) {
  const expectedKey = (config.cpaApiKey || '').trim();
  if (!expectedKey || getHeaderApiKey(req) !== expectedKey) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

function buildGeo(row) {
  const mode = typeof row.geo_mode === 'string' ? row.geo_mode : 'any';
  const list = Array.isArray(row.geo_list)
    ? row.geo_list
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    : [];

  if (mode === 'any' && list.length === 0) {
    return { mode: 'any', list: [] };
  }

  return { mode, list };
}

function buildTrackingUrl(offerId, existing) {
  if (typeof existing === 'string' && existing.trim()) {
    return existing.trim();
  }

  if (!baseTrackingOrigin) {
    return null;
  }

  const normalizedOrigin = baseTrackingOrigin.replace(/\/?$/, '');
  return `${normalizedOrigin}/click/${offerId}?uid={your_uid}`;
}

function mapOfferRow(row) {
  const title = typeof row.title === 'string' && row.title.trim()
    ? row.title.trim()
    : typeof row.name === 'string' && row.name.trim()
      ? row.name.trim()
      : null;

  const actionType = typeof row.action_type === 'string' && row.action_type.trim()
    ? row.action_type.trim()
    : typeof row.event_type === 'string' && row.event_type.trim()
      ? row.event_type.trim()
      : null;

  const targetLink = typeof row.target_link === 'string' && row.target_link.trim()
    ? row.target_link.trim()
    : typeof row.target_url === 'string' && row.target_url.trim()
      ? row.target_url.trim()
      : null;

  const payoutCents = [row.payout_cents, row.premium_rate, row.base_rate].find(
    (value) => typeof value === 'number' && Number.isFinite(value)
  );

  const status = typeof row.status === 'string' && row.status.trim() ? row.status.trim() : 'active';

  const dailyCapCandidates = [row.daily_cap, row.caps_daily, row.caps_total];
  const dailyCap = dailyCapCandidates.find((value) =>
    typeof value === 'number' && Number.isFinite(value)
  );

  return {
    id: row.id,
    title,
    action_type: actionType,
    target_link: targetLink,
    geo: buildGeo(row),
    daily_cap: dailyCap ?? null,
    payout_cents: payoutCents ?? null,
    tracking_url: buildTrackingUrl(row.id, row.tracking_url),
    status,
  };
}

cpaRouter.use(ensureAuthorized);

cpaRouter.get('/offers/:id', async (req, res) => {
  const offerId = req.params?.id;
  if (typeof offerId !== 'string' || !UUID_REGEXP.test(offerId)) {
    return res.status(400).json({ error: 'invalid_offer_id' });
  }

  try {
    const result = await query('SELECT * FROM offers WHERE id = $1 LIMIT 1', [offerId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    return res.json(mapOfferRow(result.rows[0]));
  } catch (error) {
    console.error('[cpa] failed to fetch offer', error);
    return res.status(500).json({ error: 'internal_error' });
  }
});
