import 'dotenv/config';
import axios from 'axios';

const { BOT_TOKEN, BASE_URL, WEBHOOK_PATH, WEBHOOK_SECRET } = process.env;
if (!BOT_TOKEN || !BASE_URL) {
  console.error('BOT_TOKEN and BASE_URL are required');
  process.exit(1);
}
const url = `${BASE_URL.replace(/\/$/, '')}${WEBHOOK_PATH || '/bot/webhook'}`;

const allowed = ['message', 'callback_query', 'chat_member', 'my_chat_member'];

async function main() {
  await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`, {
    params: { drop_pending_updates: true },
  });

  const { data } = await axios.post(
    `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
    new URLSearchParams({
      url,
      secret_token: WEBHOOK_SECRET || 'prod-secret',
      // передаём как JSON-строку
      allowed_updates: JSON.stringify(allowed),
    }),
  );
  console.log(data);
}
main().catch((e) => {
  console.error(e.response?.data || e.message);
  process.exit(1);
});
