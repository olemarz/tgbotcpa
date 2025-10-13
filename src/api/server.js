/* eslint-disable no-console */
import 'dotenv/config';
import express from 'express';
import { webhookCallback, bot } from '../bot/telegraf.js';

void bot; // ensure bot is initialized for webhook processing

export async function createApp() {
  const app = express();

  // 1) health
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // 2) Точный маршрут вебхука (должен совпадать с WEBHOOK_PATH из .env)
  const WEBHOOK_PATH = (process.env.WEBHOOK_PATH || '/bot/webhook').trim();

  // 3) Логи входящих апдейтов (диагностика 404)
  app.post(
    WEBHOOK_PATH,
    express.json(),
    (req, res, next) => {
      console.log('[WEBHOOK] hit', WEBHOOK_PATH, 'update_id=', req.body?.update_id);
      next();
    },

    // 4) Telegraf webhook с секретом (если задан)
    webhookCallback, // уже создан в telegraf.js: bot.webhookCallback(WEBHOOK_PATH, { secretToken: ... })
  );

  // 5) 404
  app.use((_req, res) => res.status(404).json({ ok: false, error: 'not found' }));

  return app;
}

let server;
export async function startServer() {
  const app = await createApp();
  const PORT = Number(process.env.PORT || 8000);
  if (server?.listening) return server;

  server = app.listen(PORT, () => console.log('[HTTP] listening on', PORT));
  server.on('error', (err) => {
    if (err?.code === 'EADDRINUSE') {
      console.error('[HTTP] PORT in use:', PORT, '→ skip listen (Nginx proxy ok)');
      return;
    }
    throw err;
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((e) => { console.error('[HTTP] start error:', e); process.exit(1); });
}
