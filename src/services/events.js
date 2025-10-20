import { query } from '../db/index.js';
import { attachEvent } from './attribution.js';
import { sendPostback } from './postback.js';
import {
  hasSuspectAttribution,
  shouldBlockPrimaryEvent,
  shouldDebounceReaction,
} from './antifraud.js';

const ALLOWED_EVENT_TYPES = new Set([
  'join_group',
  'subscribe',
  'comment',
  'poll_vote',
  'share',
  'reaction',
  'miniapp_start',
  'external_bot_start',
]);

function ensureValidEventType(eventType) {
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    throw new Error(`Unsupported event_type: ${eventType}`);
  }
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  return payload;
}

async function findExistingEvent({ offerId, tgId, eventType }) {
  const existing = await query(
    `SELECT id
       FROM events
      WHERE offer_id = $1
        AND tg_id = $2
        AND event_type = $3
        AND created_at >= date_trunc('day', now())
      ORDER BY created_at DESC
      LIMIT 1`,
    [offerId, tgId, eventType],
  );

  if (!existing.rowCount) {
    return null;
  }

  return existing.rows[0];
}

async function insertEvent({ offerId, tgId, eventType, payload }) {
  const result = await query(
    `INSERT INTO events (offer_id, tg_id, event_type, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [offerId, tgId, eventType, payload],
  );

  return result.rows[0];
}

export async function recordEvent({
  offerId,
  tgId,
  eventType,
  payload,
  clickId,
  postbackClickId,
  uid,
  forcePostbackOnDedup = false,
}) {
  ensureValidEventType(eventType);
  const normalizedPayload = normalizePayload(payload);

  if (
    await hasSuspectAttribution({ offerId, tgId, clickId: clickId ?? null })
  ) {
    console.warn('[events] skip suspect attribution', { offerId, tgId, eventType, clickId });
    return { eventId: null, created: false, postback: null, attachment: null, blocked: { reason: 'suspect_ip' } };
  }

  if (await shouldBlockPrimaryEvent({ offerId, tgId, eventType })) {
    console.warn('[events] daily cap reached for primary event', { offerId, tgId, eventType });
    return {
      eventId: null,
      created: false,
      postback: null,
      attachment: null,
      blocked: { reason: 'primary_cap' },
    };
  }

  if (
    eventType === 'reaction' &&
    (await shouldDebounceReaction({
      offerId,
      tgId,
      messageId: normalizedPayload?.message_id ?? null,
    }))
  ) {
    console.warn('[events] reaction debounced', { offerId, tgId, message_id: normalizedPayload?.message_id });
    return {
      eventId: null,
      created: false,
      postback: null,
      attachment: null,
      blocked: { reason: 'reaction_debounce' },
    };
  }

  const existing = await findExistingEvent({ offerId, tgId, eventType });

  if (existing) {
    const attachment = await attachEvent({
      eventId: existing.id,
      offerId,
      tgId,
      clickId,
      uid,
    });

    let postbackResult = null;

    if (forcePostbackOnDedup) {
      try {
        postbackResult = await sendPostback({
          offer_id: offerId,
          tg_id: tgId,
          uid: attachment?.uid ?? uid ?? undefined,
          click_id: postbackClickId ?? attachment?.click_id ?? clickId ?? undefined,
          event: eventType,
        });
      } catch (error) {
        error.eventCreated = false;
        error.eventId = existing.id;
        error.attachment = attachment;
        throw error;
      }
    }

    return {
      eventId: existing.id,
      created: false,
      postback: postbackResult,
      attachment,
    };
  }

  const inserted = await insertEvent({ offerId, tgId, eventType, payload: normalizedPayload });

  const attachment = await attachEvent({
    eventId: inserted.id,
    offerId,
    tgId,
    clickId,
    uid,
  });

  try {
    const postbackResult = await sendPostback({
      offer_id: offerId,
      tg_id: tgId,
      uid: attachment?.uid ?? uid ?? undefined,
      click_id: postbackClickId ?? attachment?.click_id ?? clickId ?? undefined,
      event: eventType,
    });

    return {
      eventId: inserted.id,
      created: true,
      postback: postbackResult,
      attachment,
    };
  } catch (error) {
    error.eventCreated = true;
    error.eventId = inserted.id;
    error.attachment = attachment;
    throw error;
  }
}

