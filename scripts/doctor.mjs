import 'dotenv/config';
import { execSync } from 'node:child_process';

const sh = (cmd) => execSync(cmd, { stdio: 'pipe' }).toString().trim();

const PORT = process.env.PORT || '8000';
const BASE_URL = (process.env.BASE_URL || 'https://adspirin.ru').replace(/\/$/, '');
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || '/bot/webhook';
const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();

console.log('== Doctor ==');

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is empty (check .env / PM2 env)');
  process.exit(2);
}

console.log('1) Syntax check (node --check)...');
try {
  sh(`bash -lc "find src -type f -name '*.js' -print0 | xargs -0 -I{} node --check {} >/dev/null"`);
  console.log('   ✓ JS syntax OK');
} catch (e) {
  console.error('❌ Syntax error in JS files\n', e.stdout?.toString() || e.message);
  process.exit(3);
}

console.log('2) Local HTTP /health ...');
try {
  const health = sh(`curl -fsS http://127.0.0.1:${PORT}/health`);
  if (!health.includes('"ok":true')) throw new Error(health);
  console.log('   ✓', health);
} catch (e) {
  console.error('❌ /health failed:', e.message || e);
  process.exit(4);
}

console.log('3) HTTPS /health ...');
try {
  const h2 = sh(`curl -fsSk ${BASE_URL}/health`);
  if (!h2.includes('"ok":true')) throw new Error(h2);
  console.log('   ✓ https health OK');
} catch (e) {
  console.error('❌ https health failed:', e.message || e);
  process.exit(5);
}

console.log('4) HTTPS webhook POST ...');
try {
  const r = sh(`curl -isSk -X POST "${BASE_URL}${WEBHOOK_PATH}" -H 'Content-Type: application/json' -d '{"update_id":555001,"message":{"message_id":1,"chat":{"id":123,"type":"private"},"from":{"id":123},"text":"/start doctor"}}' | head -n 1`);
  if (!/ 200 /.test(r)) throw new Error(r);
  console.log('   ✓ webhook 200 OK');
} catch (e) {
  console.error('❌ webhook not 200:', e.message || e);
  process.exit(6);
}

console.log('5) Telegram getWebhookInfo ...');
try {
  const info = sh(`curl -fsS "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"`);
  console.log('   ✓', info);
} catch (e) {
  console.error('❌ getWebhookInfo failed:', e.message || e);
  process.exit(7);
}

console.log('== Doctor OK ==');
