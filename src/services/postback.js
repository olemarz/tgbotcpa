import { config } from '../config.js';
import { hmacSHA256Hex } from '../util/hmac.js';
import { isDupe, remember } from '../util/idempotency.js';
import { query } from '../db/index.js';
import { uuid } from '../util/id.js';

const DEFAULT_TIMEOUT_MS = 4000;

const buildIdempotencyKey = (offerId, tgId, event) => `${offerId}:${tgId}:${event}`;

async function recordPostback({ offer_id, tg_id, uid, event, httpStatus, status, error }) {
  try {
    await query(
      `INSERT INTO postbacks (id, offer_id, tg_id, uid, event, http_status, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [uuid(), offer_id, tg_id, uid ?? null, event, httpStatus ?? null, status, error ?? null]
    );
  } catch (insertError) {
    console.error('postbacks insert error', insertError);
  }
}

export async function sendPostback({ offer_id, tg_id, uid, click_id, event, payout_cents }) {
  if (!offer_id || !tg_id || !event) {
    throw new Error('offer_id, tg_id and event are required for postback');
  }

  const timestamp = new Date().toISOString();
  const payload = {
    event,
    offer_id,
    tg_id,
    uid: uid ?? null,
    click_id: click_id ?? null,
    ts: timestamp,
  };

  if (typeof payout_cents === 'number' && Number.isFinite(payout_cents)) {
    payload.payout_cents = payout_cents;
  }

  const payloadJson = JSON.stringify(payload);
  const signature = hmacSHA256Hex(payloadJson, config.cpaSecret || '');

  const idempotencyKey = buildIdempotencyKey(offer_id, tg_id, event);
  if (isDupe(idempotencyKey)) {
    await recordPostback({ offer_id, tg_id, uid, event, status: 'dedup' });
    return { ok: true, dedup: true, signature, status: null, http_status: null };
  }

  const timeoutMs = config.postbackTimeoutMs || DEFAULT_TIMEOUT_MS;

  if (!config.cpaPostbackUrl) {
    remember(idempotencyKey, config.idempotencyTtlSec);
    await recordPostback({ offer_id, tg_id, uid, event, status: 'dry-run' });
    return { ok: true, dryRun: true, signature, status: null, http_status: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let httpStatus;

  try {
    const response = await fetch(config.cpaPostbackUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Signature': signature,
      },
      body: payloadJson,
      signal: controller.signal,
    });

    httpStatus = response.status;

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`CPA responded with ${response.status}${text ? `: ${text}` : ''}`);
    }

    remember(idempotencyKey, config.idempotencyTtlSec);
    await recordPostback({ offer_id, tg_id, uid, event, httpStatus, status: 'sent' });
    console.log('postback sent', { offer_id, tg_id, event, httpStatus });
    return { ok: true, status: httpStatus ?? null, http_status: httpStatus ?? null, signature };
  } catch (error) {
    await recordPostback({ offer_id, tg_id, uid, event, httpStatus, status: 'failed', error: error?.message });
    console.error('postback send failed', { offer_id, tg_id, event, error: error?.message });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
