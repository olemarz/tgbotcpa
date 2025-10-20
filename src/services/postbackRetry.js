import { query } from '../db/index.js';
import { sendPostbackForEvent } from '../utils/postbackSender.js';

const FAILED_STATUS_CONDITION =
  '(status_code IS NULL OR status_code < 200 OR status_code >= 300)';

function sanitizeLimit(limit) {
  const value = Number.parseInt(limit, 10);
  if (Number.isNaN(value) || value <= 0) {
    return 5;
  }
  return Math.min(value, 50);
}

export async function retryFailedPostbacksForSlug({ slug, limit = 5 }) {
  const normalizedSlug = String(slug || '').trim();
  if (!normalizedSlug) {
    return {
      ok: false,
      reason: 'invalid_slug',
      retries: [],
    };
  }

  const offerResult = await query(
    `SELECT id, slug, postback_url, postback_secret, postback_method, postback_timeout_ms
       FROM offers
      WHERE slug = $1
      LIMIT 1`,
    [normalizedSlug],
  );

  if (!offerResult.rowCount) {
    return {
      ok: false,
      reason: 'offer_not_found',
      retries: [],
    };
  }

  const offer = offerResult.rows[0];
  const limitValue = sanitizeLimit(limit);

  let postbacksResult;
  try {
    postbacksResult = await query(
      `SELECT id, event_id, attempt, status_code, created_at
         FROM postbacks
        WHERE offer_id = $1
          AND ${FAILED_STATUS_CONDITION}
        ORDER BY created_at DESC
        LIMIT $2`,
      [offer.id, limitValue],
    );
  } catch (error) {
    if (error?.code === '42703') {
      postbacksResult = await query(
        `SELECT id, event_id, attempt, http_status AS status_code, created_at
           FROM postbacks
          WHERE offer_id = $1
            AND (http_status IS NULL OR http_status < 200 OR http_status >= 300)
          ORDER BY created_at DESC
          LIMIT $2`,
        [offer.id, limitValue],
      );
    } else {
      throw error;
    }
  }

  if (!postbacksResult.rowCount) {
    return {
      ok: true,
      offer,
      retries: [],
    };
  }

  const retries = [];

  for (const row of postbacksResult.rows) {
    const nextAttempt = (Number(row.attempt) || 1) + 1;

    if (!row.event_id) {
      retries.push({
        postbackId: row.id,
        eventId: null,
        previousAttempt: row.attempt ?? null,
        attempt: nextAttempt,
        status: null,
        error: 'missing_event_id',
      });
      continue;
    }

    const eventResult = await query(
      `SELECT id, tg_id, event_type, created_at
         FROM events
        WHERE id = $1
        LIMIT 1`,
      [row.event_id],
    );

    if (!eventResult.rowCount) {
      retries.push({
        postbackId: row.id,
        eventId: row.event_id,
        previousAttempt: row.attempt ?? null,
        attempt: nextAttempt,
        status: null,
        error: 'event_not_found',
      });
      continue;
    }

    const event = eventResult.rows[0];

    let click = null;
    try {
      const clickResult = await query(
        `SELECT c.id, c.click_id, c.uid
           FROM attribution a
           JOIN clicks c ON c.id = a.click_id
          WHERE a.event_id = $1
          ORDER BY a.created_at DESC
          LIMIT 1`,
        [event.id],
      );

      click = clickResult.rowCount ? clickResult.rows[0] : null;
    } catch (error) {
      if (error?.code === '42703') {
        console.warn('[postbackRetry] click lookup skipped: event_id column missing');
      } else {
        throw error;
      }
    }

    const result = await sendPostbackForEvent({
      offer: {
        id: offer.id,
        postback_url: offer.postback_url,
        postback_secret: offer.postback_secret,
        postback_method: offer.postback_method,
        postback_timeout_ms: offer.postback_timeout_ms,
      },
      click,
      event: {
        id: event.id,
        tg_id: event.tg_id,
        event_type: event.event_type,
      },
      attempt: nextAttempt,
    });

    retries.push({
      postbackId: row.id,
      eventId: event.id,
      tgId: event.tg_id,
      previousAttempt: row.attempt ?? null,
      attempt: nextAttempt,
      status: result?.status ?? null,
      url: result?.url ?? null,
      skipped: !!result?.skipped,
    });
  }

  return {
    ok: true,
    offer,
    retries,
  };
}
