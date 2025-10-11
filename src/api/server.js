import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import { bot, webhookCallback } from '../bot/telegraf.js';

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const webhookPath = process.env.WEBHOOK_PATH || '/bot/webhook';

// единственный webhook endpoint
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

// health
app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/debug/ping', (req, res) => {
  const token = process.env.DEBUG_TOKEN;
  if (!token || req.headers['x-debug-token'] !== token) {
    return res.sendStatus(401);
  }
  return res.json({ ok: true });
});

const port = Number(process.env.PORT || 3000);
const baseUrl = process.env.BASE_URL || 'undefined';

console.log('[api] config', { port, webhookPath, baseUrl });

app.listen(port, () => console.log(`[api] listening on :${port}`));

export default app;
