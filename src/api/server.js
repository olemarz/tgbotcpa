import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { bot } from '../bot/telegraf.js';
import { COMMIT, BRANCH, BUILT_AT } from '../version.js';
import { waRouter } from './wa.js';
import { cpaRouter } from './cpa.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');
app.use(express.static(publicDir));
app.use('/api/wa', waRouter);
app.use('/api/cpa', cpaRouter);

const WH_PATH = process.env.WEBHOOK_PATH || '/bot/webhook';
const WH_SECRET = process.env.WEBHOOK_SECRET || 'prod-secret';
app.use(WH_PATH, bot.webhookCallback(WH_PATH, { secretToken: WH_SECRET }));

console.log(`[App version] commit=${COMMIT} branch=${BRANCH} built_at=${BUILT_AT}`);

app.get('/health', (_req, res) => {
  res.json({ ok: true, version: { commit: COMMIT, branch: BRANCH, built_at: BUILT_AT } });
});
app.listen(process.env.PORT || 3000, () => console.log('[api] Listening on :' + (process.env.PORT || 3000)));
