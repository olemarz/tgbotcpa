import { Router } from 'express';
import pool from '../db/pool.js';
import { v4 as uuid } from 'uuid';
import { sendPostbackForEvent } from '../services/postback.js';
import { propagateSuspectAttributionMeta } from '../services/antifraud.js';

const router = Router();
const q = (s, p=[]) => pool.query(s, p);

// Симуляция /start <token>
router.get('/debug/sim-start', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    const tgId  = Number(req.query.tg_id || 777000);
    if (!token) return res.status(400).json({ ok:false, error:'token required' });

    const c = await q('SELECT * FROM clicks WHERE start_token=$1 LIMIT 1', [token]);
    if (!c.rowCount) return res.status(404).json({ ok:false, error:'token not found' });

    const click = c.rows[0];
    await q('UPDATE clicks SET tg_id=$1, used_at=now() WHERE id=$2', [tgId, click.id]);

    await q(`
      INSERT INTO attribution (user_id, offer_id, uid, tg_id, click_id, state)
      VALUES ($1,$2,$3,$4,$5,'started')
      ON CONFLICT (user_id, offer_id)
      DO UPDATE SET
        uid = COALESCE(EXCLUDED.uid, attribution.uid),
        tg_id = COALESCE(EXCLUDED.tg_id, attribution.tg_id),
        click_id = COALESCE(EXCLUDED.click_id, attribution.click_id),
        state='started',
        last_seen = now()
    `, [tgId, click.offer_id, click.uid || null, tgId, click.id]);

    await propagateSuspectAttributionMeta({ clickId: click.id, offerId: click.offer_id, tgId });

    res.json({ ok:true, offer_id: click.offer_id, tg_id: tgId, click_id: click.id });
  } catch (e) {
    console.error('[DEBUG sim-start]', e);
    res.status(500).json({ ok:false, error:String(e) });
  }
});

// Симуляция события + постбек
router.post('/debug/event', async (req, res) => {
  try {
    const offerId  = String(req.body.offer_id || req.query.offer_id || '').trim();
    const tgId     = Number(req.body.tg_id || req.query.tg_id || 777000);
    const ev       = String(req.body.type || req.query.type || 'test');
    const payload  = req.body.payload || {};

    if (!offerId) return res.status(400).json({ ok:false, error:'offer_id required' });

    const evId = uuid();
    await q(
      `INSERT INTO events(id, offer_id, user_id, uid, tg_id, event_type, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [evId, offerId, tgId, null, tgId, ev, payload]
    );

    const attr = await q(
      `SELECT click_id, uid FROM attribution WHERE user_id=$1 AND offer_id=$2`,
      [tgId, offerId]
    );
    const click = attr.rowCount ? { id: attr.rows[0].click_id, click_id: attr.rows[0].click_id, uid: attr.rows[0].uid } : null;

    try {
      await sendPostbackForEvent({
        offer: {
          id: offerId,
          postback_url: process.env.POSTBACK_URL || null,
          postback_secret: process.env.POSTBACK_SECRET || null,
          postback_method: process.env.POSTBACK_METHOD || null,
          postback_timeout_ms: process.env.POSTBACK_TIMEOUT_MS || null,
          postback_retries: process.env.POSTBACK_RETRIES || null,
        },
        click,
        event: { id: evId, event_type: ev, tg_id: tgId, created_at: new Date() },
      });
    } catch (e) {
      console.warn('[DEBUG event] postback failed', e.message || e);
    }

    await q(
      `UPDATE attribution SET state='converted', last_seen=now()
       WHERE user_id=$1 AND offer_id=$2`,
      [tgId, offerId]
    );

    res.json({ ok:true, event_id: evId });
  } catch (e) {
    console.error('[DEBUG event]', e);
    res.status(500).json({ ok:false, error:String(e) });
  }
});

export default router;
