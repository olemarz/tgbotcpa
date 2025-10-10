import test from 'node:test';
import assert from 'node:assert/strict';

process.env.BOT_TOKEN ??= 'test-bot-token';
process.env.BASE_URL ??= 'https://example.test';
process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/tgbotcpa_test';
process.env.CPA_POSTBACK_URL ??= 'https://cpa.example.test/postback';
process.env.CPA_PB_SECRET ??= 'test-secret';

const { buildConfig } = await import('./config.js');

test('buildConfig throws descriptive error for missing required env', () => {
  assert.throws(
    () => buildConfig({}),
    /Environment variable BOT_TOKEN is required/
  );
});

test('buildConfig supports CPA_PB_URL alias and derives baseUrlHost', () => {
  const env = {
    BOT_TOKEN: '123:abc',
    BASE_URL: 'https://example.com',
    DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/tgbotcpa',
    CPA_PB_URL: 'https://cpa.example.com/postback',
    CPA_PB_SECRET: 'secret'
  };

  const cfg = buildConfig(env);

  assert.equal(cfg.cpaPostbackUrl, 'https://cpa.example.com/postback');
  assert.equal(cfg.baseUrlHost, 'example.com');
  assert.deepEqual(cfg.allowedUpdates, ['message', 'callback_query', 'chat_member', 'my_chat_member']);
});

test('buildConfig normalizes optional values', () => {
  const env = {
    BOT_TOKEN: '123:abc',
    BASE_URL: 'https://example.org/app',
    DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/tgbotcpa',
    CPA_POSTBACK_URL: 'https://cpa.example.org/postback',
    CPA_PB_SECRET: 'secret',
    ALLOWED_UPDATES: 'message, callback_query ,',
    WEBHOOK_PATH: 'telegram/hook',
    NODE_ENV: ' dev '
  };

  const cfg = buildConfig(env);

  assert.deepEqual(cfg.allowedUpdates, ['message', 'callback_query']);
  assert.equal(cfg.webhookPath, '/telegram/hook');
  assert.equal(cfg.nodeEnv, 'dev');
  assert.equal(cfg.baseUrlHost, 'example.org');
  assert.equal(cfg.baseUrl, 'https://example.org/app');
});

test('buildConfig falls back to default allowed updates when env empty', () => {
  const env = {
    BOT_TOKEN: '123:abc',
    BASE_URL: 'https://example.net',
    DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/tgbotcpa',
    CPA_POSTBACK_URL: 'https://cpa.example.net/postback',
    CPA_PB_SECRET: 'secret',
    ALLOWED_UPDATES: '   ',
  };

  const cfg = buildConfig(env);

  assert.deepEqual(cfg.allowedUpdates, ['message', 'callback_query', 'chat_member', 'my_chat_member']);
});
