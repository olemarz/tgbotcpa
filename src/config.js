import 'dotenv/config';

const DEFAULT_MIN_RATES = {
  join_group: { base: 2, premium: 5 },
  forward: { base: 2, premium: 7 },
  reaction: { base: 1, premium: 5 },
  comment: { base: 3, premium: 10 },
  paid: { base: 30, premium: 30 },
  start_bot: { base: 3, premium: 10 }
};

const DEFAULT_ALLOWED_UPDATES = [
  'message',
  'callback_query',
  'chat_member',
  'my_chat_member',
  'chat_join_request',
  'message_reaction',
  'poll_answer',
];

const GEO_MARKUP_JSON = (process.env.GEO_MARKUP_PERCENT_JSON || '').trim() || '{}';
let GEO_MARKUP_MAP = {};
try {
  GEO_MARKUP_MAP = JSON.parse(GEO_MARKUP_JSON);
} catch {
  GEO_MARKUP_MAP = {};
}

export const MIN_CAP = 25;

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

function parseIdSet(value) {
  if (!value) {
    return new Set();
  }
  return new Set(
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        if (/^\d+$/.test(part)) {
          return part;
        }
        return part;
      })
  );
}

function parseIPv4(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const parts = value.trim().split('.');
  if (parts.length !== 4) {
    return null;
  }
  const bytes = parts.map((part) => {
    const num = Number.parseInt(part, 10);
    return Number.isInteger(num) && num >= 0 && num <= 255 ? num : null;
  });
  if (bytes.some((byte) => byte === null)) {
    return null;
  }
  return (
    (bytes[0] << 24) |
    (bytes[1] << 16) |
    (bytes[2] << 8) |
    bytes[3]
  ) >>> 0;
}

function parseBlockedSubnets(raw) {
  if (!raw) {
    return [];
  }

  const entries = [];
  for (const token of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
    const [ipPart, prefixPart] = token.split('/');
    const ipInt = parseIPv4(ipPart);
    if (ipInt === null) {
      console.warn(`[config] failed to parse blocked subnet: ${token}`);
      continue;
    }

    let prefix = 32;
    if (prefixPart !== undefined && prefixPart !== '') {
      const parsedPrefix = Number.parseInt(prefixPart, 10);
      if (!Number.isInteger(parsedPrefix) || parsedPrefix < 0 || parsedPrefix > 32) {
        console.warn(`[config] invalid CIDR prefix for blocked subnet: ${token}`);
        continue;
      }
      prefix = parsedPrefix;
    }

    const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) & 0xffffffff) >>> 0;
    const network = ipInt & mask;

    entries.push({
      cidr: `${ipPart}/${prefix}`,
      network,
      mask,
    });
  }

  return entries;
}

export function buildConfig(env = process.env) {
  const botToken = requireEnv(env, 'BOT_TOKEN');
  const baseUrlRaw = requireEnv(env, 'BASE_URL');
  const dbUrl = requireEnv(env, 'DATABASE_URL');
  const databaseUrl = dbUrl;

  const cpaPostbackUrlRaw = trim(env.CPA_POSTBACK_URL ?? env.CPA_PB_URL ?? '');
  const cpaApiKey = trim(env.CPA_API_KEY) || '';

  const port = Number.parseInt(trim(env.PORT) || '8000', 10);
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

  const postback = (() => {
    const url = trim(env.POSTBACK_URL) || null;
    const methodRaw = trim(env.POSTBACK_METHOD) || 'GET';
    const secret = trim(env.POSTBACK_SECRET) || null;

    const timeoutRaw = trim(env.POSTBACK_TIMEOUT_MS);
    const timeoutParsed = Number.parseInt(timeoutRaw ?? '', 10);
    const timeoutMs = Number.isNaN(timeoutParsed) ? 4000 : timeoutParsed;

    const retriesRaw = trim(env.POSTBACK_RETRIES);
    const retriesParsed = Number.parseInt(retriesRaw ?? '', 10);
    const retries = Number.isNaN(retriesParsed) ? 0 : Math.max(0, retriesParsed);

    return {
      url,
      method: methodRaw.toUpperCase(),
      secret,
      timeoutMs,
      retries,
    };
  })();

  const idempotencyTtlSec = (() => {
    const raw = trim(env.IDEMPOTENCY_TTL_SEC);
    if (!raw) return 600;
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? 600 : parsed;
  })();

  const adsMasters = (() => {
    const raw =
      trim(env.ADS_MASTERS) ||
      trim(env.ADS_WIZARD_ADMINS) ||
      trim(env.ADS_WIZARD_WHITELIST) ||
      '';
    return parseIdSet(raw);
  })();

  const linkCaptureDisabled = (trim(env.DISABLE_LINK_CAPTURE) || '').toLowerCase() === 'true';

  const adminChatId = (() => {
    const raw = trim(env.ADMIN_CHAT_ID);
    return raw && raw.length ? raw : null;
  })();

  const blockedSubnets = parseBlockedSubnets(trim(env.BLOCKED_SUBNETS));

  return {
    botToken,
    baseUrl,
    baseUrlHost: baseUrlUrl.host,
    port,
    databaseUrl,
    dbUrl,
    cpaPostbackUrl: cpaPostbackUrlRaw,
    cpaApiKey,
    cpaSecret,
    botUsername,
    postbackTimeoutMs: postback.timeoutMs,
    postback,
    idempotencyTtlSec,
    allowedUpdates,
    tz: trim(env.TZ) || 'Europe/Rome',
    nodeEnv: trim(env.NODE_ENV) || undefined,
    webhookPath,
    MIN_RATES: DEFAULT_MIN_RATES,
    MIN_CAP,
    adsMasters,
    linkCaptureDisabled,
    geoMarkupPercent: GEO_MARKUP_MAP,
    adminChatId,
    blockedSubnets,
  };
}

export const config = buildConfig(process.env);
export default config;
