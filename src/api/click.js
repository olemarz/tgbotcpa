import geoip from 'geoip-lite';
import requestIp from 'request-ip';

import { config } from '../config.js';
import { query } from '../db/index.js';
import { shortToken, uuid } from '../util/id.js';
import { isAllowedByGeo } from '../utils/geo.js';
import { buildStartDeepLink } from '../utils/tracking-link.js';

const UUID_REGEXP = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLICK_TOKEN_RETRIES = 5;

function isUUID(value) {
  return typeof value === 'string' && UUID_REGEXP.test(value);
}

function normalizeOptional(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function normalizeIp(value) {
  if (!value) {
    return null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice('::ffff:'.length);
  }
  return trimmed;
}

function trimTrailingSlash(url) {
  return url.replace(/\/$/, '');
}

async function loadOfferGeo(offerId) {
  try {
    const result = await query(
      'SELECT id, geo_mode, geo_list FROM offers WHERE id = $1 LIMIT 1',
      [offerId],
    );
    return result.rowCount ? result.rows[0] : null;
  } catch (error) {
    const code = error?.code;
    const message = typeof error?.message === 'string' ? error.message : '';
    if (code === '42703' || code === '42P01' || message.includes('geo_mode') || message.includes('geo_list')) {
      console.warn('[click] geo columns missing, skipping geo filter');
      return null;
    }
    throw error;
  }
}

function buildUnavailableRedirect() {
  const base = trimTrailingSlash(config.baseUrl || process.env.BASE_URL || '');
  if (!base) {
    return '/unavailable?reason=geo';
  }
  return `${base}/unavailable?reason=geo`;
}

async function insertClickRow({
  offerId,
  uid,
  externalClickId,
  source,
  sub1,
  sub2,
  ip,
  userAgent,
}) {
  let attempt = 0;
  while (attempt < CLICK_TOKEN_RETRIES) {
    const startToken = shortToken();
    const rowId = uuid();

    try {
      await query(
        `INSERT INTO clicks (id, offer_id, uid, click_id, source, sub1, sub2, start_token, ip, ua)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          rowId,
          offerId,
          uid ?? null,
          externalClickId ?? null,
          source ?? null,
          sub1 ?? null,
          sub2 ?? null,
          startToken,
          ip ?? null,
          userAgent ?? null,
        ],
      );

      return { id: rowId, startToken };
    } catch (error) {
      if (error?.code === '23505') {
        attempt += 1;
        continue;
      }
      throw error;
    }
  }

  throw new Error('failed to generate unique start token for click');
}

export async function handleClick(req, res) {
  const offerId = req.params?.offerId;
  if (!isUUID(offerId)) {
    res.status(400).json({ ok: false, error: 'offer_id must be UUID' });
    return;
  }

  const botUsername = config.botUsername || process.env.BOT_USERNAME || '';
  if (!botUsername) {
    res
      .status(500)
      .json({ ok: false, error: 'BOT_USERNAME is required. Please set BOT_USERNAME in the environment.' });
    return;
  }

  const offerGeo = await loadOfferGeo(offerId);
  const geoMode = offerGeo?.geo_mode ?? null;
  const geoList = offerGeo?.geo_list ?? null;

  const uid = normalizeOptional(req.query?.uid ?? req.query?.sub);
  const externalClickId = normalizeOptional(req.query?.click_id ?? req.query?.clickId);
  const source = normalizeOptional(req.query?.source);
  const sub1 = normalizeOptional(req.query?.sub1);
  const sub2 = normalizeOptional(req.query?.sub2);
  const userAgent = normalizeOptional(req.get('user-agent'));

  const ipRaw = requestIp.getClientIp(req);
  const ip = normalizeIp(ipRaw);
  const lookup = ip ? geoip.lookup(ip) : null;
  const country = lookup?.country ?? null;

  if (!isAllowedByGeo(country, geoMode, geoList)) {
    console.info('[click] blocked by geo', {
      offer_id: offerId,
      ip,
      country,
      geo_mode: geoMode,
      geo_list: geoList,
    });
    res.redirect(buildUnavailableRedirect());
    return;
  }

  let clickRow;
  try {
    clickRow = await insertClickRow({
      offerId,
      uid,
      externalClickId,
      source,
      sub1,
      sub2,
      ip,
      userAgent,
    });
  } catch (error) {
    if (error?.code === '23503') {
      res.status(404).json({ ok: false, error: 'offer not found' });
      return;
    }
    if (error?.code === '23505') {
      res.status(503).json({ ok: false, error: 'temporary token collision, retry' });
      return;
    }
    console.error('[click] failed to store click', error?.message || error);
    res.status(500).json({ ok: false, error: 'failed to store click' });
    return;
  }

  const startToken = clickRow.startToken;
  if (!startToken) {
    console.error('[click] missing start token after insert', {
      offer_id: offerId,
      uid,
      external_click_id: externalClickId,
    });
    res.status(500).json({ ok: false, error: 'failed to generate start token' });
    return;
  }

  console.log('[click] stored', {
    offer_id: offerId,
    uid,
    click_id: externalClickId,
    start_token: startToken,
    source,
    sub1,
    sub2,
    country,
  });

  const redirectUrl = buildStartDeepLink({ botUsername, token: startToken });
  res.redirect(302, redirectUrl);
}
