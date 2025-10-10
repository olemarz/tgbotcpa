import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import { webhookCallback } from '../bot/telegraf.js';

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const webhookPath = process.env.WEBHOOK_PATH || '/bot/webhook';

// единственный webhook endpoint
app.post(webhookPath, webhookCallback, (_req, res) => res.sendStatus(200));

// health
app.get('/health', (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT || 3000);
const baseUrl = process.env.BASE_URL || 'undefined';

console.log('[api] config', { port, webhookPath, baseUrl });

app.listen(port, () => console.log(`[api] listening on :${port}`));

export default app;
