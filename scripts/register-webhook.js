import 'dotenv/config';
import { URLSearchParams } from 'node:url';
import { config } from '../src/config.js';

const token = (config.botToken || '').trim();
if (!token) {
  throw new Error('BOT_TOKEN empty');
}

const baseUrl = (config.baseUrl || '').trim().replace(/\/$/, '');
if (!baseUrl) {
  throw new Error('BASE_URL empty');
}

const webhookPath = (config.webhookPath || '/bot/webhook').trim();
const url = `${baseUrl}${webhookPath.startsWith('/') ? webhookPath : `/${webhookPath}`}`;

const secret = (process.env.WEBHOOK_SECRET || 'prod-secret').trim();

const body = new URLSearchParams({
  url,
  secret_token: secret,
  allowed_updates: JSON.stringify(config.allowedUpdates),
});

const fetchFn = global.fetch || ((...args) => import('node-fetch').then(module => module.default(...args)));

fetchFn(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body,
})
  .then(res => res.text())
  .then(console.log)
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
