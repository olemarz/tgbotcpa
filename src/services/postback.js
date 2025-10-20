import { config } from '../config.js';
import { hmacSHA256Hex } from '../util/hmac.js';
import { isDupe, remember } from '../util/idempotency.js';
import { query } from '../db/index.js';
import { uuid } from '../util/id.js';
import { sendPostbackForEvent } from '../utils/postbackSender.js';

const DEFAULT_TIMEOUT_MS = 4000;

const buildIdempotencyKey = (offerId, tgId, eventType) => `${offerId}:${tgId}:${eventType}`;

function toBase64Url(input) {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function normalizePayload(payload) {
  if (payload === undefined || payload === null) {
    return null;
  }
  if (typeof payload === 'string') {
    return payload;
  }
  try {
    const json = JSON.stringify(payload);
    return toBase64Url(json);
  } catch (error) {
    console.warn('[postback] failed to encode payload as base64url', error?.message || error);
    return null;
  }
}

async function recordPostback({
  offer_id,
  event_id,
  event_type,
  tg_id,
  uid,
  payload,
  httpStatus,
  status,
  error,
  attempt = 1,
}) {
  try {
    const normalizedPayload = normalizePayload(payload);
    await query(
      `INSERT INTO postbacks (id, offer_id, event_id, tg_id, uid, event_type, payload, http_status, status, error, attempt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)` ,
      [
        uuid(),
        offer_id,
        event_id,
        tg_id ?? null,
        uid ?? null,
        event_type ?? null,
        normalizedPayload,
        httpStatus ?? null,
        status,
        error ?? null,
        attempt,
      ]
    );
  } catch (insertError) {
    console.error('postbacks insert error', insertError);
  }
}

export async function sendPostback({
  offer_id,
  event_id,
  event_type,
  event,
  tg_id,
  uid,
  click_id,
  payout_cents,
  payload: eventPayload,
}) {
  const resolvedEventType = event_type ?? event;
  if (!offer_id || !event_id || !resolvedEventType || !tg_id) {
    throw new Error('offer_id, event_id, event_type and tg_id are required for postback');
  }

  const timestamp = new Date().toISOString();
  const body = {
    event_type: resolvedEventType,
    offer_id,
    tg_id,
    uid: uid ?? null,
    click_id: click_id ?? null,
    ts: timestamp,
  };

  if (typeof payout_cents === 'number' && Number.isFinite(payout_cents)) {
    body.payout_cents = payout_cents;
  }

  const encodedEventPayload = normalizePayload(eventPayload);
  if (encodedEventPayload) {
    body.payload = encodedEventPayload;
  }

  const payloadJson = JSON.stringify(body);
  const signature = hmacSHA256Hex(payloadJson, config.cpaSecret || '');

  const idempotencyKey = buildIdempotencyKey(offer_id, tg_id, resolvedEventType);
  if (isDupe(idempotencyKey)) {
    await recordPostback({
      offer_id,
      event_id,
      event_type: resolvedEventType,
      tg_id,
      uid,
      payload: encodedEventPayload,
      status: 'dedup',
      attempt: 0,
    });
    console.log('[POSTBACK]', { status: 'dedup', attempt: 0 });
    return { ok: true, dedup: true, signature, status: null, http_status: null };
  }

  const timeoutMs = config.postbackTimeoutMs || DEFAULT_TIMEOUT_MS;

  if (!config.cpaPostbackUrl) {
    remember(idempotencyKey, config.idempotencyTtlSec);
    await recordPostback({
      offer_id,
      event_id,
      event_type: resolvedEventType,
      tg_id,
      uid,
      payload: encodedEventPayload,
      status: 'dry-run',
      attempt: 0,
    });
    console.log('[POSTBACK]', { status: 'dry-run', attempt: 0 });
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
    await recordPostback({
      offer_id,
      event_id,
      event_type: resolvedEventType,
      tg_id,
      uid,
      payload: encodedEventPayload,
      httpStatus,
      status: 'sent',
    });
    console.log('postback sent', { offer_id, tg_id, event_type: resolvedEventType, httpStatus });
    console.log('[POSTBACK]', { status: 'sent', attempt: 1 });
    return { ok: true, status: httpStatus ?? null, http_status: httpStatus ?? null, signature };
  } catch (error) {
    await recordPostback({
      offer_id,
      event_id,
      event_type: resolvedEventType,
      tg_id,
      uid,
      payload: encodedEventPayload,
      httpStatus,
      status: 'failed',
      error: error?.message,
    });
    console.error('postback send failed', { offer_id, tg_id, event_type: resolvedEventType, error: error?.message });
    console.log('[POSTBACK]', { status: 'failed', attempt: 1 });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export { sendPostbackForEvent };
