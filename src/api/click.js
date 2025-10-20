import requestIp from 'request-ip';

import { config } from '../config.js';
import { query } from '../db/index.js';
import { shortToken, uuid } from '../util/id.js';

const UUID_REGEXP = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLICK_TOKEN_RETRIES = 5;

let clickColumnsPromise;

async function loadClickColumns() {
  if (!clickColumnsPromise) {
    clickColumnsPromise = query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'clicks'`,
    )
      .then((res) => {
        const map = new Map();
        for (const row of res.rows) {
          map.set(row.column_name, row.data_type);
        }
        return map;
      })
      .catch((error) => {
        console.error('[click] failed to load clicks columns', error?.message || error);
        return new Map();
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

function normalizeIpValue(value) {
  if (typeof value !== 'string') {
    return value;
  }
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) {
    return mapped[1];
  }
  return value;
}

function normalizeOfferId(raw) {
async function resolveOfferId(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    return { ok: false, status: 400, error: 'offer_id is required' };
  }

  const looksLikeUuid = value.length === 36 && value.includes('-');
  if (looksLikeUuid) {
    return { ok: true, value };
  }

  if (UUID_REGEXP.test(value)) {
    return { ok: true, value };
  }

// helper: нормализуем offerId из пути: UUID или slug
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolveOfferId(value, query) {
  if (!value) return { ok: false, status: 400, error: 'offer id or slug required' };

  // 1) UUID — возвращаем как есть
  if (UUID_RE.test(String(value))) {
    return { ok: true, value: String(value) };
  }

  // 2) Пытаемся найти по slug (если колонки нет — вернём 404)
  try {
    const res = await query(`SELECT id FROM offers WHERE slug = $1 LIMIT 1`, [String(value)]);
    if (!res.rowCount) return { ok: false, status: 404, error: 'offer not found' };
    return { ok: true, value: res.rows[0].id };
  } catch (error) {
    // если нет колонки slug — считаем, что такого способа нет
    if (error?.code === '42703' || error?.code === '42P01') {
      console.warn('[click] offers.slug column missing; cannot resolve slug');
      return { ok: false, status: 404, error: 'offer not found' };
    }
    console.error('[click] failed to resolve offer by slug', error?.message || error);
    return { ok: false, status: 500, error: 'failed to resolve offer' };
  }
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
  const columns = await loadClickColumns();

  if (!columns.has('offer_id')) {
    throw new Error('clicks table is missing offer_id column');
  }
  if (!columns.has('start_token')) {
    throw new Error('clicks table is missing start_token column');
  }

  let attempts = 0;
  while (attempts < CLICK_TOKEN_RETRIES) {
    const token = shortToken();
    const insertColumns = ['id', 'offer_id', 'uid', 'click_id', 'start_token'];
    const values = [uuid(), offerId, uid, externalClickId, token];

    let generatedClickId = null;
    if (columns.get('id') === 'uuid') {
      generatedClickId = uuid();
      insertColumns.push('id');
      values.push(generatedClickId);
    }

    insertColumns.push('offer_id');
    values.push(offerId);

    if (columns.has('uid')) {
      insertColumns.push('uid');
      values.push(uid);
    }

    if (columns.has('click_id')) {
      insertColumns.push('click_id');
      values.push(externalClickId);
    }

    insertColumns.push('start_token');
    values.push(token);

    if (columns.has('source')) {
      insertColumns.push('source');
      values.push(source);
    }
    if (columns.has('sub1')) {
      insertColumns.push('sub1');
      values.push(sub1);
    }
    if (columns.has('sub2')) {
      insertColumns.push('sub2');
      values.push(sub2);
    }
    if (columns.has('user_ip')) {
      insertColumns.push('user_ip');
      values.push(ip);
    } else if (columns.has('ip')) {
      insertColumns.push('ip');
      values.push(ip);
    }
    if (columns.has('user_agent')) {
      insertColumns.push('user_agent');
      values.push(userAgent);
    } else if (columns.has('ua')) {
      insertColumns.push('ua');
      values.push(userAgent);
    }
    if (columns.has('referer')) {
      insertColumns.push('referer');
      values.push(referer);
    }

    const placeholders = insertColumns.map((_, idx) => `$${idx + 1}`);

    try {
      const result = await query(
        `INSERT INTO clicks (${insertColumns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
        values,
      );
      const insertedId = result.rows[0]?.id ?? null;
      return { token, clickId: insertedId };
      const insertedId = result?.rows?.[0]?.id ?? generatedClickId;
      return { startToken: token, clickId: insertedId ?? null };
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
  const offerIdResolved = await resolveOfferId(offerIdRaw);
  if (!offerIdResolved.ok) {
    const status = offerIdResolved.status ?? 400;
    res.status(status).json({ ok: false, error: offerIdResolved.error || 'offer not found' });
    return;
  }

  const offerId = offerIdResolved.value;
  const uid = normalizeOptional(req.query?.uid ?? req.query?.sub);
  const externalClickId = normalizeOptional(req.query?.click_id ?? req.query?.clickId);
  const source = normalizeOptional(req.query?.source);
  const sub1 = normalizeOptional(req.query?.sub1);
  const sub2 = normalizeOptional(req.query?.sub2);
  const ip = normalizeOptional(normalizeIpValue(requestIp.getClientIp(req)));
  const userAgent = normalizeOptional(req.get('user-agent'));
  const referer = normalizeOptional(req.get('referer') || req.get('referrer'));

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
      referer,
    });
    startToken = inserted.token;
    clickRowId = inserted.clickId;
  } catch (error) {
    if (error?.code === '23503') {
      res.status(404).json({ ok: false, error: 'offer not found' });
      return;
    }
    console.error('[click] failed to store click', error?.message || error);
    res.status(500).json({ ok: false, error: 'failed to store click' });
    return;
  }

  const startToken = clickRow?.startToken;
  const clickId = clickRow?.clickId || null;

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
    stored_click_id: clickId,
  });

  console.log('[ATTR] linked', {
    offer_id: offerId,
    click_id: clickRowId ?? null,
    tg_id: null,
  });

  const redirectUrl = buildTelegramStartLink(botUsername, startToken);
  res.redirect(302, redirectUrl);
}

