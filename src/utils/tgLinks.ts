export type NormalizedTargetLink =
  | { type: 'public'; username: string }
  | { type: 'invite'; invite: string };

const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me']);
const USERNAME_REGEXP = /^[a-zA-Z0-9_]{5,32}$/;
const INVITE_REGEXP = /^[A-Za-z0-9_-]{5,64}$/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return value;
  }
}

function normalizeUsername(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  let username = safeDecode(raw).trim();
  if (!username) {
    return null;
  }
  if (username.startsWith('@')) {
    username = username.slice(1);
  }
  if (!USERNAME_REGEXP.test(username)) {
    return null;
  }
  return username;
}

function normalizeInvite(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  let invite = safeDecode(raw).trim();
  if (!invite) {
    return null;
  }
  if (invite.startsWith('+')) {
    invite = invite.slice(1);
  }
  if (!INVITE_REGEXP.test(invite)) {
    return null;
  }
  return invite;
}

function parseTelegramHttpUrl(input: string): NormalizedTargetLink | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch (_error) {
    return null;
  }

  if (!TELEGRAM_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const firstSegment = safeDecode(segments[0]);

  if (firstSegment.startsWith('+')) {
    const invite = normalizeInvite(firstSegment.slice(1));
    if (!invite) {
      return null;
    }
    return { type: 'invite', invite };
  }

  if (firstSegment.toLowerCase() === 'joinchat') {
    const inviteSegment = segments.length > 1 ? safeDecode(segments[1]) : null;
    const invite = normalizeInvite(inviteSegment);
    if (!invite) {
      return null;
    }
    return { type: 'invite', invite };
  }

  const username = normalizeUsername(firstSegment);
  if (!username) {
    return null;
  }

  return { type: 'public', username };
}

function parseResolveScheme(input: string): NormalizedTargetLink | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch (_error) {
    return null;
  }

  if (url.protocol.toLowerCase() !== 'tg:') {
    return null;
  }

  if (url.hostname.toLowerCase() !== 'resolve') {
    return null;
  }

  const username = normalizeUsername(url.searchParams.get('domain'));
  if (!username) {
    return null;
  }

  return { type: 'public', username };
}

export function normalizeTargetLink(input: string): NormalizedTargetLink | null {
  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.toLowerCase().startsWith('tg://')) {
    return parseResolveScheme(trimmed);
  }

  if (trimmed.toLowerCase().startsWith('http://') || trimmed.toLowerCase().startsWith('https://')) {
    return parseTelegramHttpUrl(trimmed);
  }

  return null;
}
