/* eslint-disable no-console */
import 'dotenv/config';
import express from 'express';
import { bot } from '../bot/telegraf.js';

export async function createApp() {
  const app = express();

  // Health-check
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Путь вебхука
  const WEBHOOK_PATH = (process.env.WEBHOOK_PATH || '/bot/webhook').trim();

  // JSON body parser
  app.use(express.json());

  // Вебхук: прокидываем апдейты в бот
  app.post(WEBHOOK_PATH, async (req, res) => {
    const updateId = req.body?.update_id;
    console.log('[WEBHOOK] hit', WEBHOOK_PATH, 'update_id =', updateId);

    try {
      await bot.handleUpdate(req.body);
      res.status(200).end();
    } catch (err) {
      console.error('[WEBHOOK] handleUpdate error:', err);
      res.status(500).end();
    }
  });

  // 404 на прочие маршруты
  app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

  return app;
}

let server;

export async function startServer() {
  if (server?.listening) return server;

  const app = await createApp();
  const PORT = Number(process.env.PORT || 8000);
  const HOST = process.env.HOST || '0.0.0.0';

  console.log('[HTTP] start requested');

  server = app.listen(PORT, HOST, () => {
    console.log(`[HTTP] listening on ${HOST}:${PORT}`);
  });

  server.on('error', (err) => {
    if (err?.code === 'EADDRINUSE') {
      console.error('[HTTP] PORT in use:', PORT, '→ skip listen (proxy ok)');
      return;
    }
    console.error('[HTTP] server error:', err);
    process.exit(1);
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((e) => {
    console.error('[HTTP] start error:', e);
    process.exit(1);
  });
}
