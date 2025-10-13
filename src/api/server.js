import 'dotenv/config';
import express from 'express';
import { unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
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

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const portRaw = process.env.PORT;
  const port = Number.parseInt(portRaw ?? '', 10);
  const listenPort = Number.isFinite(port) && port > 0 ? port : 3000;
  const socketPath = (process.env.SOCK_PATH || '/tmp/tg-api.sock').trim();

  const startServer = async () => {
    const app = await createApp();

    if (socketPath) {
      try {
        unlinkSync(socketPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }
    }

    const listenTarget = socketPath ? { path: socketPath } : listenPort;
    const humanReadableTarget = socketPath || `:${listenPort}`;

    const server = app.listen(listenTarget, () => console.log(`[api] Listening on ${humanReadableTarget}`));

    if (socketPath) {
      const cleanup = () => {
        try {
          unlinkSync(socketPath);
        } catch (error) {
          if (error?.code !== 'ENOENT') {
            console.error(`[api] Failed to cleanup socket ${socketPath}`, error);
          }
        }
      };

      process.once('exit', cleanup);
      server.on('close', cleanup);
    }
  };

  startServer().catch((error) => {
    console.error('[api] Failed to start server', error);
    process.exitCode = 1;
  });
}
