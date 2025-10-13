require('dotenv').config();

const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadConfig() {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../src/config.js'));
  const mod = await import(moduleUrl.href);
  return mod.config || mod.default || mod;
}

(async () => {
  const config = await loadConfig();

  const token = (config.botToken || '').trim();
  if (!token) {
    console.error('BOT_TOKEN empty (.env not loaded or empty)');
    process.exit(1);
  }

  // Node 20 имеет глобальный fetch, но на всякий случай:
  const fetchFn = global.fetch || ((...a) => import('node-fetch').then(m => m.default(...a)));

  async function get(method) {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/${method}`);
    return res.json();
  }

  const me = await get('getMe');
  const wi = await get('getWebhookInfo');
  console.log(
    JSON.stringify(
      {
        me,
        wi,
        allowedUpdates: config.allowedUpdates,
      },
      null,
      2
    )
  );
})().catch(e => {
  console.error('tg-info error:', e?.message || e);
  process.exit(1);
});
