import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

interface TelegramInitUser {
  id: number;
  [key: string]: unknown;
}

interface VerificationResult {
  ok: boolean;
  user?: { id: number };
  start_param?: string;
  error?: string;
}

const FRESHNESS_WINDOW_SEC = 60;

function buildDataCheckString(params: URLSearchParams): string {
  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key === 'hash') {
      return;
    }
    pairs.push(`${key}=${value}`);
  });
  pairs.sort();
  return pairs.join('\n');
}

function parseUser(value: string | null): { id: number } | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as TelegramInitUser;
    const id = Number(parsed?.id);
    if (!Number.isFinite(id)) {
      return null;
    }
    return { id: Math.trunc(id) };
  } catch (error) {
    console.warn('[tgInitData] failed to parse user', error);
    return null;
  }
}

export function verifyInitData(initData: string): VerificationResult {
  if (!initData || typeof initData !== 'string') {
    return { ok: false, error: 'INIT_DATA_REQUIRED' };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    return { ok: false, error: 'HASH_MISSING' };
  }

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    console.error('[tgInitData] BOT_TOKEN missing in environment');
    return { ok: false, error: 'BOT_TOKEN_MISSING' };
  }

  const dataCheckString = buildDataCheckString(params);

  const secretKey = createHash('sha256').update(botToken).digest();
  const computedHashHex = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  let providedHash: Buffer;
  let expectedHash: Buffer;
  try {
    providedHash = Buffer.from(hash, 'hex');
    expectedHash = Buffer.from(computedHashHex, 'hex');
  } catch (error) {
    console.warn('[tgInitData] failed to decode hash', error);
    return { ok: false, error: 'HASH_INVALID' };
  }

  if (providedHash.length !== expectedHash.length || !timingSafeEqual(providedHash, expectedHash)) {
    return { ok: false, error: 'SIGNATURE_INVALID' };
  }

  const authDateRaw = params.get('auth_date');
  if (!authDateRaw) {
    return { ok: false, error: 'AUTH_DATE_MISSING' };
  }

  const authDate = Number.parseInt(authDateRaw, 10);
  if (!Number.isFinite(authDate)) {
    return { ok: false, error: 'AUTH_DATE_INVALID' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - authDate) > FRESHNESS_WINDOW_SEC) {
    return { ok: false, error: 'AUTH_DATE_EXPIRED' };
  }

  const user = parseUser(params.get('user'));
  if (!user) {
    return { ok: false, error: 'USER_INVALID' };
  }

  const startParam = params.get('start_param') || undefined;

  return { ok: true, user, start_param: startParam };
}
