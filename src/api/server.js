import 'dotenv/config';
import express from 'express';
import { bot } from '../bot/telegraf.js';
import { COMMIT, BRANCH, BUILT_AT } from '../version.js';
import { createApp as createCoreApp } from './app.js';

const WEBHOOK_PATH_DEFAULT = '/bot/webhook';
const WEBHOOK_SECRET_DEFAULT = 'prod-secret';

export async function createApp() {
  const app = createCoreApp();

  const webhookPath = (process.env.WEBHOOK_PATH || WEBHOOK_PATH_DEFAULT).trim() || WEBHOOK_PATH_DEFAULT;
  const webhookSecret = (process.env.WEBHOOK_SECRET || WEBHOOK_SECRET_DEFAULT).trim() || WEBHOOK_SECRET_DEFAULT;

  app.post(webhookPath, express.json(), (req, _res, next) => {
    console.log('[WEBHOOK] update_id=', req.body?.update_id, 'appVer=', process.env.APP_VERSION);
    next();
  });

  app.use(webhookPath, bot.webhookCallback(webhookPath, { secretToken: webhookSecret }));

  if (app._router?.stack) {
    app._router.stack = app._router.stack.filter((layer) => layer.route?.path !== '/health');
  }

  app.get('/health', (_req, res) => {
    res.json({ ok: true, version: { commit: COMMIT, branch: BRANCH, built_at: BUILT_AT } });
  });

  console.log(`[App version] commit=${COMMIT} branch=${BRANCH} built_at=${BUILT_AT}`);

  return app;
}

let server;

export async function startServer() {
  const app = await createApp();
  const PORT = Number(process.env.PORT || 8000);

  if (server?.listening) return server;

  server = app.listen(PORT, () => {
    console.log('[HTTP] listening on', PORT);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('[HTTP] PORT in use:', PORT, '→ skip listen (another instance running?)');
      return;
    }
    throw err;
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((e) => {
    console.error('[HTTP] start error:', e);
    process.exit(1);
  });
}
