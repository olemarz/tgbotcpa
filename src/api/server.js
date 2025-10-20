import { setDefaultResultOrder } from 'node:dns';
import 'dotenv/config';
import express from 'express';
import config from '../config.js';
import { bot } from '../bot/telegraf.js';
import { query } from '../db/index.js';
import { adjustPayoutCents } from '../util/pricing.js';

try {
  setDefaultResultOrder('ipv4first');
} catch {}

function isAdmin(req) {
  const t = (req.query.admin_token || req.get('X-Admin-Token') || '').trim();
  return t && t === (process.env.ADMIN_TOKEN || '').trim();
}

const app = express();
import debugRouter from './debug.js';
app.use(express.json());
app.use(debugRouter);
const PORT = Number(process.env.PORT || 8000);
const RAW = process.env.WEBHOOK_PATH || '/bot/webhook';
const WEBHOOK_PATH = RAW.replace(/\/+$/, ''); // без завершающего '/'
const WEBHOOK_SECRET = (process.env.WEBHOOK_SECRET || '').trim();

// JSON только как application/json (защищает от мусорных тел)
app.use(express.json({ limit: '1mb', type: ['application/json', 'application/json; charset=utf-8'] }));

// health и корневой ping
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) => res.json({ ok: true, service: 'tgbotcpa' }));

// Защита вебхука: только POST + (опционально) проверка секрета
app.use(WEBHOOK_PATH, (req, res, next) => {
  if (req.method !== 'POST') return res.status(405).end(); // Method Not Allowed
  if (WEBHOOK_SECRET) {
    const got = req.get('X-Telegram-Bot-Api-Secret-Token') || '';
    if (got !== WEBHOOK_SECRET) {
      console.warn('[WEBHOOK] wrong secret token');
      return res.status(403).end(); // Forbidden
    }
  }
  return next();
});

// Сам обработчик вебхука
app.post(WEBHOOK_PATH, async (req, res) => {
  console.log('[WEBHOOK] hit', WEBHOOK_PATH, 'update_id =', req.body?.update_id);
  try {
    await bot.handleUpdate(req.body);
    res.status(200).end();
  } catch (e) {
    console.error('[WEBHOOK] handleUpdate error:', e);
    res.status(500).end();
  }
});

// GET /api/offers (admin)
app.get('/api/offers', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false });
  const r = await query(`
    SELECT id, title, status, budget_cents, paid_cents, payout_cents, created_by_tg_id, target_url, event_type, geo
      FROM offers
     ORDER BY created_at DESC
     LIMIT 200
  `);
  res.json({ ok: true, items: r.rows });
});

// POST /api/offers — создание (используется мастером в боте)
app.post('/api/offers', async (req, res) => {
  const { title, target_url, event_type = 'join_group', payout_cents = 0, budget_cents = 0, geo = null, created_by_tg_id } = req.body || {};
  if (!title || !target_url || !created_by_tg_id) return res.status(400).json({ ok: false, error: 'missing fields' });

  const adjusted = adjustPayoutCents(payout_cents, geo);
  const r = await query(
    `INSERT INTO offers (id, title, target_url, event_type, payout_cents, budget_cents, geo, created_by_tg_id, status)
     VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,'draft')
     RETURNING *`,
    [title, target_url, event_type, adjusted, budget_cents, geo, created_by_tg_id],
  );
  res.json({ ok: true, offer: r.rows[0] });
});

// Fallback "fake pay" /api/pay/:id (оставляем на случай отладки)
app.post('/api/pay/:id', express.urlencoded({extended:true}), async (req, res) => {
  const { id } = req.params;
  const amount_cents = Number(req.body?.amount_cents || 0);
  if (!Number.isFinite(amount_cents) || amount_cents <= 0) return res.status(400).json({ ok: false, error: 'bad amount' });
  const r = await query(
    `UPDATE offers
        SET paid_cents = COALESCE(paid_cents,0) + $2,
            status = CASE WHEN COALESCE(paid_cents,0)+$2 >= budget_cents THEN 'active' ELSE status END
      WHERE id=$1
  RETURNING id,status,paid_cents,budget_cents`, [id, amount_cents]);
  if (!r.rowCount) return res.status(404).json({ ok: false, error: 'offer not found' });
  res.json({ ok: true, offer: r.rows[0] });
});

const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
app.listen(PORT, BIND_HOST, () => {
  console.log(`[HTTP] listening on ${BIND_HOST}:${PORT}`);
  console.log(`[HTTP] webhook route => POST ${WEBHOOK_PATH}`);
});
export default app;
