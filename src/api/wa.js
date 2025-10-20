import express from 'express';
import { bot } from '../bot/telegraf.js';
import { query } from '../db/index.js';
import { sendPostback } from '../services/postback.js';
import { verifyInitData } from '../utils/tgInitData.js';

const JOIN_GROUP_EVENT = 'join_group';

function requireDebug(req, res, next) {
  if (!process.env.DEBUG_TOKEN || req.headers['x-debug-token'] !== process.env.DEBUG_TOKEN) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  return next();
}

export const waRouter = express.Router();

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

waRouter.post('/claim', async (req, res) => {
  const body = req.body ?? {};
  const token = toTrimmedString(body.token);
  const initData = toTrimmedString(body.initData);

  if (!token) {
    return res.status(400).json({ ok: false, error: 'TOKEN_REQUIRED' });
  }

  if (!initData) {
    return res.status(400).json({ ok: false, error: 'INIT_DATA_REQUIRED' });
  }

  const verification = verifyInitData(initData);
  if (!verification.ok || !verification.user?.id) {
    return res.status(401).json({ ok: false, error: verification.error ?? 'INIT_DATA_INVALID' });
  }

  const startParam = verification.start_param;
  if (startParam && startParam !== token) {
    return res.status(400).json({ ok: false, error: 'TOKEN_MISMATCH' });
  }

  const tgId = verification.user.id;

  try {
    const result = await query(
      'UPDATE clicks SET tg_id = $1, used_at = COALESCE(used_at, now()) WHERE start_token = $2',
      [tgId, token],
    );

    if (result.rowCount > 0) {
      try {
        await bot.telegram.sendMessage(tgId, 'Новая задача доступна: /ads');
      } catch (notifyError) {
        console.error('[wa.claim] notify error', notifyError);
      }

      return res.json({ ok: true });
    }

    return res.status(404).json({ ok: false, error: 'TOKEN_NOT_FOUND' });
  } catch (error) {
    console.error('[wa.claim] update error', error);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

waRouter.post('/debug/complete', requireDebug, async (req, res) => {
  const token = toTrimmedString(req.body?.token);
  const eventType = toTrimmedString(req.body?.event_type || req.body?.event);

  if (!token) {
    return res.status(400).json({ ok: false, error: 'TOKEN_REQUIRED' });
  }

  if (!eventType) {
    return res.status(400).json({ ok: false, error: 'EVENT_REQUIRED' });
  }

  if (eventType !== JOIN_GROUP_EVENT) {
    return res.status(400).json({ ok: false, error: 'UNSUPPORTED_EVENT' });
  }

  try {
    const clickResult = await query(
      `
        SELECT c.id AS click_uuid,
               c.offer_id,
               c.tg_id,
               c.uid,
               c.click_id AS external_click_id,
               o.event_type
          FROM clicks c
          JOIN offers o ON o.id = c.offer_id
         WHERE c.start_token = $1
         LIMIT 1
      `,
      [token],
    );

    if (!clickResult.rowCount) {
      return res.status(404).json({ ok: false, error: 'TOKEN_NOT_FOUND' });
    }

    const {
      click_uuid: clickUuid,
      offer_id: offerId,
      tg_id: tgId,
      uid,
      event_type: offerEvent,
      external_click_id: externalClickId,
    } = clickResult.rows[0];

    if (!tgId) {
      return res.status(409).json({ ok: false, error: 'TG_ID_MISSING' });
    }

    const numericTgId = Number.parseInt(String(tgId), 10);
    if (Number.isNaN(numericTgId)) {
      return res.status(409).json({ ok: false, error: 'TG_ID_INVALID' });
    }

    if (offerEvent && offerEvent !== eventType) {
      console.warn('[wa.debugComplete] event mismatch', { token, offer_event: offerEvent, event_type: eventType });
    }

    const existingEvent = await query(
      `SELECT id FROM events WHERE offer_id = $1 AND tg_id = $2 AND event_type = $3 LIMIT 1`,
      [offerId, numericTgId, eventType],
    );

    let eventId = existingEvent.rows[0]?.id || null;

    if (!eventId) {
      const inserted = await query(
        `INSERT INTO events (offer_id, tg_id, event_type) VALUES ($1, $2, $3) RETURNING id`,
        [offerId, numericTgId, eventType],
      );
      eventId = inserted.rows[0]?.id || null;
    }

    console.log('[EVENT] saved', { event_id: eventId, event_type: eventType, offer_id: offerId, tg_id: numericTgId });

    const attribution = await query(`SELECT click_id FROM attribution WHERE click_id = $1 LIMIT 1`, [clickUuid]);

    if (attribution.rowCount) {
      await query(`UPDATE attribution SET state = 'converted' WHERE click_id = $1`, [attribution.rows[0].click_id]);
    } else {
      await query(
        `INSERT INTO attribution (click_id, offer_id, uid, tg_id, state) VALUES ($1, $2, $3, $4, 'converted')`,
        [clickUuid, offerId, uid ?? null, numericTgId],
      );
    }

    if (!eventId) {
      console.error('[wa.debugComplete] missing event_id', { token, offerId, tgId: numericTgId });
      return res.status(500).json({ ok: false, error: 'EVENT_ID_MISSING' });
    }

    try {
      const result = await sendPostback({
        offer_id: offerId,
        event_id: eventId,
        event_type: eventType,
        tg_id: numericTgId,
        uid: uid ?? undefined,
        click_id: externalClickId ?? undefined,
      });

      const httpStatus = result.http_status ?? result.status ?? null;

      return res.json({
        ok: true,
        status: httpStatus,
        http_status: httpStatus,
        signature: result.signature,
        dedup: !!result.dedup,
        dryRun: !!result.dryRun,
      });
    } catch (postbackError) {
      console.error('[wa.debugComplete] postback error', postbackError);
      return res.status(502).json({ ok: false, error: postbackError?.message || 'POSTBACK_FAILED' });
    }
  } catch (error) {
    console.error('[wa.debugComplete] handler error', error);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

export default waRouter;
