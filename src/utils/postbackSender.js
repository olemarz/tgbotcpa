import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { config } from '../config.js';

function hmac(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * sendPostbackForEvent({ offer, click, event })
 *  offer: { id, postback_url?, postback_method?, postback_secret?, postback_timeout_ms? }
 *  click: { id|click_id, uid } | null
 *  event: { id, event|event_type, tg_id, created_at }
 */
export async function sendPostbackForEvent({ offer, click, event }) {
  const baseUrl =
    (offer?.postback_url && String(offer.postback_url).trim()) ||
    config?.postback?.url ||
    process.env.POSTBACK_URL ||
    null;

  if (!baseUrl) {
    console.warn('[postback] skipped: no URL');
    return { skipped: true };
  }

  const method =
    (offer?.postback_method || config?.postback?.method || process.env.POSTBACK_METHOD || 'GET').toUpperCase();

  const timeoutMs = Number(
    offer?.postback_timeout_ms || config?.postback?.timeoutMs || process.env.POSTBACK_TIMEOUT_MS || 5000
  );

  const secret =
    offer?.postback_secret || config?.postback?.secret || process.env.POSTBACK_SECRET || null;

  const params = new URLSearchParams({
    offer_id: String(offer.id),
    event_type: String(event.event_type || event.event),
    tg_id: String(event.tg_id),
    click_id: String(click?.click_id || click?.id || ''),
    uid: String(click?.uid || ''),
    ts: new Date().toISOString(),
  });

  if (secret) params.set('sig', hmac(secret, params.toString()));

  let url = baseUrl;
  /** @type {RequestInit} */
  const opts = { method, redirect: 'follow', headers: {} };

  if (method === 'GET') {
    url += (url.includes('?') ? '&' : '?') + params.toString();
  } else {
    opts.headers['content-type'] = 'application/x-www-form-urlencoded';
    opts.body = params.toString();
  }

  const t0 = Date.now();
  let status = 0, body = '';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    status = res.status;
    body = await res.text();
    clearTimeout(timer);
  } catch (e) {
    body = String(e?.message || e);
  }

  try {
    await query(
      `INSERT INTO postbacks (offer_id, event_id, url, method, status_code, response_ms, response_body, attempt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [offer.id, event?.id || null, url, method, status, Date.now() - t0, String(body).slice(0,4000), 1]
    );
  } catch (e) {
    console.warn('[postback] log failed:', e?.message || e);
  }

  if (status < 200 || status >= 300) {
    console.error('[postback] failed', { status, url });
  } else {
    console.log('[postback] ok', { status });
  }
  return { status, url };
}
