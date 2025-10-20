import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { resolvePostbackTarget } from './postbackTarget.js';

const MAX_ATTEMPTS = 5;

const trim = (value) => (typeof value === 'string' ? value.trim() : value);

function hmac(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function resolveMethod(offerMethod, configMethod) {
  const fallback = trim(configMethod) || 'GET';
  const method = trim(offerMethod) || fallback;
  return String(method).toUpperCase();
}

function resolveTimeoutMs(offerTimeout, configTimeout) {
  const fallback = Number.isFinite(configTimeout) ? Number(configTimeout) : 4000;
  if (offerTimeout === undefined || offerTimeout === null) {
    return fallback;
  }
  const parsed = Number.parseInt(offerTimeout, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function resolveRetries(offerRetries, configRetries) {
  const fallback = Number.isFinite(configRetries) ? Number(configRetries) : 0;
  if (offerRetries === undefined || offerRetries === null) {
    return Math.max(0, fallback);
  }
  const parsed = Number.parseInt(offerRetries, 10);
  if (Number.isNaN(parsed)) {
    return Math.max(0, fallback);
  }
  return Math.max(0, parsed);
}

function buildParams({ offer, click, event, sentAt, secret }) {
  const params = new URLSearchParams();
  if (offer?.id) params.set('offer_id', String(offer.id));
  if (event?.id) params.set('event_id', String(event.id));

  const eventType = event?.event_type ?? event?.event;
  if (eventType) params.set('event_type', String(eventType));

  if (event?.tg_id !== undefined && event?.tg_id !== null) {
    params.set('tg_id', String(event.tg_id));
  }

  const clickId = click?.click_id ?? click?.id;
  if (clickId) params.set('click_id', String(clickId));

  if (click?.uid) params.set('uid', String(click.uid));

  if (event?.created_at) {
    const created = new Date(event.created_at).toISOString();
    params.set('created_at', created);
  }

  params.set('sent_at', sentAt);

  if (secret) {
    const base = params.toString();
    params.set('sig', hmac(secret, base));
  }

  return params;
}

async function logPostbackAttempt({
  offerId,
  eventId,
  url,
  method,
  status,
  duration,
  body,
  attempt,
  payload,
  eventType,
}) {
  try {
    await query(
      `INSERT INTO postbacks (offer_id, event_id, url, method, status_code, response_ms, response_body, attempt, payload, event_type)` +
        ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        offerId,
        eventId ?? null,
        url,
        method,
        status,
        duration,
        String(body ?? '').slice(0, 4000),
        attempt,
        payload,
        eventType ?? null,
      ],
    );
  } catch (error) {
    console.warn('[postback] log failed:', error?.message || error);
  }
}

/**
 * sendPostbackForEvent({ offer, click, event })
 *  offer: { id, postback_url?, postback_method?, postback_secret?, postback_timeout_ms?, postback_retries? }
 *  click: { id|click_id, uid } | null
 *  event: { id, event|event_type, tg_id, created_at }
 */
export async function sendPostbackForEvent({ offer, click, event }) {
  const baseUrl = resolvePostbackTarget(offer);

  if (!baseUrl) {
    console.warn('[postback] skipped: no URL');
    return { skipped: true };
  }

  const secret = trim(offer?.postback_secret) || trim(config?.postback?.secret) || null;
  const method = resolveMethod(offer?.postback_method, config?.postback?.method);
  const timeoutMs = resolveTimeoutMs(offer?.postback_timeout_ms, config?.postback?.timeoutMs);
  const retries = resolveRetries(offer?.postback_retries, config?.postback?.retries);
  const maxAttempts = Math.min(MAX_ATTEMPTS, Math.max(1, 1 + retries));

  const sentAt = new Date().toISOString();
  const params = buildParams({ offer, click, event, sentAt, secret });
  const payload = params.toString();

  /** @type {RequestInit} */
  const requestInit = { method, redirect: 'follow', headers: {} };
  let requestUrl = baseUrl;

  if (method === 'GET') {
    requestUrl += (requestUrl.includes('?') ? '&' : '?') + payload;
  } else {
    requestInit.headers['content-type'] = 'application/x-www-form-urlencoded';
    requestInit.body = payload;
  }

  let lastStatus = 0;
  let lastBody = '';

  const eventType = event?.event_type ?? event?.event ?? null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    let status = 0;
    let responseBody = '';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(requestUrl, { ...requestInit, signal: controller.signal });
      status = response.status;
      responseBody = await response.text();
    } catch (error) {
      responseBody = String(error?.message || error);
    } finally {
      clearTimeout(timer);
    }

    const duration = Date.now() - startedAt;
    lastStatus = status;
    lastBody = responseBody;

    await logPostbackAttempt({
      offerId: offer?.id ?? null,
      eventId: event?.id ?? null,
      url: requestUrl,
      method,
      status,
      duration,
      body: responseBody,
      attempt,
      payload,
      eventType,
    });

    if (status >= 200 && status < 300) {
      console.log('[postback] ok', { status, url: requestUrl, attempt });
      return { status, url: requestUrl, attempt, payload };
    }

    console.error('[postback] failed', { status, url: requestUrl, attempt });
  }

  return { status: lastStatus, url: requestUrl, attempt: maxAttempts, payload, error: lastBody };
}

export default sendPostbackForEvent;
