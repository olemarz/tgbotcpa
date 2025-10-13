require('dotenv').config();
const fetchFn =
  global.fetch || ((...args) => import('node-fetch').then((m) => m.default(...args)));

(async () => {
  const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
  const path = (process.env.WEBHOOK_PATH || '/bot/webhook').trim();
  const url = baseUrl + path;
  const secret = (process.env.WEBHOOK_SECRET || 'prod-secret').trim();
  const body = {
    update_id: 999999,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 0, type: 'private' },
      from: { id: 0, is_bot: false, first_name: 'test' },
      text: '/whoami',
    },
  };

  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': secret,
    },
    body: JSON.stringify(body),
  });
  console.log('status', res.status, 'text', await res.text());
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
