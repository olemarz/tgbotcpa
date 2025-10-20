import { config } from '../config.js';
import { query } from '../db/index.js';

const PRIMARY_EVENT_TYPES = new Set([
  'join_group',
  'subscribe',
  'miniapp_start',
  'external_bot_start',
]);

const PRIMARY_DAILY_CAP = 3;
const REACTION_DEBOUNCE_SECONDS = 60;

function toUInt32Ip(ip) {
  if (typeof ip !== 'string') {
    return null;
  }
  const parts = ip.trim().split('.');
  if (parts.length !== 4) {
    return null;
  }
  const bytes = parts.map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
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

export function isIpInBlockedSubnet(ip) {
  const ipInt = toUInt32Ip(ip);
  if (ipInt === null) {
    return false;
  }

  for (const subnet of config.blockedSubnets ?? []) {
    if (typeof subnet?.network !== 'number' || typeof subnet?.mask !== 'number') {
      continue;
    }
    if ((ipInt & subnet.mask) === subnet.network) {
      return true;
    }
  }

  return false;
}

export async function hasSuspectAttribution({ offerId, tgId, clickId = null }) {
  const params = [offerId, tgId];
  const conditions = ['a.offer_id = $1', 'a.tg_id = $2'];
  if (clickId) {
    params.push(clickId);
    conditions.push('a.click_id = $3');
  }

  const { rows } = await query(
    `SELECT COALESCE((a.meta->>'suspect_ip')::boolean, false) AS attr_suspect,
            COALESCE((c.meta->>'suspect_ip')::boolean, false) AS click_suspect
       FROM attribution a
       LEFT JOIN clicks c ON c.id = a.click_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.last_seen DESC NULLS LAST
      LIMIT 1`,
    params,
  );

  if (!rows.length) {
    return false;
  }

  const [row] = rows;
  return row.attr_suspect === true || row.click_suspect === true;
}

export async function propagateSuspectAttributionMeta({ clickId, offerId = null, tgId = null }) {
  if (!clickId) {
    return false;
  }

  const { rows } = await query(
    `SELECT COALESCE((meta->>'suspect_ip')::boolean, false) AS suspect
       FROM clicks
      WHERE id = $1
      LIMIT 1`,
    [clickId],
  );

  if (!rows.length || rows[0]?.suspect !== true) {
    return false;
  }

  const params = [clickId];
  const conditions = ['click_id = $1'];

  if (tgId !== null && tgId !== undefined) {
    params.push(tgId);
    conditions.push(`tg_id = $${params.length}`);
  }

  if (offerId !== null && offerId !== undefined) {
    params.push(offerId);
    conditions.push(`offer_id = $${params.length}`);
  }

  await query(
    `UPDATE attribution
        SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{suspect_ip}', 'true'::jsonb, true)
      WHERE ${conditions.join(' AND ')}`,
    params,
  );

  return true;
}

export async function shouldBlockPrimaryEvent({ offerId, tgId, eventType }) {
  if (!PRIMARY_EVENT_TYPES.has(eventType)) {
    return false;
  }

  const { rows } = await query(
    `SELECT COUNT(*)::int AS cnt
       FROM events
      WHERE offer_id = $1
        AND tg_id = $2
        AND event_type = $3
        AND created_at >= date_trunc('day', now())`,
    [offerId, tgId, eventType],
  );

  const count = rows[0]?.cnt ?? 0;
  return count >= PRIMARY_DAILY_CAP;
}

export async function shouldDebounceReaction({ offerId, tgId, messageId }) {
  if (!messageId) {
    return false;
  }

  const messageKey = String(messageId);

  const { rows } = await query(
    `SELECT 1
       FROM events
      WHERE offer_id = $1
        AND tg_id = $2
        AND event_type = 'reaction'
        AND created_at >= now() - ($4::int || ' seconds')::interval
        AND COALESCE(payload->>'message_id', '') = $3
      LIMIT 1`,
    [offerId, tgId, messageKey, REACTION_DEBOUNCE_SECONDS],
  );

  return rows.length > 0;
}

export { PRIMARY_EVENT_TYPES, PRIMARY_DAILY_CAP, REACTION_DEBOUNCE_SECONDS };
