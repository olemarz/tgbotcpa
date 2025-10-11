import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import { query } from '../db/index.js';
import { sendPostback } from '../services/postback.js';
import { webhookCallback } from '../bot/telegraf.js';
import { handleClick } from './click.js';

const UUID_REGEXP = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUUID = (value) => UUID_REGEXP.test(value);

const requireDebug = (req, res, next) => {
  if (!process.env.DEBUG_TOKEN || req.headers['x-debug-token'] !== process.env.DEBUG_TOKEN) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  return next();
};

export function createApp() {
  const app = express();

  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  const webhookPath = process.env.WEBHOOK_PATH || '/bot/webhook';
  app.post(
    webhookPath,
    (req, res, next) => {
      const got = req.headers['x-telegram-bot-api-secret-token'];
      const need = process.env.WEBHOOK_SECRET || 'prod-secret';
      if (need && got && got !== need) {
        console.warn('[tg] bad webhook secret token');
        return res.sendStatus(401);
      }
      return webhookCallback(req, res, next);
    },
    (_req, res) => res.sendStatus(200),
  );

  app.get('/debug/ping', requireDebug, (_req, res) => res.json({ ok: true }));

  app.get('/click/:offerId', handleClick);

  app.post('/debug/complete', requireDebug, async (req, res) => {
    const {
      offer_id: offerIdRaw,
      tg_id: tgIdRaw,
      uid: uidRaw,
      click_id: clickIdRaw,
      event: eventRaw,
      payout_cents: payoutCents,
    } = req.body || {};

    const offer_id = offerIdRaw ? String(offerIdRaw) : '';
    const tg_id = tgIdRaw ? Number.parseInt(String(tgIdRaw), 10) : NaN;
    const uid = uidRaw ? String(uidRaw) : undefined;
    const click_id = clickIdRaw ? String(clickIdRaw) : undefined;
    const event = eventRaw ? String(eventRaw) : '';
    const payout_cents = payoutCents !== undefined ? Number.parseInt(String(payoutCents), 10) : undefined;
    const normalizedPayout = Number.isNaN(payout_cents) ? undefined : payout_cents;

    if (!isUUID(offer_id)) {
      return res.status(400).json({ ok: false, error: 'offer_id must be UUID' });
    }

    if (!event) {
      return res.status(400).json({ ok: false, error: 'event is required' });
    }

    if (Number.isNaN(tg_id)) {
      return res.status(400).json({ ok: false, error: 'tg_id must be numeric' });
    }

    try {
      const result = await sendPostback({ offer_id, tg_id, uid, click_id, event, payout_cents: normalizedPayout });
      const httpStatus = result.http_status ?? result.status ?? null;
      return res.json({
        ok: true,
        status: httpStatus,
        http_status: httpStatus,
        signature: result.signature,
        dedup: !!result.dedup,
        dryRun: !!result.dryRun,
      });
    } catch (error) {
      console.error('debug/complete error', error);
      return res.status(502).json({ ok: false, error: error?.message || 'postback failed' });
    }
  });

  app.get('/debug/last', requireDebug, async (req, res) => {
    const tgIdRaw = req.query?.tg_id;
    const tgId = tgIdRaw ? Number.parseInt(String(tgIdRaw), 10) : NaN;
    if (Number.isNaN(tgId)) {
      return res.status(400).json({ ok: false, error: 'tg_id must be numeric' });
    }

    const limit = 5;
    const [clicks, attributions, events, postbacks] = await Promise.all([
      query('SELECT * FROM clicks WHERE tg_id = $1 ORDER BY created_at DESC LIMIT $2', [tgId, limit]),
      query('SELECT * FROM attribution WHERE tg_id = $1 ORDER BY created_at DESC LIMIT $2', [tgId, limit]),
      query('SELECT * FROM events WHERE tg_id = $1 ORDER BY created_at DESC LIMIT $2', [tgId, limit]),
      query('SELECT * FROM postbacks WHERE tg_id = $1 ORDER BY created_at DESC LIMIT $2', [tgId, limit]),
    ]);

    return res.json({
      ok: true,
      data: {
        clicks: clicks.rows,
        attribution: attributions.rows,
        events: events.rows,
        postbacks: postbacks.rows,
      },
    });
  });

  return app;
}
