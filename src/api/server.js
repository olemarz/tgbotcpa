import 'dotenv/config';
import express from 'express';
import { bot } from '../bot/telegraf.js';

const app = express();
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

const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
app.listen(PORT, BIND_HOST, () => {
  console.log(`[HTTP] listening on ${BIND_HOST}:${PORT}`);
  console.log(`[HTTP] webhook route => POST ${WEBHOOK_PATH}`);
});
