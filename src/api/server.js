import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
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
app.use(bodyParser.urlencoded({extended: true}));

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
  const { offer_id, user_id, event, meta } = req.body || {};
  if (!offer_id || !user_id || !event) return res.status(400).json({ok:false, error:'missing fields'});

  const attr = await query('SELECT uid FROM attribution WHERE offer_id=$1 AND user_id=$2', [offer_id, user_id]);
  if (!attr.rowCount) return res.status(404).json({ok:false, error:'no attribution'});
  const uid = attr.rows[0].uid;

  const ts = Math.floor(Date.now()/1000);
  const payload = { click_id: uid, offer_id, event, ts };
  const sig = hmacSHA256Hex(process.env.CPA_PB_SECRET, `${uid}|${offer_id}|${event}|${ts}`);

  try {
    await axios.post(process.env.CPA_POSTBACK_URL, { ...payload, sig, status:1 });
    res.json({ok:true});
  } catch (e) {
    res.status(502).json({ok:false, error:'cpa postback failed'});
  }
});

app.listen(config.port, () => {
  console.log('API on', config.port);
});
