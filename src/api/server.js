import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { uuid, shortToken } from '../util/id.js';
import { hmacSHA256Hex } from '../util/hmac.js';
import axios from 'axios';
import { bot, webhookCallback } from '../bot/telegraf.js';

// simple UUID validator
const isUUID = s =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

const app = express();
app.use(bodyParser.json());
const requireDebug = (req, res, next) => {
  if (req.headers['x-debug-token'] !== process.env.DEBUG_TOKEN)
    return res.status(401).json({ ok:false, error:'unauthorized' });
  next();
};
app.use(bodyParser.urlencoded({extended: true}));

// POST /debug/seed_offer  (только для тестов)
app.post('/debug/seed_offer', requireDebug, async (req, res) => {
  try {
    const { target_url, event_type, name, slug, base_rate, premium_rate } = req.body || {};
    const sql = `
      INSERT INTO offers (id, advertiser_id, target_url, event_type, name, slug, base_rate, premium_rate, status)
      VALUES (gen_random_uuid(), gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'active')
      RETURNING id
    `;
    const r = await query(sql, [target_url, event_type, name, slug, base_rate, premium_rate]);
    return res.json({ ok: true, offer_id: r.rows[0].id });
  } catch (e) {
    console.error('seed_offer error:', e);
    return res.status(500).json({ ok:false, error: e.message });
  }
});


async function sendCpaPostback(payload) {
  const url = config.cpaPostbackUrl; // из .env: CPA_POSTBACK_URL
  const headers = { 'content-type': 'application/json' };
  const body = JSON.stringify(payload);

  // подпись (если указан CPA_PB_SECRET)
  if (config.cpaSecret) {
    const sig = crypto.createHmac('sha256', config.cpaSecret).update(body).digest('hex');
    headers['x-signature'] = sig;
  }

  try {
    return await axios.post(url, payload, { timeout: 5000, headers });
  } catch (error) {
    const { offer_id, uid, event } = payload || {};
    const status = error?.response?.status;
    console.error('sendCpaPostback error', { offer_id, uid, event, status, message: error?.message });
    throw error;
  }
}

// POST /debug/complete { offer_id, uid, status? }
app.post('/debug/complete', requireDebug, async (req, res) => {
  try {
    const {
      offer_id: offerIdRaw,
      uid: uidRaw,
      status = 'approved'
    } = req.body || {};

    const offer_id = (offerIdRaw ?? '').toString().trim();
    const uid = (uidRaw ?? '').toString().trim();
    if (!offer_id || !uid) {
      return res.status(400).json({ ok: false, error: 'offer_id and uid are required' });
    }

    await sendCpaPostback({ offer_id, uid, status });
    return res.json({ ok: true });
  } catch (e) {
    console.error('debug/complete error', {
      status: e?.response?.status,
      message: e?.message
    });
    return res.status(500).json({ ok: false, error: e.message });
  }
});
// Health
app.get('/health', (req,res)=>res.json({ok:true}));

// Webhook for Telegram
app.post('/bot/webhook', webhookCallback);

// Click endpoint -> save click, create start token, redirect to bot
app.get('/click/:offerId', async (req, res) => {
  const offerId = req.params.offerId;
// вернуть 400, если передали не UUID (например /click/123)
  if (!isUUID(offerId)) {
    return res.status(400).send('offer_id must be UUID');
  }
  const uid = (req.query.sub || req.query.uid || req.query.click_id || '').toString();
  const subs = { ...req.query };
  if (!uid) return res.status(400).send('Missing click_id/sub');

  const tkn = shortToken();
  const exp = new Date(Date.now() + 1000*60*30); // 30 min TTL

  await query('INSERT INTO clicks(id, offer_id, uid, subs) VALUES($1,$2,$3,$4)',
    [uuid(), offerId, uid, subs]);
  await query('INSERT INTO start_tokens(token, offer_id, uid, exp_at) VALUES($1,$2,$3,$4) ON CONFLICT (token) DO NOTHING',
    [tkn, offerId, uid, exp]);

  const url = `https://t.me/${(await bot.telegram.getMe()).username}?start=${tkn}`;
  res.redirect(302, url);
});

// Share-click endpoint
app.get('/s/:shareToken', async (req, res) => {
  // Simplified: first unique visit wins within TTL (not fully implemented)
  // Redirect target is optional via query ?to=
  const to = (req.query.to || 'https://t.me').toString();
  // TODO: record unique by token+ip within TTL
  res.redirect(302, to);
});

// External relay (for advertiser bots) -> expect user_id + offer_id + event
app.post('/postbacks/relay', async (req, res) => {
  const offer_id_raw = req.body?.offer_id;
  const user_id_raw = req.body?.user_id;
  const event_raw = req.body?.event;
  const meta = req.body?.meta;

  const offer_id = (offer_id_raw ?? '').toString().trim();
  const user_id = (user_id_raw ?? '').toString().trim();
  const event = (event_raw ?? '').toString().trim();

  if (!offer_id || !user_id || !event) {
    return res.status(400).json({ ok:false, error:'missing fields' });
  }

  const attr = await query('SELECT uid FROM attribution WHERE offer_id=$1 AND user_id=$2', [offer_id, user_id]);
  if (!attr.rowCount) return res.status(404).json({ok:false, error:'no attribution'});
  const uid = attr.rows[0].uid;

  const ts = Math.floor(Date.now()/1000);
  const payload = { click_id: uid, offer_id, event, ts };
  const sig = hmacSHA256Hex(config.cpaSecret, `${uid}|${offer_id}|${event}|${ts}`);

  try {
    await axios.post(config.cpaPostbackUrl, { ...payload, sig, status:1 });
    res.json({ok:true});
  } catch (e) {
    console.error('postbacks/relay error', {
      offer_id,
      uid,
      event,
      status: e?.response?.status,
      message: e?.message
    });
    res.status(502).json({ok:false, error:'cpa postback failed'});
  }
});

app.listen(config.port, () => {
  console.log('API on', config.port);
});
