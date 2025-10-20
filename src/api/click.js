import requestIp from 'request-ip';

import { config } from '../config.js';
import { query } from '../db/index.js';
import { shortToken } from '../util/id.js';

const UUID_REGEXP = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC_REGEXP = /^\d+$/;

const CLICK_TOKEN_RETRIES = 5;

let clickColumnsPromise;

async function loadClickColumns() {
  if (!clickColumnsPromise) {
    clickColumnsPromise = query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'clicks'`,
    )
      .then((res) => new Set(res.rows.map((row) => row.column_name)))
      .catch((error) => {
        console.error('[click] failed to load clicks columns', error?.message || error);
        return new Set();
      });
  }
  return clickColumnsPromise;
}

function normalizeOptional(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function normalizeOfferId(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    return { ok: false, reason: 'offer_id is required' };
  }
  if (UUID_REGEXP.test(value)) {
    return { ok: true, value };
  }
  if (NUMERIC_REGEXP.test(value)) {
    return { ok: true, value: Number.parseInt(value, 10) };
  }
  return { ok: false, reason: 'offer_id must be numeric or UUID' };
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
  referer,
}) {
  const columnsSet = await loadClickColumns();

  let attempts = 0;
  while (attempts < CLICK_TOKEN_RETRIES) {
    const token = shortToken();
    const insertColumns = ['offer_id', 'uid', 'click_id', 'start_token'];
    const values = [offerId, uid, externalClickId, token];

    if (columnsSet.has('source')) {
      insertColumns.push('source');
      values.push(source);
    }
    if (columnsSet.has('sub1')) {
      insertColumns.push('sub1');
      values.push(sub1);
    }
    if (columnsSet.has('sub2')) {
      insertColumns.push('sub2');
      values.push(sub2);
    }
    if (columnsSet.has('user_ip')) {
      insertColumns.push('user_ip');
      values.push(ip);
    } else if (columnsSet.has('ip')) {
      insertColumns.push('ip');
      values.push(ip);
    }
    if (columnsSet.has('user_agent')) {
      insertColumns.push('user_agent');
      values.push(userAgent);
    } else if (columnsSet.has('ua')) {
      insertColumns.push('ua');
      values.push(userAgent);
    }
    if (columnsSet.has('referer')) {
      insertColumns.push('referer');
      values.push(referer);
    }

    const placeholders = insertColumns.map((_, idx) => `$${idx + 1}`);

    try {
      await query(
        `INSERT INTO clicks (${insertColumns.join(', ')}) VALUES (${placeholders.join(', ')})`,
        values,
      );
      return token;
    } catch (error) {
      if (error?.code === '23505') {
        attempts += 1;
        continue;
      }
      if (error?.code === '42703') {
        clickColumnsPromise = null;
      }
      throw error;
    }
  }

  throw new Error('failed to generate unique start token for click');
}

function buildTelegramStartLink(botUsername, token) {
  const url = new URL(`https://t.me/${botUsername}`);
  url.searchParams.set('start', token);
  return url.toString();
}

export async function handleClick(req, res) {
  const botUsername = config.botUsername || process.env.BOT_USERNAME || '';
  if (!botUsername) {
    res.status(500).json({ ok: false, error: 'BOT_USERNAME env is required' });
    return;
  }

  const { offerId: offerIdRaw } = req.params || {};
  const offerIdNormalized = normalizeOfferId(offerIdRaw);
  if (!offerIdNormalized.ok) {
    res.status(400).json({ ok: false, error: offerIdNormalized.reason });
    return;
  }

  const offerId = offerIdNormalized.value;
  const uid = normalizeOptional(req.query?.uid ?? req.query?.sub);
  const externalClickId = normalizeOptional(req.query?.click_id ?? req.query?.clickId);
  const source = normalizeOptional(req.query?.source);
  const sub1 = normalizeOptional(req.query?.sub1);
  const sub2 = normalizeOptional(req.query?.sub2);
  const ip = normalizeOptional(requestIp.getClientIp(req));
  const userAgent = normalizeOptional(req.get('user-agent'));
  const referer = normalizeOptional(req.get('referer') || req.get('referrer'));

  let startToken;
  try {
    startToken = await insertClickRow({
      offerId,
      uid,
      externalClickId,
      source,
      sub1,
      sub2,
      ip,
      userAgent,
      referer,
    });
  } catch (error) {
    if (error?.code === '23503') {
      res.status(404).json({ ok: false, error: 'offer not found' });
      return;
    }
    console.error('[click] failed to store click', error?.message || error);
    res.status(500).json({ ok: false, error: 'failed to store click' });
    return;
  }

  console.log('[click] stored', {
    offer_id: offerId,
    uid,
    click_id: externalClickId,
    start_token: startToken,
  });

  const redirectUrl = buildTelegramStartLink(botUsername, startToken);
  res.redirect(302, redirectUrl);
}

