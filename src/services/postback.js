// Каноничная точка входа для постбеков из бота/ивентов.
// Под капотом используем utils/postbackSender.js

import { query } from '../db/index.js';
import { sendPostbackForEvent } from '../utils/postbackSender.js';

const OFFER_FIELDS = [
  'id',
  'postback_url',
  'postback_method',
  'postback_secret',
  'postback_timeout_ms',
];

async function fetchOffer(offerId) {
  if (!offerId) return null;
  const res = await query(
    `SELECT ${OFFER_FIELDS.join(', ')} FROM offers WHERE id = $1 LIMIT 1`,
    [offerId],
  );
  return res.rowCount ? res.rows[0] : null;
}

async function resolveClick({ clickId, offerId, tgId }) {
  if (clickId) {
    const clickRes = await query(
      `SELECT id, click_id, uid FROM clicks WHERE id = $1 OR click_id = $1 LIMIT 1`,
      [clickId],
    );
    if (clickRes.rowCount) {
      const row = clickRes.rows[0];
      return { id: row.id ?? row.click_id, click_id: row.click_id ?? row.id, uid: row.uid ?? null };
    }
  }

  if (!offerId || !tgId) {
    return null;
  }

  const attrRes = await query(
    `SELECT click_id, uid
       FROM attribution
      WHERE offer_id = $1 AND tg_id = $2
      ORDER BY last_seen DESC
      LIMIT 1`,
    [offerId, tgId],
  );

  if (!attrRes.rowCount) {
    return null;
  }

  const row = attrRes.rows[0];
  const clickUuid = row.click_id ?? null;
  if (!clickUuid) {
    return { id: null, click_id: null, uid: row.uid ?? null };
  }

  const clickRes = await query(
    `SELECT id, uid FROM clicks WHERE id = $1 LIMIT 1`,
    [clickUuid],
  );

  if (clickRes.rowCount) {
    const click = clickRes.rows[0];
    return { id: click.id, click_id: click.id, uid: click.uid ?? row.uid ?? null };
  }

  return { id: clickUuid, click_id: clickUuid, uid: row.uid ?? null };
}

async function resolveEvent({ eventId, eventType, tgId }) {
  if (eventId) {
    const res = await query(
      `SELECT id, event_type, tg_id, created_at
         FROM events
        WHERE id = $1
        LIMIT 1`,
      [eventId],
    );

    if (res.rowCount) {
      return res.rows[0];
    }
  }

  return {
    id: eventId ?? null,
    event_type: eventType,
    tg_id: tgId,
    created_at: new Date(),
  };
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
  dryRun = false,
} = {}) {
  const offerId = offer_id ?? null;
  const tgId = tg_id ?? null;
  const type = event_type || event;

  if (!offerId) {
    throw new Error('offer_id is required');
  }

  if (!tgId) {
    throw new Error('tg_id is required');
  }

  if (!type) {
    throw new Error('event_type is required');
  }

  const [offer, click, eventRow] = await Promise.all([
    fetchOffer(offerId),
    resolveClick({ clickId: click_id ?? null, offerId, tgId }),
    resolveEvent({ eventId: event_id ?? null, eventType: type, tgId }),
  ]);

  if (!offer) {
    throw new Error('offer not found');
  }

  const resolvedEvent = {
    ...eventRow,
    event_type: eventRow?.event_type || type,
    tg_id: eventRow?.tg_id ?? tgId,
  };

  if (uid && !click?.uid) {
    resolvedEvent.uid = uid;
  }

  if (payout_cents != null) {
    resolvedEvent.payout_cents = payout_cents;
  }

  if (dryRun) {
    return {
      dryRun: true,
      skipped: true,
      status: null,
      http_status: null,
    };
  }

  const result = await sendPostbackForEvent({
    offer,
    click: click ?? (uid ? { id: null, click_id: null, uid } : null),
    event: resolvedEvent,
  });

  return {
    ...result,
    http_status: result?.status ?? null,
    dryRun: false,
    dedup: false,
  };
}

export { sendPostbackForEvent };
