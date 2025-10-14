/* eslint-disable no-console */
import 'dotenv/config';
import express from 'express';

import { bot } from '../bot/telegraf.js';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  const rawWebhookPath = (process.env.WEBHOOK_PATH || '').trim();
  const webhookPath = rawWebhookPath ? (rawWebhookPath.startsWith('/') ? rawWebhookPath : `/${rawWebhookPath}`) : '/bot/webhook';

  app.post(webhookPath, async (req, res) => {
    const updateId = req.body?.update_id;
    console.log('[WEBHOOK] hit', webhookPath, 'update_id=', updateId);
    try {
      await bot.handleUpdate(req.body);
      res.status(200).end();
    } catch (error) {
      console.error('[WEBHOOK] handleUpdate error', error?.message || error);
      res.status(500).json({ ok: false });
    }
  });

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: 'not_found' });
  });

  return app;
}

let server;

export function startServer() {
  if (server?.listening) {
    return server;
  }

  const app = createApp();
  const port = Number(process.env.PORT || 8000);
  const host = (process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';

  server = app.listen(port, host, () => {
    console.log('[HTTP] listening on', `${host}:${port}`);
  });

  server.on('error', (error) => {
    if (error?.code === 'EADDRINUSE') {
      console.error('[HTTP] port in use', `${host}:${port}`);
      return;
    }
    console.error('[HTTP] server error', error);
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    startServer();
  } catch (error) {
    console.error('[HTTP] start error', error);
    process.exit(1);
  }
}
