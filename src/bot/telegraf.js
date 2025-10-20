import https from 'node:https';
import 'dotenv/config';
import { Telegraf, Scenes, session, Markup } from 'telegraf';

import { query } from '../db/index.js';
import { insertEvent } from '../db/events.js';
import { createConversion } from '../services/conversion.js';
import { joinCheck } from '../services/joinCheck.js';
import * as attribution from '../services/attribution.js';
import { uuid, shortToken } from '../util/id.js';
import { registerStatHandlers } from './stat.js';
import sessionStore from './sessionStore.js';
import { adsWizardScene, startAdsWizard } from './adsWizard.js';
import { ensureBotSelf } from './self.js';
import { replyHtml } from './html.js';
import { listAllOffers, listOffersByOwner } from '../db/offers.js';
import {
  upsertAdvertiser,
  getAdvertiser,
  setAdvertiserBlocked,
  listAdvertisersByIds,
} from '../db/advertisers.js';
import { sendPostbackForEvent } from '../services/postback.js';
import {
  hasSuspectAttribution,
  shouldBlockPrimaryEvent,
  shouldDebounceReaction,
  propagateSuspectAttributionMeta,
} from '../services/antifraud.js';
  centsToCurrency,
  formatDate,
  buildAdvertiserSummary,
  buildAdvertiserPeriodStats,
  buildAdminPeriodStats,
  toRangeBoundaries,
  fetchOfferDetail,
  fetchPendingOffers,
} from '../services/offerStats.js';

console.log('[BOOT] telegraf init');

const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
if (!BOT_TOKEN) {
  console.error('[BOOT] BOT_TOKEN env is required');
  process.exit(1);
}

const agent = new https.Agent({
  keepAlive: true,
  timeout: 15000,
});

export const bot = new Telegraf(BOT_TOKEN, {
  telegram: {
    agent,
  },
});

await ensureBotSelf(bot);

// сцены
const stage = new Scenes.Stage([adsWizardScene]);

const middlewares = [
  session({
    store: sessionStore,
    getSessionKey(ctx) {
      const fromId = ctx.from?.id;
      if (!['string', 'number', 'bigint'].includes(typeof fromId)) return undefined;
      const key = String(fromId);
      return /^[0-9]+$/.test(key) ? key : undefined;
    },
  }),
  stage.middleware(),
];

if (process.env.DISABLE_LINK_CAPTURE !== 'true') {
  try {
    const module = await import('./link-capture.js');
    const linkCapture = module?.default;
    if (typeof linkCapture === 'function') {
      middlewares.push(linkCapture());
      console.log('[BOOT] link-capture enabled');
    } else {
      console.warn('[BOOT] link-capture module missing default export');
    }
  } catch (error) {
    console.error('[BOOT] failed to load link-capture', error?.message || error);
  }
} else {
  console.log('[BOOT] link-capture disabled');
}

const traceMiddleware = async (ctx, next) => {
  const { updateType } = ctx;
  const text = ctx.update?.message?.text;
  const entities = ctx.update?.message?.entities;
  console.log('[TRACE:IN ] type=%s text=%j entities=%j', updateType, text ?? null, entities ?? null);
  try {
    const result = await next();
    console.log('[TRACE:OUT] type=%s text=%j', updateType, text ?? null);
    return result;
  } catch (error) {
    console.error('[TRACE:ERR] type=%s message=%s', updateType, error?.message || error);
    throw error;
  }
};

middlewares.push(traceMiddleware);

const ADVERTISER_COMMANDS = Object.freeze([
  ['/start', 'приветствие и список команд'],
  ['/list', 'подсказка по доступным командам'],
  ['/ads', 'запустить мастер создания оффера'],
  ['/myoffers', 'список ваших офферов и лимитов'],
  ['/my_offers', 'краткие метрики по офферам'],
  ['/offer <slug>', 'подробная карточка оффера'],
  ['/stat', 'агрегированная статистика по офферам'],
]);

const ADMIN_COMMANDS = Object.freeze([
  ['/admin', 'список команд администратора'],
  ['/statadm', 'статистика по всем офферам рекламодателей'],
  ['/pending', 'подвисшие офферы без оплаты'],
  ['/admin_offers', 'последние офферы'],
  ['/offer_status <id> <status>', 'смена статуса оффера'],
]);

function renderCommandList(commands) {
  return commands
    .map(([command, description]) => `• <code>${command}</code> — ${description}`)
    .join('\n');
}

function buildAdvertiserHelpMessage(isAdmin = false) {
  const header =
    '👋 Здравствуйте! Это бот для запуска рекламных кампаний. Выберите команду ниже или сразу начните с <code>/ads</code>.';
  const userCommands = renderCommandList(ADVERTISER_COMMANDS);
  const adminSection = isAdmin
    ? '\n\n⚙️ Команды администратора:\n' + renderCommandList(ADMIN_COMMANDS)
    : '';
  const footer =
    '\n\nЕсли у вас есть токен кампании, используйте команду <code>/claim &lt;TOKEN&gt;</code>.';
  return `${header}\n\nДоступные команды:\n${userCommands}${adminSection}${footer}`;
}

function buildAdminHelpMessage() {
  return '⚙️ Команды администратора:\n' + renderCommandList(ADMIN_COMMANDS);
}

function formatCaps(value) {
  if (value === null || value === undefined) return '—';
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : String(value);
}

function buildSpentLeftText(spentCents, leftCents) {
  return `${centsToCurrency(spentCents)} / ${centsToCurrency(leftCents)}`;
}

function buildMyOffersDetailed(offers) {
  if (!offers.length) {
    return 'У вас пока нет офферов. Запустите мастер командой <code>/ads</code>.';
  }

  const lines = offers.map((offer) => {
    const caps = formatCaps(offer.caps_total);
    const conversions = offer.conversions_total ?? 0;
    const premium = offer.premium_total ?? 0;
    const spentLeft = buildSpentLeftText(offer.spent_total_cents, offer.budget_left_cents);
    return (
      `• <b>${offer.slug}</b> — <code>${offer.event_type}</code>\n` +
      `  payout: <code>${centsToCurrency(offer.payout_cents)}</code>, лимит: <code>${caps}</code>\n` +
      `  ЦД: <code>${conversions}</code>, премиум: <code>${premium}</code>\n` +
      `  spent/left: <code>${spentLeft}</code>`
    );
  });

  lines.push('\nОткройте карточку оффера: <code>/offer &lt;slug&gt;</code>.');
  return lines.join('\n');
}

function buildMyOffersCompact(offers) {
  if (!offers.length) {
    return 'Офферов не найдено. Используйте <code>/ads</code>, чтобы создать первый оффер.';
  }

  return offers
    .map((offer) => {
      const spentLeft = buildSpentLeftText(offer.spent_total_cents, offer.budget_left_cents);
      const clicks = offer.clicks_range ?? offer.clicks_total ?? 0;
      const conversions = offer.conversions_range ?? offer.conversions_total ?? 0;
      return `• <b>${offer.slug}</b> — клики: <code>${clicks}</code>, ЦД: <code>${conversions}</code>, расход/остаток: <code>${spentLeft}</code>`;
    })
    .join('\n');
}

function buildStatsSection({ label }, offers) {
  if (!offers.length) {
    return `📊 Период ${label}: нет данных.`;
  }

  const lines = [`📊 Период ${label}`];
  let totalClicks = 0;
  let totalConversions = 0;
  let totalPremium = 0;
  let totalSpend = 0;

  for (const offer of offers) {
    const clicks = offer.clicks_range ?? 0;
    const conversions = offer.conversions_range ?? 0;
    const premium = offer.premium_range ?? 0;
    const spend = offer.spent_range_cents ?? 0;
    totalClicks += clicks;
    totalConversions += conversions;
    totalPremium += premium;
    totalSpend += spend;
    lines.push(
      `• <b>${offer.slug}</b> (${formatDate(offer.created_at)})\n` +
        `  клики: <code>${clicks}</code>, ЦД: <code>${conversions}</code>, премиум: <code>${premium}</code>\n` +
        `  стоимость: <code>${centsToCurrency(spend)}</code>, остаток: <code>${centsToCurrency(
          offer.budget_left_cents,
        )}</code>`
    );
  }

  lines.push(
    `Итого — клики: <code>${totalClicks}</code>, ЦД: <code>${totalConversions}</code>, премиум: <code>${totalPremium}</code>, ` +
      `стоимость: <code>${centsToCurrency(totalSpend)}</code>.`,
  );

  return lines.join('\n');
}

function buildContactLink(ownerId) {
  if (!ownerId) return '—';
  const id = String(ownerId);
  return `<a href="tg://user?id=${id}">${id}</a>`;
}

function buildAdminStatsSection({ label }, offers) {
  if (!offers.length) {
    return `📊 Период ${label}: нет офферов.`;
  }

  const lines = [`📊 Период ${label}`];
  let totalClicks = 0;
  let totalConversions = 0;
  let totalPremium = 0;
  let totalSpend = 0;

  for (const offer of offers) {
    const clicks = offer.clicks_range ?? 0;
    const conversions = offer.conversions_range ?? 0;
    const premium = offer.premium_range ?? 0;
    const spend = offer.spent_range_cents ?? 0;
    totalClicks += clicks;
    totalConversions += conversions;
    totalPremium += premium;
    totalSpend += spend;
    const contact = buildContactLink(offer.owner_id);
    lines.push(
      `• ${contact} — ${formatDate(offer.created_at)} — <b>${offer.slug}</b>\n` +
        `  клики: <code>${clicks}</code>, ЦД: <code>${conversions}</code>, премиум: <code>${premium}</code>\n` +
        `  стоимость: <code>${centsToCurrency(spend)}</code>, остаток: <code>${centsToCurrency(
          offer.budget_left_cents,
        )}</code>`
    );
  }

  lines.push(
    `Итого — клики: <code>${totalClicks}</code>, ЦД: <code>${totalConversions}</code>, премиум: <code>${totalPremium}</code>, ` +
      `стоимость: <code>${centsToCurrency(totalSpend)}</code>.`,
  );

  return lines.join('\n');
}

for (const middleware of middlewares) {
  bot.use(middleware);
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ADMIN_ID_SET = (() => {
  const ids = new Set();
  const list = String(process.env.ADMIN_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const id of list) {
    ids.add(id);
  }
  const legacy = (process.env.ADMIN_TG_ID || '').trim();
  if (legacy) {
    ids.add(legacy);
  }
  return ids;
})();

function isAdmin(ctx) {
  const fromId = ctx.from?.id;
  if (fromId == null) return false;
  return ADMIN_ID_SET.has(String(fromId));
}

function normalizePayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return {};
  }

  if (Array.isArray(rawPayload)) {
    return rawPayload.filter((value) => value !== undefined);
  }

  return Object.entries(rawPayload).reduce((acc, [key, value]) => {
    if (value === undefined) {
      return acc;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      acc[key] = normalizePayload(value);
      return acc;
    }

    acc[key] = value;
    return acc;
  }, {});
}

async function withEventError(label, fn) {
  try {
    return await fn();
  } catch (error) {
    console.error('[EVENT_ERR]', `${label}:`, error?.message || error);
    return null;
  }
}

async function resolveOfferContext(tgId) {
  if (!tgId) {
    return null;
  }

  const result = await query(
    `SELECT a.offer_id, a.user_id, a.click_id, a.uid,
            o.postback_url, o.postback_secret, o.postback_method, o.postback_timeout_ms, o.postback_retries
       FROM attribution a
       LEFT JOIN offers o ON o.id = a.offer_id
      WHERE a.tg_id = $1
      ORDER BY a.last_seen DESC
      LIMIT 1`,
    [tgId],
  );

  if (!result.rowCount) {
    return null;
  }

  const row = result.rows[0];
  return {
    offerId: row.offer_id,
    userId: row.user_id ?? tgId,
    clickId: row.click_id ?? null,
    uid: row.uid ?? null,
    postbackUrl: row.postback_url ?? null,
    postbackSecret: row.postback_secret ?? null,
    postbackMethod: row.postback_method ?? null,
    postbackTimeoutMs: row.postback_timeout_ms ?? null,
    postbackRetries: row.postback_retries ?? null,
  };
}

async function handleEvent(ctx, eventType, payload = {}, options = {}) {
  const tgId = options?.tgId ?? ctx.from?.id ?? ctx.update?.message?.from?.id ?? null;
  if (!tgId) {
    return;
  }

  const context = await withEventError(`resolveOffer:${eventType}`, () => resolveOfferContext(tgId));
  if (!context?.offerId) {
    return;
  }

  const eventPayload = normalizePayload({
    ...payload,
    click_id: context.clickId ?? undefined,
    uid: context.uid ?? undefined,
  });

  const offerId = context.offerId;

  if (await hasSuspectAttribution({ offerId, tgId, clickId: context.clickId ?? null })) {
    console.warn('[EVENT] skipped suspect attribution', { offer_id: offerId, tg_id: tgId, event_type: eventType });
    return;
  }

  if (await shouldBlockPrimaryEvent({ offerId, tgId, eventType })) {
    console.warn('[EVENT] primary cap reached', { offer_id: offerId, tg_id: tgId, event_type: eventType });
    return;
  }

  if (
    eventType === 'reaction' &&
    (await shouldDebounceReaction({ offerId, tgId, messageId: eventPayload?.message_id ?? null }))
  ) {
    console.warn('[EVENT] reaction debounced', {
      offer_id: offerId,
      tg_id: tgId,
      event_type: eventType,
      message_id: eventPayload?.message_id ?? null,
    });
    return;
  }

  const inserted = await withEventError(`insertEvent:${eventType}`, () =>
    insertEvent({
      offer_id: offerId,
      user_id: context.userId ?? tgId,
      tg_id: tgId,
      event_type: eventType,
      payload: eventPayload,
    }),
  );

  if (!inserted?.id) {
    return;
  }

  await withEventError(`attachEvent:${eventType}`, () =>
    attribution.attachEvent({
      offerId: context.offerId,
      tgId,
      clickId: context.clickId ?? null,
      uid: context.uid ?? null,
    }),
  );

  const offerForPostback = {
    id: context.offerId,
    postback_url: context.postbackUrl ?? null,
    postback_secret: context.postbackSecret ?? null,
    postback_method: context.postbackMethod ?? null,
    postback_timeout_ms: context.postbackTimeoutMs ?? null,
    postback_retries: context.postbackRetries ?? null,
  };

  const clickForPostback = context.clickId
    ? { id: context.clickId, click_id: context.clickId, uid: context.uid ?? null }
    : null;

  const eventForPostback = {
    id: inserted.id,
    event_type: eventType,
    tg_id: tgId,
    created_at: new Date(),
  };

  await withEventError(`sendPostbackForEvent:${eventType}`, () =>
    sendPostbackForEvent({
      offer: offerForPostback,
      click: clickForPostback,
      event: eventForPostback,
    }),
  );

  console.log(`[EVENT] saved ${eventType} by ${tgId} for offer ${context.offerId}`);
}

async function ensureAdvertiserFromContext(ctx) {
  const from = ctx?.from;
  if (!from?.id) {
    return null;
  }

  try {
    return await upsertAdvertiser({
      tgId: from.id,
      username: from.username ?? null,
      firstName: from.first_name ?? null,
      lastName: from.last_name ?? null,
    });
  } catch (error) {
    console.error('[advertiser] failed to upsert', error?.message || error);
    return null;
  }
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatStarsFromCents(cents) {
  const stars = Math.round(safeNumber(cents) / 100);
  return `${stars}⭐`;
}

function formatCurrencyFromCents(cents) {
  const amount = safeNumber(cents) / 100;
  return `${amount.toFixed(2)} ₽`;
}

function formatAdvertiserLabel(row, fallbackId) {
  if (!row) {
    return fallbackId != null ? `tg:${fallbackId}` : '-';
  }

  let label = null;
  if (row.contact) {
    label = row.contact;
  } else if (row.username) {
    label = `@${row.username}`;
  } else {
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
    if (name) {
      label = name;
    }
  }

  if (!label || !label.trim()) {
    label = fallbackId != null ? `tg:${fallbackId}` : '-';
  }

  if (row.blocked) {
    label = `🚫 ${label}`;
  }

  return label;
}

function detectStartEventsFromValue(value, source) {
  if (typeof value !== 'string' || !value) {
    return [];
  }

  const normalized = value.toLowerCase();
  const events = [];

  if (normalized.includes('app_start')) {
    events.push({
      type: 'miniapp_start',
      payload: {
        source,
        value,
      },
    });
  }

  if (normalized.includes('extbot_start')) {
    events.push({
      type: 'external_bot_start',
      payload: {
        source,
        value,
      },
    });
  }

  return events;
}

function detectStartEventsFromMessage(message) {
  const entries = [];
  if (!message) {
    return entries;
  }

  const sources = [
    ['text', message.text],
    ['caption', message.caption],
    ['web_app_data', message.web_app_data?.data],
    ['start_payload', message.start_param],
  ];

  const seen = new Set();
  for (const [source, value] of sources) {
    for (const entry of detectStartEventsFromValue(value, source)) {
      if (seen.has(entry.type)) continue;
      seen.add(entry.type);
      entries.push(entry);
    }
  }

  return entries;
}

// ─── admin команды ────────────────────────────────────────────────────────────

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, delta) {
  const d = new Date(date);
  d.setDate(d.getDate() + delta);
  return d;
}

function parseStatAdmRange(raw) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const defaultRange = { start: todayStart, end: addDays(todayStart, 1), label: 'today' };

  if (!raw) {
    return defaultRange;
  }

  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized === 'today') {
    return defaultRange;
  }

  if (normalized === '7d' || normalized === '7') {
    const start = addDays(todayStart, -6);
    return { start, end: addDays(todayStart, 1), label: '7d' };
  }

  if (normalized === '30d' || normalized === '30') {
    const start = addDays(todayStart, -29);
    return { start, end: addDays(todayStart, 1), label: '30d' };
  }

  const matches = normalized.match(/\d{4}-\d{2}-\d{2}/g) || [];
  if (matches.length === 0) {
    return defaultRange;
  }

  const startDate = startOfDay(matches[0]);
  const endDate = matches.length > 1 ? startOfDay(matches[1]) : startDate;

  const [from, to] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
  return { start: from, end: addDays(to, 1), label: `${matches[0]}..${matches[matches.length - 1]}` };
}

function formatDateForDisplay(value) {
  if (!value) return '-';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }
    return date.toISOString().slice(0, 10);
  } catch {
    return '-';
  }
}

bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.reply('403');
    return;
  }

  const lines = [
    '<b>Команды администратора</b>',
    '/ads — запустить мастер (стандартный или без оплаты)',
    '/myoffers — список офферов',
    '/statadm [today|7d|30d|YYYY-MM-DD YYYY-MM-DD] — статистика по офферам',
    '/pending — офферы без оплаты',
    '/ban &lt;tg_id&gt; — заблокировать рекламодателя',
    '/admin_offers — краткий список последних офферов',
    '/offer_status &lt;UUID&gt; &lt;status&gt; — смена статуса оффера',
  ];

  await replyHtml(ctx, lines.join('\n'));
});

bot.command('myoffers', async (ctx) => {
  logUpdate(ctx, 'myoffers');
  const fromId = ctx.from?.id;
  if (fromId == null) {
    await replyHtml(ctx, 'Не удалось определить ваш Telegram ID.');
    return;
  }

  const admin = isAdmin(ctx);
  let offers;
  try {
    offers = admin ? await listAllOffers(200) : await listOffersByOwner(fromId);
  } catch (error) {
    console.error('[MYOFFERS] list error:', error?.message || error);
    await replyHtml(ctx, 'Не удалось получить список офферов.');
    return;
  }

  if (!offers?.length) {
    await replyHtml(ctx, admin ? 'Офферов нет.' : 'У вас пока нет офферов.');
    return;
  }

  const ownerMap = new Map();
  if (admin) {
    const ownerIds = Array.from(
      new Set(
        offers
          .map((offer) => (offer.created_by_tg_id != null ? String(offer.created_by_tg_id) : null))
          .filter(Boolean),
      ),
    );
    if (ownerIds.length) {
      try {
        const owners = await listAdvertisersByIds(ownerIds);
        for (const owner of owners) {
          ownerMap.set(String(owner.tg_id), owner);
        }
      } catch (error) {
        console.error('[MYOFFERS] advertisers load error:', error?.message || error);
      }
    }
  } else {
    const advertiser = await ensureAdvertiserFromContext(ctx);
    ownerMap.set(String(fromId), advertiser ?? null);
  }

  const lines = offers.map((offer) => {
    const slug = offer.slug || offer.id;
    const status = offer.status || 'draft';
    const payout = formatStarsFromCents(offer.payout_cents ?? 0);
    const budget = formatStarsFromCents(offer.budget_cents ?? 0);
    const paid = formatStarsFromCents(offer.paid_cents ?? 0);
    const ownerLabel = admin
      ? formatAdvertiserLabel(ownerMap.get(String(offer.created_by_tg_id)), offer.created_by_tg_id)
      : 'вы';

    const parts = [
      `• <b>${escapeHtml(slug)}</b> — ${escapeHtml(status)}`,
      `  payout: <code>${escapeHtml(payout)}</code>, бюджет: <code>${escapeHtml(budget)}</code>, оплачено: <code>${escapeHtml(paid)}</code>`,
    ];

    if (admin) {
      parts.push(`  владелец: <code>${escapeHtml(ownerLabel)}</code>`);
    }

    return parts.join('\n');
  });

  await replyHtml(ctx, lines.join('\n\n'));
});

bot.command('statadm', async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.reply('403');
    return;
  }

  const raw = (ctx.message?.text || '').replace(/^\/statadm(@\w+)?/i, '').trim();
  const range = parseStatAdmRange(raw);
  const params = [range.start, range.end];

  let stats;
  try {
    const res = await query(
      `
      WITH click_stats AS (
        SELECT offer_id, COUNT(*)::bigint AS clicks
          FROM clicks
         WHERE ($1::timestamptz IS NULL OR created_at >= $1)
           AND ($2::timestamptz IS NULL OR created_at < $2)
         GROUP BY offer_id
      ),
      event_stats AS (
        SELECT offer_id,
               COUNT(*)::bigint AS conversions,
               COUNT(*) FILTER (WHERE is_premium) AS premium_conversions
          FROM events
         WHERE ($1::timestamptz IS NULL OR created_at >= $1)
           AND ($2::timestamptz IS NULL OR created_at < $2)
         GROUP BY offer_id
      ),
      spend_stats AS (
        SELECT offer_id, COALESCE(SUM(amount_cents), 0)::bigint AS spend_cents
          FROM conversions
         WHERE ($1::timestamptz IS NULL OR created_at >= $1)
           AND ($2::timestamptz IS NULL OR created_at < $2)
         GROUP BY offer_id
      )
      SELECT
        o.id,
        o.slug,
        o.created_at,
        o.budget_cents,
        o.paid_cents,
        o.created_by_tg_id,
        a.username,
        a.first_name,
        a.last_name,
        a.contact,
        a.blocked,
        COALESCE(cs.clicks, 0) AS clicks,
        COALESCE(es.conversions, 0) AS conversions,
        COALESCE(es.premium_conversions, 0) AS premium_conversions,
        COALESCE(ss.spend_cents, 0) AS spend_cents
      FROM offers o
      LEFT JOIN click_stats cs ON cs.offer_id = o.id
      LEFT JOIN event_stats es ON es.offer_id = o.id
      LEFT JOIN spend_stats ss ON ss.offer_id = o.id
      LEFT JOIN advertisers a ON a.tg_id = o.created_by_tg_id
      WHERE (
        COALESCE(cs.clicks, 0) > 0
        OR COALESCE(es.conversions, 0) > 0
        OR COALESCE(es.premium_conversions, 0) > 0
        OR COALESCE(ss.spend_cents, 0) > 0
        OR (($1::timestamptz IS NOT NULL AND o.created_at >= $1) AND ($2::timestamptz IS NULL OR o.created_at < $2))
      )
      ORDER BY o.created_at DESC
      LIMIT 200
    `,
      params,
    );
    stats = res.rows;
  } catch (error) {
    console.error('[STATADM] query error:', error?.message || error);
    await replyHtml(ctx, 'Не удалось получить статистику.');
    return;
  }

  if (!stats?.length) {
    const fromText = formatDateForDisplay(range.start);
    const toText = formatDateForDisplay(addDays(range.end, -1));
    await replyHtml(ctx, `Нет данных за период ${escapeHtml(fromText)} — ${escapeHtml(toText)}.`);
    return;
  }

  const rows = stats.map((row) => {
    const clicks = safeNumber(row.clicks);
    const conversions = safeNumber(row.conversions);
    const premium = safeNumber(row.premium_conversions);
    const spendCents = safeNumber(row.spend_cents);
    const budgetCents = safeNumber(row.budget_cents);
    const balanceCents = budgetCents - spendCents;

    return {
      contact: formatAdvertiserLabel(row, row.created_by_tg_id),
      start: formatDateForDisplay(row.created_at),
      slug: row.slug || row.id,
      clicks,
      conversions,
      premium,
      spendCents,
      balanceCents,
      budgetCents,
    };
  });

  const totals = rows.reduce(
    (acc, row) => {
      acc.clicks += row.clicks;
      acc.conversions += row.conversions;
      acc.premium += row.premium;
      acc.spendCents += row.spendCents;
      acc.budgetCents += row.budgetCents;
      return acc;
    },
    { clicks: 0, conversions: 0, premium: 0, spendCents: 0, budgetCents: 0 },
  );

  const tableRows = rows.map((row) => ({
    contact: row.contact,
    start: row.start,
    slug: row.slug,
    clicks: String(row.clicks),
    conversions: String(row.conversions),
    premium: String(row.premium),
    cost: formatCurrencyFromCents(row.spendCents),
    balance: formatCurrencyFromCents(row.balanceCents),
  }));

  tableRows.push({
    contact: 'Итого',
    start: '',
    slug: '',
    clicks: String(totals.clicks),
    conversions: String(totals.conversions),
    premium: String(totals.premium),
    cost: formatCurrencyFromCents(totals.spendCents),
    balance: formatCurrencyFromCents(totals.budgetCents - totals.spendCents),
  });

  const columns = [
    { key: 'contact', label: 'контакт', align: 'left' },
    { key: 'start', label: 'старт', align: 'left' },
    { key: 'slug', label: 'slug', align: 'left' },
    { key: 'clicks', label: 'клики', align: 'right' },
    { key: 'conversions', label: 'цд', align: 'right' },
    { key: 'premium', label: 'цд прем', align: 'right' },
    { key: 'cost', label: 'стоимость', align: 'right' },
    { key: 'balance', label: 'остаток', align: 'right' },
  ];

  const widths = columns.reduce((acc, column) => {
    const values = tableRows.map((row) => row[column.key] ?? '');
    const maxLength = Math.max(column.label.length, ...values.map((value) => String(value).length));
    acc[column.key] = Math.min(maxLength, 48);
    return acc;
  }, {});

  const formatRow = (row) =>
    columns
      .map((column) => {
        const rawValue = String(row[column.key] ?? '');
        const width = widths[column.key];
        if (column.align === 'right') {
          return rawValue.padStart(width);
        }
        return rawValue.padEnd(width);
      })
      .join('  ');

  const headerRow = formatRow(Object.fromEntries(columns.map((column) => [column.key, column.label])));
  const separatorRow = headerRow.replace(/./g, '─');
  const bodyRows = tableRows.map((row) => formatRow(row));

  const periodFrom = formatDateForDisplay(range.start);
  const periodTo = formatDateForDisplay(addDays(range.end, -1));
  const tableText = [headerRow, separatorRow, ...bodyRows].join('\n');

  const message =
    `<b>Статистика офферов</b> (${escapeHtml(periodFrom)} — ${escapeHtml(periodTo)})\n` +
    `<pre>${escapeHtml(tableText)}</pre>`;

  await replyHtml(ctx, message);
});

bot.command('pending', async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.reply('403');
    return;
  }

  let rows;
  try {
    const res = await query(
      `
      SELECT
        o.id,
        o.slug,
        o.status,
        o.budget_cents,
        o.paid_cents,
        o.created_by_tg_id,
        a.username,
        a.first_name,
        a.last_name,
        a.contact,
        a.blocked
      FROM offers o
      LEFT JOIN advertisers a ON a.tg_id = o.created_by_tg_id
      WHERE COALESCE(o.budget_cents, 0) > 0
        AND COALESCE(o.paid_cents, 0) < COALESCE(o.budget_cents, 0)
      ORDER BY o.created_at DESC
      LIMIT 100
    `,
      [],
    );
    rows = res.rows;
  } catch (error) {
    console.error('[PENDING] query error:', error?.message || error);
    await replyHtml(ctx, 'Не удалось получить список офферов.');
    return;
  }

  if (!rows?.length) {
    await replyHtml(ctx, 'Нет неподтверждённых офферов.');
    return;
  }

  const lines = rows.map((row) => {
    const slug = row.slug || row.id;
    const status = row.status || 'draft';
    const budget = formatStarsFromCents(row.budget_cents ?? 0);
    const paid = formatStarsFromCents(row.paid_cents ?? 0);
    const remainingCents = Math.max(0, safeNumber(row.budget_cents) - safeNumber(row.paid_cents));
    const balanceStars = formatStarsFromCents(remainingCents);
    const owner = formatAdvertiserLabel(row, row.created_by_tg_id);

    return (
      `• <b>${escapeHtml(slug)}</b> — ${escapeHtml(status)}\n` +
      `  владелец: <code>${escapeHtml(owner)}</code>\n` +
      `  бюджет: <code>${escapeHtml(budget)}</code>, оплачено: <code>${escapeHtml(paid)}</code>, остаток: <code>${escapeHtml(balanceStars)}</code>`
    );
  });

  await replyHtml(ctx, lines.join('\n\n'));
});

bot.command('ban', async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.reply('403');
    return;
  }

  const raw = (ctx.message?.text || '').replace(/^\/ban(@\w+)?/i, '').trim();
  if (!raw) {
    await replyHtml(ctx, 'Использование: /ban &lt;tg_id&gt;');
    return;
  }

  const targetId = raw.split(/\s+/)[0];
  if (!/^\d{1,20}$/.test(targetId)) {
    await replyHtml(ctx, 'Укажите Telegram ID цифрами.');
    return;
  }

  try {
    await setAdvertiserBlocked(targetId, true);
    const advertiser = await getAdvertiser(targetId);
    const label = formatAdvertiserLabel(advertiser, targetId);
    await replyHtml(ctx, `Пользователь <code>${escapeHtml(label)}</code> заблокирован.`);
  } catch (error) {
    console.error('[BAN] failed:', error?.message || error);
    await replyHtml(ctx, 'Не удалось заблокировать пользователя.');
  }
});

bot.command('admin_offers', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('403');
  }

  const list = await listAllOffers(15);
  if (!list.length) {
    return ctx.reply('Нет офферов');
  }

  const lines = list
    .map((o) => {
      const payoutStars = Math.round((o.payout_cents ?? 0) / 100);
      const budgetStars = Math.round((o.budget_cents ?? 0) / 100);
      const caps = o.caps_total ?? '-';
      const geo = o.geo || 'ANY';
      const status = o.status || 'draft';
      return (
        `• <b>${o.slug}</b> — ${o.event_type}\n` +
        `  payout: <code>${payoutStars}⭐</code>, caps: <code>${caps}</code>, budget: <b>${budgetStars}⭐</b>\n` +
        `  geo: <code>${geo}</code>, status: <code>${status}</code>`
      );
    })
    .join('\n\n');

  return ctx.reply(lines, { parse_mode: 'HTML', disable_web_page_preview: true });
});

bot.command('offer_status', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const m = (ctx.message?.text || '').match(
    /^\/offer_status\s+([0-9a-f-]{36})\s+(active|paused|stopped|draft)$/i,
  );
  if (!m) {
    await replyHtml(ctx, 'Формат: /offer_status <UUID> <active|paused|stopped|draft>');
    return;
  }
  const [, id, st] = m;
  const r = await query(
    `UPDATE offers SET status=$2 WHERE id=$1 RETURNING id,status`,
    [id, st.toLowerCase()],
  );
  if (!r.rowCount) return ctx.reply('Не найдено');
  await ctx.reply(`OK: ${r.rows[0].id} → ${r.rows[0].status}`);
});

// ─── Stars billing helpers ────────────────────────────────────────────────────

let offersColumnsPromise;
async function getOfferColumns() {
  if (!offersColumnsPromise) {
    offersColumnsPromise = query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'offers'`,
    ).then((res) => new Set(res.rows.map((row) => row.column_name)));
  }
  return offersColumnsPromise;
}

export function logUpdate(ctx, tag = 'update') {
  const update = ctx.update || {};
  console.log('[tg]', tag, {
    types: Object.keys(update),
    from: ctx.from ? { id: ctx.from.id, is_bot: ctx.from.is_bot } : null,
    text: ctx.message?.text,
    entities: ctx.message?.entities,
    startPayload: ctx.startPayload,
  });
}

registerStatHandlers(bot, { logUpdate, enableCommand: false });

// сброс ожиданий при слэш-командах
bot.use(async (ctx, next) => {
  const text = ctx.message?.text ?? '';
  if (typeof text === 'string' && text.trimStart().startsWith('/')) {
    if (ctx.session) {
      delete ctx.session.awaiting;
      delete ctx.session.mode;
      delete ctx.session.target_link;
      delete ctx.session.raw_target_link;
    }
  }
  return next();
});

// ─── команды и обработчики ────────────────────────────────────────────────────

const JOIN_GROUP_EVENT = 'join_group';

async function linkAttributionRow({ clickId, offerId, uid, tgId }) {
  const normalizedUid = uid ?? null;
  const params = [clickId, offerId, normalizedUid, tgId];
  const insertSql = `
    INSERT INTO attribution (click_id, offer_id, uid, tg_id, state)
    VALUES ($1, $2, $3, $4, 'started')
    ON CONFLICT (click_id, tg_id) DO UPDATE
      SET offer_id = EXCLUDED.offer_id,
          uid = EXCLUDED.uid,
          state = EXCLUDED.state,
          created_at = NOW()
  `;

  let linked = false;
  try {
    await query(insertSql, params);
    linked = true;
  } catch (error) {
    if (error?.code !== '42P10' && error?.code !== '42704') {
      throw error;
    }
  }

  let updated = false;
  try {
    const res = await query(
      `UPDATE attribution SET offer_id=$2, uid=$3, state='started', created_at=NOW()
       WHERE click_id=$1 AND tg_id=$4`,
      params,
    );
    updated = res.rowCount > 0;
  } catch (updateError) {
    if (updateError?.code !== '42703') {
      throw updateError;
    }
    const res = await query(
      `UPDATE attribution SET offer_id=$2, uid=$3, state='started'
       WHERE click_id=$1 AND tg_id=$4`,
      params,
    );
    updated = res.rowCount > 0;
  }

  if (!updated) {
    await query(
      `INSERT INTO attribution (click_id, offer_id, uid, tg_id, state)
       VALUES ($1, $2, $3, $4, 'started')`,
      params,
    );
    linked = true;
  }

  if (linked || updated) {
    await propagateSuspectAttributionMeta({ clickId, offerId, tgId });
    console.log('[ATTR] linked', {
      offer_id: offerId,
      click_id: clickId,
      tg_id: tgId,
    });
  }
}

bot.start(async (ctx) => {
  logUpdate(ctx, 'start');
  const payload = typeof ctx.startPayload === 'string' ? ctx.startPayload.trim() : '';

  if (payload) {
    await handleStartWithToken(ctx, payload);
    return;
  }

  const admin = isAdmin(ctx);
  const message = buildAdvertiserHelpMessage(admin);
  await replyHtml(ctx, message);
});

const ADMIN_ADS_CALLBACK_PREFIX = 'admin_ads:';
const ADMIN_ADS_STANDARD = `${ADMIN_ADS_CALLBACK_PREFIX}standard`;
const ADMIN_ADS_SKIP = `${ADMIN_ADS_CALLBACK_PREFIX}skip`;

bot.command('ads', async (ctx) => {
  logUpdate(ctx, 'ads');

  const advertiser = await ensureAdvertiserFromContext(ctx);
  if (advertiser?.blocked) {
    await replyHtml(ctx, '⛔️ Ваша учётная запись заблокирована. Обратитесь к администратору.');
    return;
  }

  if (isAdmin(ctx)) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Стандартный мастер', ADMIN_ADS_STANDARD)],
      [Markup.button.callback('Создать без оплаты', ADMIN_ADS_SKIP)],
    ]);
    await replyHtml(ctx, 'Выберите режим создания оффера:', { reply_markup: keyboard });
    return;
  }

  try {
    await startAdsWizard(ctx);
    console.log('[ADS] wizard started');
  } catch (error) {
    console.error('[ADS] start error:', error?.message || error);
    await replyHtml(ctx, 'Не удалось запустить мастер: <code>' + escapeHtml(error?.message || error) + '</code>');
  }
});

bot.command('list', async (ctx) => {
  logUpdate(ctx, 'list');
  const admin = isAdmin(ctx);
  const userCommands = renderCommandList(ADVERTISER_COMMANDS);
  const adminSection = admin ? '\n\n⚙️ Команды администратора:\n' + renderCommandList(ADMIN_COMMANDS) : '';
  await replyHtml(ctx, `📋 Доступные команды:\n${userCommands}${adminSection}`);
});

bot.command('admin', async (ctx) => {
  logUpdate(ctx, 'admin');
  if (!isAdmin(ctx)) {
    await replyHtml(ctx, '⛔️ Команда доступна только администраторам.');
    return;
  }
  await replyHtml(ctx, buildAdminHelpMessage());
});

bot.command('myoffers', async (ctx) => {
  logUpdate(ctx, 'myoffers');
  const tgId = ctx.from?.id;
  if (!tgId) {
    await replyHtml(ctx, 'Не удалось определить ваш Telegram ID. Попробуйте позже.');
    return;
  }

  const offers = await buildAdvertiserSummary(tgId);
  const message = buildMyOffersDetailed(offers);
  await replyHtml(ctx, message);
});

bot.command('my_offers', async (ctx) => {
  logUpdate(ctx, 'my_offers');
  const tgId = ctx.from?.id;
  if (!tgId) {
    await replyHtml(ctx, 'Не удалось определить ваш Telegram ID. Попробуйте позже.');
    return;
  }

  const offers = await buildAdvertiserPeriodStats(tgId);
  const message = buildMyOffersCompact(offers);
  await replyHtml(ctx, message);
});

bot.command('offer', async (ctx) => {
  logUpdate(ctx, 'offer');
  const text = ctx.message?.text || '';
  const match = text.match(/^\/offer(?:@[\w_]+)?\s+(.+)$/i);
  if (!match) {
    await replyHtml(ctx, 'Использование: <code>/offer &lt;slug&gt;</code>.');
    return;
  }

  const slug = match[1].trim();
  if (!slug) {
    await replyHtml(ctx, 'Укажите slug оффера: <code>/offer &lt;slug&gt;</code>.');
    return;
  }

  const tgId = ctx.from?.id;
  const allowAdmin = isAdmin(ctx);
  if (!tgId && !allowAdmin) {
    await replyHtml(ctx, 'Не удалось определить ваш Telegram ID. Попробуйте позже.');
    return;
  }

  try {
    const offer = await fetchOfferDetail({ slug, tgId, allowAdmin });
    if (!offer) {
      await replyHtml(ctx, 'Оффер не найден или у вас нет прав на просмотр.');
      return;
    }

    const caps = formatCaps(offer.caps_total);
    const message = [
      `📄 Оффер <b>${offer.slug}</b>`,
      `Название: <b>${offer.title}</b>`,
      `Тип ЦД: <code>${offer.event_type}</code>`,
      `Дата старта: <code>${formatDate(offer.created_at)}</code>`,
      `Статус: <code>${offer.status}</code>`,
      `Payout: <code>${centsToCurrency(offer.payout_cents)}</code>`,
      `Лимит: <code>${caps}</code>`,
      `ЦД всего: <code>${offer.conversions_total ?? 0}</code>, премиум: <code>${offer.premium_total ?? 0}</code>`,
      `Потрачено: <code>${centsToCurrency(offer.spent_total_cents)}</code>`,
      `Остаток бюджета: <code>${centsToCurrency(offer.budget_left_cents)}</code>`,
      '',
      `Трекинг: <code>${offer.tracking_url}</code>`,
      '',
      'Завести ещё /ads или открыть список /list',
    ].join('\n');

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('Создать копию', `offer:copy:${offer.slug}`),
        Markup.button.callback('Изменить лимит', `offer:limit:${offer.slug}`),
      ],
    ]);

    await replyHtml(ctx, message, { reply_markup: keyboard });
  } catch (error) {
    console.error('[offer] detail error', error?.message || error);
    await replyHtml(ctx, 'Не удалось получить информацию об оффере. Попробуйте позже.');
  }
});

bot.action(/^offer:(copy|limit):(.+)$/i, async (ctx) => {
  const [, action, slug] = ctx.match || [];
  await ctx.answerCbQuery();
  if (!slug) {
    await replyHtml(ctx, 'Некорректный оффер.');
    return;
  }
  const actionText = action === 'copy' ? 'создания копии' : 'изменения лимита';
  await replyHtml(
    ctx,
    `Функция ${actionText} будет доступна позже. Пожалуйста, обратитесь к администратору или используйте /ads для нового оффера.`,
  );
});

bot.command('stat', async (ctx) => {
  logUpdate(ctx, 'stat:custom');
  const tgId = ctx.from?.id;
  if (!tgId) {
    await replyHtml(ctx, 'Не удалось определить ваш Telegram ID. Попробуйте позже.');
    return;
  }

  const text = ctx.message?.text || '';
  const args = text.split(/\s+/).slice(1).filter(Boolean);

  const buildResponse = async (range) => {
    const offers = await buildAdvertiserPeriodStats(tgId, range);
    return buildStatsSection(range, offers);
  };

  if (!args.length) {
    const periods = ['today', '7d', '30d'].map((key) => toRangeBoundaries(key));
    const sections = [];
    for (const period of periods) {
      if (!period) continue;
      sections.push(await buildResponse(period));
    }
    sections.push('Для произвольного периода используйте <code>/stat YYYY-MM-DD YYYY-MM-DD</code>.');
    await replyHtml(ctx, sections.join('\n\n'));
    return;
  }

  let range;
  if (args.length === 1) {
    const key = args[0].toLowerCase();
    range = toRangeBoundaries(key);
    if (!range) {
      range = toRangeBoundaries('custom', args[0], args[0]);
    }
  } else {
    if (args[0].toLowerCase() === 'custom' && args.length >= 3) {
      range = toRangeBoundaries('custom', args[1], args[2]);
    } else {
      range = toRangeBoundaries('custom', args[0], args[1]);
    }
  }

  if (!range) {
    await replyHtml(ctx, 'Не удалось распознать период. Используйте формат <code>/stat 2024-01-01 2024-01-31</code>.');
    return;
  }

  const section = await buildResponse(range);
  await replyHtml(ctx, section);
});

bot.command('statadm', async (ctx) => {
  logUpdate(ctx, 'statadm');
  if (!isAdmin(ctx)) {
    await replyHtml(ctx, '⛔️ Команда доступна только администраторам.');
    return;
  }

  const text = ctx.message?.text || '';
  const args = text.split(/\s+/).slice(1).filter(Boolean);

  let range = null;
  if (!args.length) {
    range = toRangeBoundaries('7d');
  } else if (args.length === 1) {
    range = toRangeBoundaries(args[0].toLowerCase());
    if (!range) {
      range = toRangeBoundaries('custom', args[0], args[0]);
    }
  } else {
    if (args[0].toLowerCase() === 'custom' && args.length >= 3) {
      range = toRangeBoundaries('custom', args[1], args[2]);
    } else {
      range = toRangeBoundaries('custom', args[0], args[1]);
    }
  }

  if (!range) {
    await replyHtml(ctx, 'Укажите период: <code>/statadm today</code>, <code>/statadm 7d</code> или <code>/statadm YYYY-MM-DD YYYY-MM-DD</code>.');
    return;
  }

  const offers = await buildAdminPeriodStats(range);
  const message = buildAdminStatsSection(range, offers);
  await replyHtml(ctx, message);
});

bot.command('pending', async (ctx) => {
  logUpdate(ctx, 'pending');
  if (!isAdmin(ctx)) {
    await replyHtml(ctx, '⛔️ Команда доступна только администраторам.');
    return;
  }

  const pendingOffers = await fetchPendingOffers();
  if (!pendingOffers.length) {
    await replyHtml(ctx, 'Подвисших офферов без оплаты нет.');
    return;
  }

  const lines = pendingOffers.map((offer) => {
    const contact = buildContactLink(offer.owner_id);
    const budget = centsToCurrency(offer.budget_cents);
    const paid = centsToCurrency(offer.paid_cents);
    return (
      `• ${contact} — <b>${offer.slug}</b> (${formatDate(offer.created_at)})\n` +
      `  бюджет: <code>${budget}</code>, оплачено: <code>${paid}</code>, статус: <code>${offer.status}</code>`
    );
  });

  await replyHtml(ctx, ['🕒 Подвисшие офферы без оплаты:', ...lines].join('\n'));
});

export async function handleStartWithToken(ctx, rawToken) {
  const tgId = ctx.from?.id;
  const token = rawToken?.trim();

  if (!tgId) {
    console.warn('[tg] missing from.id on start token', { token });
    await replyHtml(ctx, 'Не удалось определить ваш Telegram ID. Попробуйте ещё раз позже.');
    return;
  }

  if (!token || !/^[A-Za-z0-9_-]{1,64}$/.test(token)) {
    await replyHtml(
      ctx,
      '⛔️ Неверный токен. Сгенерируйте новую ссылку или используйте <code>/claim &lt;TOKEN&gt;</code>.',
    );
    return;
  }

  const res = await query(
    `
    SELECT c.id, c.offer_id, c.uid, o.target_url, o.event_type
    FROM clicks c JOIN offers o ON o.id=c.offer_id
    WHERE c.start_token=$1
    LIMIT 1
  `,
    [token],
  );

  if (!res.rowCount) {
    await replyHtml(ctx, '⛔️ Ссылка устарела или неверна. Сгенерируйте новую через <code>/ads</code>.');
    return;
  }

  const click = res.rows[0];
  const { offer_id, uid, target_url, event_type } = click;

  const update = await query(
    `UPDATE clicks SET tg_id=$1, used_at=NOW() WHERE id=$2 AND (tg_id IS NULL OR tg_id=$1)`,
    [tgId, click.id],
  );
  if (!update.rowCount) {
    console.warn('[tg] start token already used', { token, tgId });
    await replyHtml(ctx, '⛔️ Ссылка уже использована другим пользователем.');
    return;
  }

  try {
    await attribution.upsertAttribution({
      user_id: tgId,
      offer_id,
      uid: uid ?? '',
      tg_id: tgId,
      click_id: click.id,
    });
  } catch (error) {
    console.error('[ATTR] failed to upsert', error?.message || error, {
      click_id: click.id,
      offer_id,
      tg_id: tgId,
    });
  }

  if (event_type === JOIN_GROUP_EVENT && target_url) {
    await replyHtml(
      ctx,
      'Нажмите, чтобы вступить в группу. После вступления зафиксируем событие:',
      {
        reply_markup: { inline_keyboard: [[{ text: '✅ Вступить в группу', url: target_url }]] },
      },
    );
    await replyHtml(ctx, 'Новая задача доступна: /ads');
    return;
  }

  await replyHtml(ctx, 'Новая задача доступна: /ads');
}

export async function handleClaimCommand(ctx) {
  logUpdate(ctx, 'claim');
  const text = ctx.message?.text ?? '';
  const match = typeof text === 'string' ? text.match(/^\/claim(?:@[\w_]+)?\s+(\S+)/i) : null;

  if (!match) {
    await replyHtml(ctx, 'Пришлите токен командой: <code>/claim &lt;TOKEN&gt;</code>');
    return;
  }

  const token = match[1];
  return handleStartWithToken(ctx, token);
}

bot.command('claim', handleClaimCommand);

bot.hears(/^\/go\s+([0-9a-f-]{36})(?:\s+(\S+))?$/i, async (ctx) => {
  logUpdate(ctx, 'go');
  const tgId = ctx.from?.id;
  if (!tgId) {
    await replyHtml(ctx, 'Не удалось определить ваш Telegram ID. Попробуйте ещё раз позже.');
    return;
  }

  const offerId = ctx.match[1];
  const uid = ctx.match[2] || 'qa';

  const offer = await query(
    `SELECT id, target_url, event_type FROM offers WHERE id=$1 LIMIT 1`,
    [offerId],
  );
  if (!offer.rowCount) {
    await replyHtml(ctx, '⛔️ Оффер не найден.');
    return;
  }

  let token = shortToken().slice(0, 32);
  for (let attempts = 0; attempts < 4; attempts += 1) {
    const exists = await query(`SELECT 1 FROM clicks WHERE start_token=$1 LIMIT 1`, [token]);
    if (!exists.rowCount) break;
    token = shortToken().slice(0, 32);
  }

  const clickId = uuid();
  try {
    await query(
      `INSERT INTO clicks (id, offer_id, uid, start_token, created_at, tg_id)
       VALUES ($1,$2,$3,$4,NOW(),$5)`,
      [clickId, offerId, uid, token, tgId],
    );
  } catch (error) {
    if (error?.code === '23505') {
      console.error('duplicate start_token on /go', { token, offerId, uid, tgId });
      await replyHtml(ctx, '⚠️ Не удалось сгенерировать токен. Попробуйте ещё раз.');
      return;
    }
    throw error;
  }

  await handleStartWithToken(ctx, token);
});

bot.command('whoami', async (ctx) => {
  try {
    await replyHtml(ctx, 'Ваш Telegram ID: <code>' + escapeHtml(ctx.from?.id ?? 'unknown') + '</code>');
  } catch (error) {
    console.error('whoami send error', error);
  }
});

bot.command('help', async (ctx) => {
  await replyHtml(
    ctx,
    'Все офферы открываются через кнопку WebApp. Если ничего не произошло — отправьте <code>/claim &lt;TOKEN&gt;</code> из вашей ссылки.',
  );
});

bot.command('cancel', async (ctx) => {
  if (ctx.scene?.current) {
    try {
      await ctx.scene.leave();
    } catch (error) {
      console.error('cancel command leave error', error?.message || error);
    }
  }
  if (ctx.session) {
    delete ctx.session.awaiting;
    delete ctx.session.mode;
    delete ctx.session.target_link;
    delete ctx.session.raw_target_link;
  }
  try {
    await replyHtml(ctx, 'Мастер прерван. Можно начать заново: <code>/ads</code>');
  } catch (error) {
    console.error('cancel command reply error', error?.message || error);
  }
});

// ─── Telegram event tracking ──────────────────────────────────────────────────

bot.on('chat_member', async (ctx) => {
  logUpdate(ctx, 'chat_member');
  const update = ctx.update?.chat_member;
  const newMember = update?.new_chat_member;
  const user = newMember?.user;
  const status = newMember?.status;

  if (!user || status !== 'member') {
    return;
  }

  const payload = {
    source: 'telegram.chat_member',
    chat_id: update?.chat?.id ?? null,
    chat_type: update?.chat?.type ?? null,
    inviter_id: update?.from?.id ?? null,
    status,
  };

  const { click_id: attrClickId, offer_id, uid } = res.rows[0];
  const existing = await query(
    `SELECT id FROM events WHERE offer_id=$1 AND tg_id=$2 AND event_type=$3 LIMIT 1`,
    [offer_id, tgId, JOIN_GROUP_EVENT],
  );
  let eventId;

  if (existing.rowCount) {
    eventId = existing.rows[0].id;
    await query(`UPDATE attribution SET state='converted' WHERE click_id=$1`, [attrClickId]);
    console.log('[EVENT] saved', { event_id: eventId, event_type: JOIN_GROUP_EVENT, offer_id, tg_id: tgId });
    return;
  }

  const inserted = await query(
    `INSERT INTO events(offer_id, tg_id, event_type) VALUES($1,$2,$3) RETURNING id`,
    [offer_id, tgId, JOIN_GROUP_EVENT],
  );
  eventId = inserted.rows[0]?.id;
  console.log('[EVENT] saved', { event_id: eventId, event_type: JOIN_GROUP_EVENT, offer_id, tg_id: tgId });

  const updated = await query(`UPDATE attribution SET state='converted' WHERE click_id=$1`, [attrClickId]);
  await withEventError('handleEvent:join_group', () =>
    handleEvent(ctx, 'join_group', payload, { tgId: user.id }),
  );
});

bot.on('chat_join_request', async (ctx) => {
  logUpdate(ctx, 'chat_join_request');
  const request = ctx.update?.chat_join_request;
  const user = request?.from;

  if (!user) {
    return;
  }

  const payload = {
    source: 'telegram.chat_join_request',
    chat_id: request?.chat?.id ?? null,
    chat_type: request?.chat?.type ?? null,
    invite_link: request?.invite_link?.invite_link ?? null,
  };

  const chatId = request?.chat?.id;
  if (chatId != null && ctx.telegram?.approveChatJoinRequest) {
    await withEventError('approveChatJoinRequest', () =>
      ctx.telegram.approveChatJoinRequest(chatId, user.id),
    );
  }

  await withEventError('handleEvent:subscribe', () =>
    handleEvent(ctx, 'subscribe', payload, { tgId: user.id }),
  );
});

bot.on('message_reaction', async (ctx) => {
  const reaction = ctx.update?.message_reaction;
  const user = reaction?.user;

  if (!user) {
    return;
  }

  const payload = {
    source: 'telegram.message_reaction',
    chat_id: reaction?.chat?.id ?? null,
    chat_type: reaction?.chat?.type ?? null,
    message_id: reaction?.message_id ?? null,
    new_reaction: reaction?.new_reaction ?? null,
    old_reaction: reaction?.old_reaction ?? null,
  };

  await withEventError('handleEvent:reaction', () =>
    handleEvent(ctx, 'reaction', payload, { tgId: user.id }),
  );
});

bot.on('poll_answer', async (ctx, next) => {
  const pollAnswer = ctx.pollAnswer ?? ctx.update?.poll_answer;
  const user = pollAnswer?.user;

  if (user) {
    const payload = {
      source: 'telegram.poll_answer',
      poll_id: pollAnswer?.poll_id ?? null,
      option_ids: Array.isArray(pollAnswer?.option_ids)
        ? pollAnswer.option_ids
        : [],
    };

    await withEventError('handleEvent:poll_vote', () =>
      handleEvent(ctx, 'poll_vote', payload, { tgId: user.id }),
    );
  }

  if (typeof next === 'function') {
    await withEventError('poll_answer.next', () => next());
  }
});

bot.on('message', async (ctx, next) => {
  const message = ctx.message;
  const events = [];

  if (message?.from?.id) {
    const commentTarget = message.reply_to_message;
    const isChannelReply =
      commentTarget?.sender_chat?.type === 'channel' ||
      commentTarget?.chat?.type === 'channel';

    if (isChannelReply) {
      events.push({
        type: 'comment',
        tgId: message.from.id,
        payload: {
          source: 'telegram.message.comment',
          chat_id: message?.chat?.id ?? null,
          chat_type: message?.chat?.type ?? null,
          message_id: message?.message_id ?? null,
          reply_to_message_id: commentTarget?.message_id ?? null,
          thread_id: message?.message_thread_id ?? null,
        },
      });
    }

    const botId = ctx.botInfo?.id;
    if (botId && message.forward_from?.id === botId) {
      events.push({
        type: 'share',
        tgId: message.from.id,
        payload: {
          source: 'telegram.message.share',
          chat_id: message?.chat?.id ?? null,
          chat_type: message?.chat?.type ?? null,
          message_id: message?.message_id ?? null,
          forward_from_message_id: message?.forward_from_message_id ?? null,
        },
      });
    }
  }

  const startEvents = detectStartEventsFromMessage(message);
  if (startEvents.length) {
    const tgId = message?.from?.id ?? ctx.from?.id ?? null;
    if (tgId) {
      for (const entry of startEvents) {
        events.push({
          type: entry.type,
          tgId,
          payload: {
            source: `telegram.message.${entry.payload.source}`,
            value: entry.payload.value ?? null,
          },
        });
      }
    }
  }

  for (const event of events) {
    await withEventError(`handleEvent:${event.type}`, () =>
      handleEvent(ctx, event.type, event.payload, { tgId: event.tgId }),
    );
  }

  if (typeof next === 'function') {
    await withEventError('message.next', () => next());
  }
});

bot.on('callback_query', async (ctx, next) => {
  const callback = ctx.callbackQuery;
  const data = callback?.data;
  const fromId = callback?.from?.id ?? null;

  if (fromId && typeof data === 'string' && data) {
    const startEntries = detectStartEventsFromValue(data, 'callback_data');
    for (const entry of startEntries) {
      await withEventError(`handleEvent:${entry.type}`, () =>
        handleEvent(
          ctx,
          entry.type,
          {
            source: `telegram.callback_query.${entry.payload.source}`,
            value: entry.payload.value ?? null,
          },
          { tgId: fromId },
        ),
      );
    }
  }

  if (typeof next === 'function') {
    await withEventError('callback_query.next', () => next());
  }
});

// платежи Stars
bot.on('pre_checkout_query', async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (e) {
    console.error('pre_checkout_query', e);
  }
});

bot.on('message', async (ctx, next) => {
  const sp = ctx.message?.successful_payment;
  if (!sp) return next?.();
  try {
    const offerId = sp.invoice_payload;
    const paidXtr = Number(sp.total_amount || 0);

    if (!offerId) {
      await ctx.reply('⚠️ Оплата получена, но оффер не найден. Свяжитесь с поддержкой.');
      return;
    }

    const columns = await getOfferColumns();

    const values = [offerId];
    const updateParts = [];
    const returning = ['id'];
    const increments = {};

    if (columns.has('paid_xtr')) {
      values.push(paidXtr);
      increments.paid_xtr = values.length;
      updateParts.push(`paid_xtr = COALESCE(paid_xtr,0) + $${values.length}`);
      returning.push('paid_xtr');
    }

    if (columns.has('paid_cents')) {
      const paidCents = paidXtr * 100;
      values.push(paidCents);
      increments.paid_cents = values.length;
      updateParts.push(`paid_cents = COALESCE(paid_cents,0) + $${values.length}`);
      returning.push('paid_cents');
    }

    if (!updateParts.length) {
      console.warn('[payment] no columns to update; skipping offer update');
      await ctx.reply('💳 Оплата получена, но обновление статуса оффера недоступно. Свяжитесь с поддержкой.');
      return;
    }

    if (columns.has('status')) {
      if (columns.has('budget_xtr') && increments.paid_xtr) {
        updateParts.push(
          `status = CASE WHEN COALESCE(paid_xtr,0) + $${increments.paid_xtr} >= COALESCE(budget_xtr,0) THEN 'active' ELSE status END`,
        );
      } else if (columns.has('budget_cents') && increments.paid_cents) {
        updateParts.push(
          `status = CASE WHEN COALESCE(paid_cents,0) + $${increments.paid_cents} >= COALESCE(budget_cents,0) THEN 'active' ELSE status END`,
        );
      }
      returning.push('status');
    }

    if (columns.has('budget_xtr')) returning.push('budget_xtr');
    if (columns.has('budget_cents')) returning.push('budget_cents');

    const result = await query(
      `UPDATE offers SET ${updateParts.join(', ')} WHERE id=$1 RETURNING ${[...new Set(returning)].join(', ')}`,
      values,
    );

    if (!result.rowCount) {
      await ctx.reply('⚠️ Оплата получена, но оффер не найден. Свяжитесь с поддержкой.');
      return;
    }

    const row = result.rows[0];
    const status = columns.has('status') ? row.status ?? 'active' : 'active';
    const paidValueXtr = columns.has('paid_xtr') ? Number(row.paid_xtr ?? 0) : null;
    const budgetValueXtr = columns.has('budget_xtr') ? Number(row.budget_xtr ?? 0) : null;

    let summary;
    if (paidValueXtr != null) {
      const budgetText = budgetValueXtr ? `/${budgetValueXtr}` : '';
      summary = `${paidValueXtr}${budgetText} XTR`;
    } else {
      const paidCents = columns.has('paid_cents') ? Number(row.paid_cents ?? 0) : paidXtr * 100;
      const budgetCents = columns.has('budget_cents') ? Number(row.budget_cents ?? 0) : 0;
      const budgetText = budgetCents ? `/${(budgetCents / 100).toFixed(2)} ₽` : '';
      summary = `${(paidCents / 100).toFixed(2)} ₽${budgetText}`;
    }

    await ctx.reply(`💳 Оплата принята. Оффер ${row.id} → ${status}. Оплачено: ${summary}`);
  } catch (e) {
    console.error('successful_payment handler', e);
  }
});

// check: кнопка
bot.action(/^check:([\w-]{6,64})$/i, async (ctx) => {
  logUpdate(ctx, 'check');

  const offerId = ctx.match?.[1];
  const tgId = ctx.from?.id;

  if (!offerId) {
    await ctx.answerCbQuery('⛔️ Некорректный запрос.');
    return;
  }

  if (!tgId) {
    await ctx.answerCbQuery('⛔️ Не удалось определить ваш аккаунт.');
    return;
  }

  await ctx.answerCbQuery();

  try {
    const offer = await query(
      `
        SELECT id,
               COALESCE(NULLIF(payout_cents, 0), NULLIF(premium_rate, 0), NULLIF(base_rate, 0), 0) AS payout_cents
        FROM offers
        WHERE id=$1
        LIMIT 1
      `,
      [offerId],
    );

    if (!offer.rowCount) {
      await replyHtml(ctx, '⛔️ Оффер не найден.');
      return;
    }

    const payoutCents = Number(offer.rows[0]?.payout_cents ?? 0);

    const { ok } = await joinCheck({
      offer_id: offerId,
      tg_id: tgId,
      telegram: ctx.telegram,
    });

    if (!ok) {
      await replyHtml(ctx, 'Пока не видим вступления…');
      return;
    }

    try {
      await createConversion({
        offer_id: offerId,
        tg_id: tgId,
        amount_cents: payoutCents,
      });
    } catch (error) {
      console.error('createConversion error', error?.message || error);
    }

    await replyHtml(ctx, '✅ Готово!');
  } catch (error) {
    console.error('check handler error', error?.message || error);
    await replyHtml(ctx, '⚠️ Произошла ошибка. Попробуйте позже.');
  }
});

// общие ловушки ошибок
bot.catch((err, ctx) =>
  console.error('[TELEGRAF] error', ctx.update?.update_id, err?.stack || err),
);
process.on('unhandledRejection', (error) =>
  console.error('[UNHANDLED]', error?.stack || error),
);

function safeStop(reason) {
  try {
    bot.stop(reason);
  } catch (error) {
    if (!error || error.message !== 'Bot is not running!') {
      console.error(error);
    }
  }
}

process.once('SIGINT', () => safeStop('SIGINT'));
process.once('SIGTERM', () => safeStop('SIGTERM'));

export default bot;
