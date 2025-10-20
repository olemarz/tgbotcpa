import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db/index.js';
import { sendPostback } from '../services/postback.js';
import { parseGeoInput } from '../util/geo.js';
import { uuid } from '../util/id.js';
import { handleClick } from './click.js';
import { waRouter } from './wa.js';
import { cpaRouter } from './cpa.js';

const UUID_REGEXP = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUUID = (value) => UUID_REGEXP.test(value);

const requireDebug = (req, res, next) => {
  if (!process.env.DEBUG_TOKEN || req.headers['x-debug-token'] !== process.env.DEBUG_TOKEN) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  return next();
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(express.static(publicDir));
  app.use('/api/wa', waRouter);
  app.use('/api/cpa', cpaRouter);
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.get('/debug/ping', requireDebug, (_req, res) => res.json({ ok: true }));

  app.get('/click/:offerId', handleClick);

  app.post('/offers', async (req, res) => {
    const {
      target_url: targetUrlRaw,
      event_type: eventTypeRaw,
      geo_input: geoInputRaw,
      name,
      base_rate: baseRate,
      premium_rate: premiumRate,
      caps_total: capsTotal,
    } = req.body || {};

    const target_url = typeof targetUrlRaw === 'string' ? targetUrlRaw.trim() : '';
    const event_type = typeof eventTypeRaw === 'string' ? eventTypeRaw.trim() : '';
    const geo_input = typeof geoInputRaw === 'string' ? geoInputRaw.trim() : undefined;
    const normalizedBaseRate =
      baseRate !== undefined && baseRate !== null ? Number.parseInt(String(baseRate), 10) : undefined;
    const normalizedPremiumRate =
      premiumRate !== undefined && premiumRate !== null ? Number.parseInt(String(premiumRate), 10) : undefined;
    const normalizedCapsTotal =
      capsTotal !== undefined && capsTotal !== null ? Number.parseInt(String(capsTotal), 10) : undefined;

    if (!target_url) {
      return res.status(400).json({ ok: false, error: 'target_url is required' });
    }

    if (!event_type) {
      return res.status(400).json({ ok: false, error: 'event_type is required' });
    }

    let geoList = [];
    if (geo_input) {
      const { ok: geoOk, codes = [], invalid = [] } = parseGeoInput(geo_input);
      if (!geoOk) {
        return res.status(400).json({
          ok: false,
          error: `Unknown GEO codes: ${invalid.join(', ')}`,
          invalid_geo_codes: invalid,
        });
      }
      geoList = Array.isArray(codes) ? codes : [];
    }
    const offerId = uuid();

    const columns = ['id', 'target_url', 'event_type'];
    const values = [offerId, target_url, event_type];

    if (typeof name === 'string' && name.trim()) {
      columns.push('name');
      values.push(name.trim());
    }

    if (Number.isInteger(normalizedBaseRate)) {
      columns.push('base_rate');
      values.push(normalizedBaseRate);
    }

    if (Number.isInteger(normalizedPremiumRate)) {
      columns.push('premium_rate');
      values.push(normalizedPremiumRate);
    }

    if (Number.isInteger(normalizedCapsTotal)) {
      columns.push('caps_total');
      values.push(normalizedCapsTotal);
    }

    if (geo_input !== undefined) {
      columns.push('geo_input');
      values.push(geo_input);
    }

    columns.push('geo_list');
    values.push(geoList.length > 0 ? geoList : null);

    const placeholders = columns.map((_, idx) => `$${idx + 1}`);

    try {
      await query(
        `INSERT INTO offers (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
        values,
      );
    } catch (error) {
      console.error('offer insert error', error);
      return res.status(500).json({ ok: false, error: 'failed to create offer' });
    }

    return res.status(201).json({ ok: true, offer_id: offerId, geo_list: geoList });
  });

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
      const result = await sendPostback({
        offer_id,
        tg_id,
        uid,
        click_id,
        event,
        payout_cents: normalizedPayout,
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
    const [clicks, attributions, events] = await Promise.all([
      query('SELECT * FROM clicks WHERE tg_id = $1 ORDER BY created_at DESC LIMIT $2', [tgId, limit]),
      query('SELECT * FROM attribution WHERE tg_id = $1 ORDER BY last_seen DESC LIMIT $2', [tgId, limit]),
      query('SELECT * FROM events WHERE tg_id = $1 ORDER BY created_at DESC LIMIT $2', [tgId, limit]),
    ]);

    let postbacks = { rows: [] };
    if (events.rowCount) {
      const eventIds = events.rows.map((row) => row.id);
      postbacks = await query(
        'SELECT * FROM postbacks WHERE event_id = ANY($1::uuid[]) ORDER BY created_at DESC',
        [eventIds],
      );
    }

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
