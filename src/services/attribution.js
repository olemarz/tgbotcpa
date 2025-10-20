import { query } from '../db/index.js';

function normalizeClickId(clickId) {
  if (clickId === undefined || clickId === null) {
    return null;
  }
  return clickId;
}

function normalizeUid(uid) {
  if (uid === undefined) {
    return null;
  }
  return uid;
}

async function updateAttributionRow({ id, eventId, clickId, uid }) {
  const normalizedClickId = normalizeClickId(clickId);
  const normalizedUid = normalizeUid(uid);
  const isMissingEventId = (error) => {
    const message = error?.message || '';
    return error?.code === '42703' || message.includes('column "event_id"');
  };

  try {
    const result = await query(
      `UPDATE attribution
         SET state = 'converted',
             event_id = $1,
             click_id = COALESCE(click_id, $2),
             uid = COALESCE($3, uid)
       WHERE id = $4
       RETURNING click_id, uid`,
      [eventId ?? null, normalizedClickId, normalizedUid, id],
    );
    if (result.rowCount) {
      return result.rows[0];
    }
  } catch (error) {
    if (!isMissingEventId(error)) {
      throw error;
    }
  }

  const fallback = await query(
    `UPDATE attribution
       SET state = 'converted',
           click_id = COALESCE(click_id, $1),
           uid = COALESCE($2, uid)
     WHERE id = $3
     RETURNING click_id, uid`,
    [normalizedClickId, normalizeUid(uid), id],
  );

  return fallback.rowCount ? fallback.rows[0] : null;
}

async function tryUpdateByClickId({ eventId, clickId, uid }) {
  if (!clickId) {
    return null;
  }

  const existing = await query(
    `SELECT id, click_id, uid
       FROM attribution
      WHERE click_id = $1
      LIMIT 1`,
    [clickId],
  );

  if (!existing.rowCount) {
    return null;
  }

  const row = existing.rows[0];
  return updateAttributionRow({ id: row.id, eventId, clickId, uid: uid ?? row.uid });
}

async function tryUpdateByOffer({ eventId, offerId, tgId, clickId, uid }) {
  const existing = await query(
    `SELECT id, click_id, uid
       FROM attribution
      WHERE offer_id = $1 AND tg_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [offerId, tgId],
  );

  if (!existing.rowCount) {
    return null;
  }

  const row = existing.rows[0];
  const effectiveClickId = clickId ?? row.click_id ?? null;
  const effectiveUid = uid ?? row.uid ?? null;

  return updateAttributionRow({ id: row.id, eventId, clickId: effectiveClickId, uid: effectiveUid });
}

async function insertAttribution({ eventId, offerId, tgId, clickId, uid }) {
  const normalizedClickId = normalizeClickId(clickId);
  const normalizedUid = normalizeUid(uid);
  const isMissingEventId = (error) => {
    const message = error?.message || '';
    return error?.code === '42703' || message.includes('column "event_id"');
  };

  try {
    const inserted = await query(
      `INSERT INTO attribution (click_id, offer_id, uid, tg_id, state, event_id)
       VALUES ($1, $2, $3, $4, 'converted', $5)
       RETURNING click_id, uid`,
      [normalizedClickId, offerId, normalizedUid, tgId, eventId ?? null],
    );
    return inserted.rowCount ? inserted.rows[0] : null;
  } catch (error) {
    if (!isMissingEventId(error)) {
      throw error;
    }
  }

  const inserted = await query(
    `INSERT INTO attribution (click_id, offer_id, uid, tg_id, state)
     VALUES ($1, $2, $3, $4, 'converted')
     RETURNING click_id, uid`,
    [normalizedClickId, offerId, normalizedUid, tgId],
  );

  return inserted.rowCount ? inserted.rows[0] : null;
}

export async function attachEvent({ eventId, offerId, tgId, clickId, uid }) {
  const byClick = await tryUpdateByClickId({ eventId, clickId, uid });
  if (byClick) {
    return { click_id: byClick.click_id ?? normalizeClickId(clickId), uid: byClick.uid ?? normalizeUid(uid) };
  }

  const byOffer = await tryUpdateByOffer({ eventId, offerId, tgId, clickId, uid });
  if (byOffer) {
    return { click_id: byOffer.click_id ?? normalizeClickId(clickId), uid: byOffer.uid ?? normalizeUid(uid) };
  }

  const inserted = await insertAttribution({ eventId, offerId, tgId, clickId, uid });
  if (inserted) {
    return { click_id: inserted.click_id ?? normalizeClickId(clickId), uid: inserted.uid ?? normalizeUid(uid) };
  }

  return { click_id: normalizeClickId(clickId), uid: normalizeUid(uid) };
}

