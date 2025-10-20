import { query } from '../db/index.js';
import { config } from '../config.js';

export const OFFER_CAPS_INCREASE_CALLBACK_PREFIX = 'offer_caps_increase:';

function buildOfferName(row) {
  return row.slug || row.title || row.name || row.id;
}

function buildAdminMessage({ offerName, offerId, eventsTotal, capsTotal, ownerId }) {
  const parts = [
    '⚠️ Лимит оффера исчерпан.',
    `<b>${offerName}</b> (id=${offerId})`,
    `Событий: <b>${eventsTotal}</b> из <b>${capsTotal}</b>.`,
  ];
  if (ownerId) {
    parts.push(`Владелец: <a href="tg://user?id=${ownerId}">${ownerId}</a>.`);
  }
  parts.push('Нажмите «Увеличить лимит», чтобы предложить пополнение.');
  return parts.join('\n');
}

function buildOwnerMessage({ offerName, offerId, eventsTotal, capsTotal }) {
  const parts = [
    `⚠️ Ваш оффер <b>${offerName}</b> (id=${offerId}) достиг лимита.`,
    `Событий: <b>${eventsTotal}</b> из <b>${capsTotal}</b>.`,
    'Можно увеличить бюджет по кнопке ниже.',
  ];
  return parts.join('\n');
}

async function loadOfferCapsState(offerId) {
  const result = await query(
    `SELECT o.id,
            o.slug,
            o.title,
            o.name,
            o.caps_total,
            o.payout_cents,
            o.created_by_tg_id,
            o.caps_reached_notified_at,
            stats.events_total
       FROM offers o
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::bigint AS events_total
           FROM events e
          WHERE e.offer_id = o.id
            AND (o.event_type IS NULL OR e.event_type = o.event_type)
       ) stats ON TRUE
      WHERE o.id = $1
      LIMIT 1`,
    [offerId],
  );

  if (!result.rowCount) {
    return null;
  }

  const row = result.rows[0];
  return {
    offerId: row.id,
    slug: row.slug ?? null,
    title: row.title ?? null,
    name: row.name ?? null,
    capsTotal: row.caps_total != null ? Number(row.caps_total) : null,
    payoutCents: row.payout_cents != null ? Number(row.payout_cents) : null,
    ownerId: row.created_by_tg_id != null ? String(row.created_by_tg_id) : null,
    notifiedAt: row.caps_reached_notified_at ?? null,
    eventsTotal: row.events_total != null ? Number(row.events_total) : 0,
  };
}

export async function notifyOfferCapsIfNeeded({ offerId, telegram }) {
  if (!offerId) {
    return false;
  }

  const state = await loadOfferCapsState(offerId);
  if (!state) {
    return false;
  }

  const { capsTotal, eventsTotal, notifiedAt } = state;
  if (capsTotal == null || capsTotal <= 0) {
    return false;
  }
  if (eventsTotal < capsTotal) {
    return false;
  }
  if (notifiedAt) {
    return false;
  }

  const claimResult = await query(
    `UPDATE offers
        SET caps_reached_notified_at = NOW()
      WHERE id = $1 AND caps_reached_notified_at IS NULL
    RETURNING caps_reached_notified_at`,
    [offerId],
  );

  if (!claimResult.rowCount) {
    return false;
  }

  const offerName = buildOfferName(state);
  const adminMessage = buildAdminMessage({
    offerName,
    offerId: state.offerId,
    eventsTotal,
    capsTotal,
    ownerId: state.ownerId,
  });
  const ownerMessage = buildOwnerMessage({
    offerName,
    offerId: state.offerId,
    eventsTotal,
    capsTotal,
  });

  const adminChatId = config.adminChatId || process.env.ADMIN_CHAT_ID || null;
  const sentStatuses = [];
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: 'Увеличить лимит',
            callback_data: `${OFFER_CAPS_INCREASE_CALLBACK_PREFIX}${state.offerId}`,
          },
        ],
      ],
    },
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  const tgClient = telegram ?? null;

  async function sendIfPossible(chatId, text) {
    if (!chatId || !tgClient?.sendMessage) {
      return false;
    }
    try {
      await tgClient.sendMessage(chatId, text, keyboard);
      return true;
    } catch (error) {
      console.error('[caps.notify] send error', { chatId, offerId, error: error?.message || error });
      return false;
    }
  }

  if (adminChatId) {
    const ok = await sendIfPossible(adminChatId, adminMessage);
    sentStatuses.push(ok);
  }

  if (state.ownerId && (!adminChatId || String(adminChatId) !== state.ownerId)) {
    const ok = await sendIfPossible(state.ownerId, ownerMessage);
    sentStatuses.push(ok);
  }

  if (!sentStatuses.some(Boolean)) {
    await query(
      `UPDATE offers SET caps_reached_notified_at = NULL WHERE id = $1`,
      [offerId],
    );
    return false;
  }

  return true;
}

export async function fetchOfferForIncrease(offerId) {
  const result = await query(
    `SELECT id, slug, title, name, payout_cents, caps_total
       FROM offers
      WHERE id = $1
      LIMIT 1`,
    [offerId],
  );
  if (!result.rowCount) {
    return null;
  }
  const row = result.rows[0];
  return {
    id: row.id,
    slug: row.slug ?? null,
    title: row.title ?? row.name ?? null,
    payoutCents: row.payout_cents != null ? Number(row.payout_cents) : 0,
    capsTotal: row.caps_total != null ? Number(row.caps_total) : 0,
  };
}
