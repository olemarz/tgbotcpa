import type { Telegram } from 'telegraf';
import { db } from '../db/index.js';

const MEMBERSHIP_STATUSES = new Set(['member', 'administrator', 'creator']);

function extractUsername(targetLink: string | null | undefined): string | null {
  if (!targetLink) {
    return null;
  }

  const trimmed = targetLink.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('@')) {
    return trimmed;
  }

  const atMatch = trimmed.match(/@([A-Za-z0-9_]{5,32})/);
  if (atMatch) {
    return `@${atMatch[1]}`;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (host === 't.me' || host === 'telegram.me' || host === 'www.t.me' || host === 'www.telegram.me') {
      const [username] = url.pathname.replace(/^\/+/, '').split(/[/?#]/);
      if (username && !username.startsWith('+') && !username.toLowerCase().startsWith('joinchat')) {
        return `@${username}`;
      }
    }
  } catch (error) {
    // ignore URL parse errors, fall through to regex parsing
  }

  const urlMatch = trimmed.match(/t(?:elegram)?\.me\/([A-Za-z0-9_]+)/i);
  if (urlMatch) {
    return `@${urlMatch[1]}`;
  }

  return null;
}

export type JoinCheckArgs = {
  offer_id: string;
  tg_id: number;
  telegram: Telegram;
};

export type JoinCheckResult = { ok: boolean };

export async function joinCheck({ offer_id, tg_id, telegram }: JoinCheckArgs): Promise<JoinCheckResult> {
  const offer = await db.one(
    `SELECT target_link FROM offers WHERE id=$1`,
    [offer_id]
  );

  const username = extractUsername(offer?.target_link ?? null);
  if (!username) {
    return { ok: false };
  }

  try {
    const member = await telegram.getChatMember(username, tg_id);
    const status = member?.status;
    if (status && MEMBERSHIP_STATUSES.has(status)) {
      return { ok: true };
    }
    return { ok: false };
  } catch (error) {
    console.warn('[joinCheck] getChatMember failed', {
      offer_id,
      tg_id,
      username,
      error: error?.response?.description || error?.message || String(error),
    });
    return { ok: false };
  }
}

export { extractUsername };
