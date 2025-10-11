import 'dotenv/config';
import { createApp } from './app.js';
import { bot } from '../bot/telegraf.js';

const app = createApp();

const WH_PATH = process.env.WEBHOOK_PATH || '/bot/webhook';
const WH_SECRET = process.env.WEBHOOK_SECRET || 'prod-secret';

app.use(WH_PATH, bot.webhookCallback(WH_PATH, { secretToken: WH_SECRET }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('[api] Listening on :' + PORT));

export default app;
