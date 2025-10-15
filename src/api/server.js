import 'dotenv/config';
import express from 'express';
import { bot } from '../bot/telegraf.js';

const app = express();
const PORT = Number(process.env.PORT || 8000);
const RAW = process.env.WEBHOOK_PATH || '/bot/webhook';
const WEBHOOK_PATH = RAW.replace(/\/+$/, ''); // без завершающего '/'

app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[HTTP] listening on 0.0.0.0:${PORT}`);
  console.log(`[HTTP] webhook route => POST ${WEBHOOK_PATH}`);
});
