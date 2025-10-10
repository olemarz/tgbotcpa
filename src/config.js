import 'dotenv/config';

const DEFAULT_MIN_RATES = {
  join_group: { base: 5, premium: 10 },
  forward: { base: 2, premium: 7 },
  reaction: { base: 1, premium: 5 },
  comment: { base: 3, premium: 10 },
  paid: { base: 30, premium: 30 },
  start_bot: { base: 3, premium: 10 }
};

const DEFAULT_ALLOWED_UPDATES = ['message', 'callback_query', 'chat_member', 'my_chat_member'];

const trim = (value) => (typeof value === 'string' ? value.trim() : value);

function requireEnv(env, name, { alias } = {}) {
  const raw = env[name] ?? (alias ? env[alias] : undefined);
  const value = trim(raw);
  if (value === undefined || value === null || value === '') {
    const aliasInfo = alias ? ` (alias: ${alias})` : '';
    throw new Error(`Environment variable ${name}${aliasInfo} is required. Please set it in your deployment environment or .env file.`);
  }
  return value;
}

function parseUrl(value, name) {
  try {
    return new URL(value);
  } catch (error) {
    throw new Error(`Environment variable ${name} must be a valid absolute URL. Received: ${value}`);
  }
}

export function buildConfig(env = process.env) {
  const botToken = requireEnv(env, 'BOT_TOKEN');
  const baseUrlRaw = requireEnv(env, 'BASE_URL');
  const dbUrl = requireEnv(env, 'DATABASE_URL');

  const cpaPostbackUrlRaw = trim(env.CPA_POSTBACK_URL ?? env.CPA_PB_URL ?? '');

  const port = Number.parseInt(trim(env.PORT) || '3000', 10);
  if (Number.isNaN(port)) {
    throw new Error(`Environment variable PORT must be a number. Received: ${env.PORT}`);
  }

  const baseUrl = baseUrlRaw;
  const baseUrlUrl = parseUrl(baseUrl, 'BASE_URL');
  if (cpaPostbackUrlRaw) {
    parseUrl(cpaPostbackUrlRaw, 'CPA_POSTBACK_URL');
  }

  const allowedUpdates = (() => {
    const raw = trim(env.ALLOWED_UPDATES) || '';
    if (!raw) return DEFAULT_ALLOWED_UPDATES;
    const parsed = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parsed.length ? parsed : DEFAULT_ALLOWED_UPDATES;
  })();

  const webhookPath = (() => {
    const raw = trim(env.WEBHOOK_PATH);
    if (!raw) return '';
    return raw.startsWith('/') ? raw : `/${raw}`;
  })();

  let cpaSecret = trim(env.CPA_PB_SECRET);
  if (!cpaSecret) {
    console.warn('CPA_PB_SECRET not set: signature checks disabled');
    cpaSecret = 'dev-secret';
  }

  const botUsername = trim(env.BOT_USERNAME) || '';

  const postbackTimeoutMs = (() => {
    const raw = trim(env.POSTBACK_TIMEOUT_MS);
    if (!raw) return 4000;
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? 4000 : parsed;
  })();

  const idempotencyTtlSec = (() => {
    const raw = trim(env.IDEMPOTENCY_TTL_SEC);
    if (!raw) return 600;
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? 600 : parsed;
  })();

  return {
    botToken,
    baseUrl,
    baseUrlHost: baseUrlUrl.host,
    port,
    dbUrl,
    cpaPostbackUrl: cpaPostbackUrlRaw,
    cpaSecret,
    botUsername,
    postbackTimeoutMs,
    idempotencyTtlSec,
    allowedUpdates,
    tz: trim(env.TZ) || 'Europe/Rome',
    nodeEnv: trim(env.NODE_ENV) || undefined,
    webhookPath,
    MIN_RATES: DEFAULT_MIN_RATES,
  };
}

export const config = buildConfig(process.env);
