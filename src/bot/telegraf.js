import https from 'node:https';
import 'dotenv/config';
import { Telegraf, Scenes, session } from 'telegraf';

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
import { listAllOffers } from '../db/offers.js';
import { sendPostbackForEvent } from '../services/postback.js';

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

function normalizeInteger(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.trunc(num);
}

function formatRub(cents) {
  const amount = normalizeInteger(cents);
  const formatted = (amount / 100).toFixed(2);
  return `${formatted} ₽`;
}

function formatNumber(value) {
  const num = normalizeInteger(value);
  return num.toString();
}

function formatDateISO(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
}

function truncate(value, maxLength = 48) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 1)}…`;
}

function resolveContact(row) {
  const payload = row?.action_payload;
  const chatRef = row?.chat_ref;
  const candidates = [];

  if (payload && typeof payload === 'object') {
    for (const key of [
      'contact',
      'contact_info',
      'telegram',
      'telegram_contact',
      'contact_username',
      'contact_handle',
    ]) {
      const value = payload?.[key];
      if (typeof value === 'string' && value.trim()) {
        candidates.push(value.trim());
      }
    }
  }

  if (chatRef && typeof chatRef === 'object') {
    const username = chatRef?.username;
    if (typeof username === 'string' && username.trim()) {
      const handle = username.startsWith('@') ? username : `@${username}`;
      candidates.push(handle.trim());
    }
    const title = chatRef?.title;
    if (typeof title === 'string' && title.trim()) {
      candidates.push(title.trim());
    }
    const invite = chatRef?.invite_link;
    if (typeof invite === 'string' && invite.trim()) {
      candidates.push(invite.trim());
    }
  }

  const createdBy = row?.created_by_tg_id;
  if (createdBy != null) {
    const id = String(createdBy).trim();
    if (id) {
      candidates.push(`tg://user?id=${id}`);
    }
  }

  return candidates.find(Boolean) || '—';
}

function buildHtmlTable(columns, dataRows) {
  if (!Array.isArray(columns) || !columns.length) return '';
  if (!Array.isArray(dataRows) || !dataRows.length) return '';

  const preparedRows = dataRows.map((row) => {
    const result = {};
    for (const column of columns) {
      const key = column.key;
      const value = typeof column.value === 'function' ? column.value(row) : row[key];
      result[key] = value == null ? '' : String(value);
    }
    return result;
  });

  const widths = new Map();
  for (const column of columns) {
    const key = column.key;
    const headerWidth = String(column.header || '').length;
    const cellWidth = preparedRows.reduce((max, row) => Math.max(max, (row[key] || '').length), 0);
    widths.set(key, Math.min(Math.max(headerWidth, cellWidth), column.maxWidth || 64));
  }

  const lines = [];
  const headerLine = columns
    .map((column) => {
      const key = column.key;
      const width = widths.get(key) || String(column.header || '').length || 1;
      const header = String(column.header || '');
      return header.padEnd(width);
    })
    .join('  ');

  lines.push(headerLine);
  lines.push(headerLine.replace(/./g, '—'));

  for (const row of preparedRows) {
    const line = columns
      .map((column) => {
        const key = column.key;
        const width = widths.get(key) || 1;
        const value = row[key] || '';
        return column.align === 'right' ? value.padStart(width) : value.padEnd(width);
      })
      .join('  ');
    lines.push(line);
  }

  return `<pre>${escapeHtml(lines.join('\n'))}</pre>`;
}

function formatPaymentStatus(budgetCents, paidCents) {
  const budget = normalizeInteger(budgetCents);
  const paid = normalizeInteger(paidCents);
  if (budget <= 0) {
    if (paid <= 0) return '—';
    return `оплачено ${formatRub(paid)}`;
  }
  if (paid >= budget) {
    return 'оплачен';
  }
  if (paid > 0) {
    return `частично (${formatRub(paid)} из ${formatRub(budget)})`;
  }
  return 'не оплачен';
}

function formatDateRangeLabel(startAt, endAt) {
  const startLabel = formatDateISO(startAt);
  const endLabel = (() => {
    if (!endAt) return '';
    const end = new Date(endAt instanceof Date ? endAt.getTime() : Number(endAt));
    if (Number.isNaN(end.getTime())) return '';
    // endAt is exclusive — subtract 1 second to display inclusive date
    end.setUTCSeconds(end.getUTCSeconds() - 1);
    return formatDateISO(end);
  })();
  if (startLabel && endLabel && startLabel !== endLabel) {
    return `${startLabel} — ${endLabel}`;
  }
  return startLabel || endLabel || '';
}

function isAdmin(ctx) {
  const fromId = ctx.from?.id;
  if (fromId == null) return false;

  const list = String(process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (list.includes(String(fromId))) {
    return true;
  }

  const legacy = (process.env.ADMIN_TG_ID || '').trim();
  return legacy && String(fromId) === legacy;
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
    `SELECT a.offer_id, a.user_id, a.click_id, a.uid, o.postback_url
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

  const inserted = await withEventError(`insertEvent:${eventType}`, () =>
    insertEvent({
      offer_id: context.offerId,
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

  await withEventError(`sendPostbackForEvent:${eventType}`, () =>
    sendPostbackForEvent({
      offerId: context.offerId,
      eventType,
      tgId,
      clickId: context.clickId ?? null,
      uid: context.uid ?? null,
      postbackUrl: context.postbackUrl ?? null,
    }),
  );

  console.log(`[EVENT] saved ${eventType} by ${tgId} for offer ${context.offerId}`);
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

async function fetchPendingOffers() {
  const sql = `
    SELECT
      id,
      slug,
      title,
      budget_cents,
      paid_cents,
      created_at,
      status,
      action_payload,
      chat_ref,
      created_by_tg_id
    FROM offers
    WHERE COALESCE(paid_cents, 0) < COALESCE(budget_cents, 0)
    ORDER BY created_at DESC
    LIMIT 100
  `;

  try {
    const res = await query(sql);
    return res.rows || [];
  } catch (error) {
    if (error?.code === '42703') {
      // columns missing (older schema) — fallback to basic list
      const fallback = await query(
        `SELECT id, slug, title, created_at, action_payload, chat_ref, created_by_tg_id FROM offers ORDER BY created_at DESC LIMIT 50`,
      );
      return fallback.rows || [];
    }
    throw error;
  }
}

function buildPendingTable(rows) {
  const columns = [
    {
      key: 'contact',
      header: 'контакт',
      maxWidth: 32,
      value: (row) => truncate(resolveContact(row), 32),
    },
    {
      key: 'offer',
      header: 'оффер',
      maxWidth: 36,
      value: (row) => {
        const slug = row.slug && row.slug.trim();
        const title = row.title && row.title.trim();
        return truncate(slug || title || row.id, 36);
      },
    },
    {
      key: 'budget',
      header: 'бюджет',
      align: 'right',
      value: (row) => (row.budget_cents != null ? formatRub(row.budget_cents) : '—'),
    },
    {
      key: 'created',
      header: 'создан',
      align: 'right',
      value: (row) => formatDateISO(row.created_at),
    },
    {
      key: 'status',
      header: 'статус оплаты',
      maxWidth: 40,
      value: (row) => truncate(formatPaymentStatus(row.budget_cents, row.paid_cents), 40),
    },
  ];

  return buildHtmlTable(columns, rows);
}

function parseStatAdmArgs(text) {
  const now = new Date();
  const tokens = String(text || '')
    .split(/\s+/)
    .slice(1)
    .filter(Boolean);

  if (!tokens.length) {
    const end = now;
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { start, end, label: formatDateRangeLabel(start, end) };
  }

  const first = tokens[0];
  if (/^\d+$/.test(first)) {
    const daysRaw = Number(first);
    const days = Math.min(Math.max(daysRaw, 1), 365);
    const end = now;
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    return { start, end, label: formatDateRangeLabel(start, end) };
  }

  const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
  if (!isDate(first)) {
    return { error: 'Формат: /statadm [дней] или /statadm YYYY-MM-DD [YYYY-MM-DD]' };
  }

  const startDate = new Date(`${first}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime())) {
    return { error: 'Некорректная дата начала' };
  }

  let endDate = now;
  if (tokens[1]) {
    if (!isDate(tokens[1])) {
      return { error: 'Некорректный формат конечной даты' };
    }
    const parsedEnd = new Date(`${tokens[1]}T23:59:59Z`);
    if (Number.isNaN(parsedEnd.getTime())) {
      return { error: 'Некорректная конечная дата' };
    }
    endDate = new Date(parsedEnd.getTime() + 1000); // make exclusive
  }

  if (startDate > endDate) {
    return { start: endDate, end: startDate, label: formatDateRangeLabel(endDate, startDate) };
  }

  return { start: startDate, end: endDate, label: formatDateRangeLabel(startDate, endDate) };
}

async function fetchAdminStats(start, end) {
  const params = [start.toISOString(), end.toISOString()];
  const sql = `
    WITH params AS (
      SELECT $1::timestamptz AS start_at, $2::timestamptz AS end_at
    ),
    clicks AS (
      SELECT offer_id, COUNT(*)::bigint AS clicks
      FROM clicks, params
      WHERE created_at >= params.start_at AND created_at < params.end_at
      GROUP BY offer_id
    ),
    events_agg AS (
      SELECT offer_id,
             COUNT(*) FILTER (WHERE COALESCE(is_premium, false) = false)::bigint AS cd_regular,
             COUNT(*) FILTER (WHERE COALESCE(is_premium, false) = true)::bigint AS cd_premium
      FROM events, params
      WHERE created_at >= params.start_at AND created_at < params.end_at
      GROUP BY offer_id
    ),
    conv_period AS (
      SELECT offer_id,
             COUNT(*)::bigint AS conversions,
             COALESCE(SUM(amount_cents), 0)::bigint AS amount_cents
      FROM conversions, params
      WHERE created_at >= params.start_at AND created_at < params.end_at
      GROUP BY offer_id
    ),
    conv_total AS (
      SELECT offer_id, COALESCE(SUM(amount_cents), 0)::bigint AS amount_cents
      FROM conversions
      GROUP BY offer_id
    )
    SELECT
      o.id,
      o.slug,
      o.title,
      o.created_at,
      o.budget_cents,
      o.paid_cents,
      o.action_payload,
      o.chat_ref,
      o.created_by_tg_id,
      COALESCE(c.clicks, 0) AS clicks,
      COALESCE(e.cd_regular, 0) AS cd_regular,
      COALESCE(e.cd_premium, 0) AS cd_premium,
      COALESCE(cp.conversions, 0) AS conversions,
      COALESCE(cp.amount_cents, 0) AS spend_cents,
      COALESCE(ct.amount_cents, 0) AS total_spend_cents
    FROM offers o
    LEFT JOIN clicks c ON c.offer_id = o.id
    LEFT JOIN events_agg e ON e.offer_id = o.id
    LEFT JOIN conv_period cp ON cp.offer_id = o.id
    LEFT JOIN conv_total ct ON ct.offer_id = o.id
    WHERE (COALESCE(c.clicks, 0) + COALESCE(cp.conversions, 0) + COALESCE(e.cd_regular, 0) + COALESCE(e.cd_premium, 0)) > 0
    ORDER BY o.created_at DESC
  `;

  try {
    const res = await query(sql, params);
    return res.rows || [];
  } catch (error) {
    if (error?.code !== '42P01') {
      throw error;
    }
  }

  const fallbackSql = `
    WITH params AS (
      SELECT $1::timestamptz AS start_at, $2::timestamptz AS end_at
    ),
    clicks AS (
      SELECT offer_id, COUNT(*)::bigint AS clicks
      FROM clicks, params
      WHERE created_at >= params.start_at AND created_at < params.end_at
      GROUP BY offer_id
    )
    SELECT
      o.id,
      o.slug,
      o.title,
      o.created_at,
      o.budget_cents,
      o.paid_cents,
      o.action_payload,
      o.chat_ref,
      o.created_by_tg_id,
      COALESCE(c.clicks, 0) AS clicks,
      0::bigint AS cd_regular,
      0::bigint AS cd_premium,
      0::bigint AS conversions,
      0::bigint AS spend_cents,
      0::bigint AS total_spend_cents
    FROM offers o
    LEFT JOIN clicks c ON c.offer_id = o.id
    WHERE COALESCE(c.clicks, 0) > 0
    ORDER BY o.created_at DESC
  `;

  const fallbackRes = await query(fallbackSql, params);
  return fallbackRes.rows || [];
}

function buildAdminStatTable(rows) {
  const columns = [
    {
      key: 'contact',
      header: 'контакт',
      maxWidth: 28,
      value: (row) => truncate(resolveContact(row), 28),
    },
    {
      key: 'start',
      header: 'старт',
      align: 'right',
      value: (row) => formatDateISO(row.created_at),
    },
    {
      key: 'offer',
      header: 'оффер',
      maxWidth: 24,
      value: (row) => truncate(row.slug || row.title || row.id, 24),
    },
    {
      key: 'clicks',
      header: 'клики',
      align: 'right',
      value: (row) => formatNumber(row.clicks),
    },
    {
      key: 'cd_regular',
      header: 'цд',
      align: 'right',
      value: (row) => formatNumber(row.cd_regular),
    },
    {
      key: 'cd_premium',
      header: 'цд премиум',
      align: 'right',
      maxWidth: 12,
      value: (row) => formatNumber(row.cd_premium),
    },
    {
      key: 'cost',
      header: 'стоимость',
      align: 'right',
      value: (row) => formatRub(row.spend_cents),
    },
    {
      key: 'remaining',
      header: 'остаток бюджета',
      align: 'right',
      value: (row) => {
        if (row.budget_cents == null) return '—';
        const totalSpend = normalizeInteger(row.total_spend_cents);
        const budget = normalizeInteger(row.budget_cents);
        const remaining = budget - totalSpend;
        return formatRub(remaining);
      },
    },
  ];

  return buildHtmlTable(columns, rows);
}

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

bot.command('pending', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('403');
  }

  const rows = await fetchPendingOffers();
  if (!rows.length) {
    await replyHtml(ctx, 'Нет офферов, ожидающих оплаты.');
    return;
  }

  const table = buildPendingTable(rows);
  await replyHtml(ctx, `📋 Офферы в ожидании оплаты\n${table}`);
});

bot.command('statadm', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('403');
  }

  const parsed = parseStatAdmArgs(ctx.message?.text || '');
  if (parsed.error) {
    await replyHtml(ctx, parsed.error);
    return;
  }

  const { start, end, label } = parsed;
  const rows = await fetchAdminStats(start, end);
  if (!rows.length) {
    await replyHtml(ctx, 'За выбранный период данных нет.');
    return;
  }

  const table = buildAdminStatTable(rows);
  const periodLabel = label ? `Период: ${label}` : '';
  const message = [`📊 Статистика по офферам`, periodLabel, table].filter(Boolean).join('\n');
  await replyHtml(ctx, message);
});

bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('403');
  }

  const lines = [
    'Команды администратора:',
    '• /pending — офферы, ожидающие оплаты',
    '• /statadm [дней|YYYY-MM-DD [YYYY-MM-DD]] — сводная статистика',
    '• /admin_offers — последние офферы',
    '• /offer_status <UUID> <active|paused|stopped|draft> — изменить статус',
  ];
  await replyHtml(ctx, lines.join('\n'));
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

registerStatHandlers(bot, { logUpdate });

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

  try {
    await query(insertSql, params);
    console.log('[ATTR] linked', {
      offer_id: offerId,
      click_id: clickId,
      tg_id: tgId,
    });
    return;
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
  }

  console.log('[ATTR] linked', {
    offer_id: offerId,
    click_id: clickId,
    tg_id: tgId,
  });
}

bot.start(async (ctx) => {
  logUpdate(ctx, 'start');
  const payload = typeof ctx.startPayload === 'string' ? ctx.startPayload.trim() : '';

  if (payload) {
    await handleStartWithToken(ctx, payload);
    return;
  }

  await replyHtml(
    ctx,
    'Это <code>/start</code> без параметра кампании. Пришлите токен командой:\n' +
      '<code>/claim &lt;TOKEN&gt;</code>',
  );
});

bot.command('ads', async (ctx) => {
  logUpdate(ctx, 'ads');
  try {
    await startAdsWizard(ctx);
    console.log('[ADS] wizard started');
  } catch (error) {
    console.error('[ADS] start error:', error?.message || error);
    await replyHtml(ctx, 'Не удалось запустить мастер: <code>' + escapeHtml(error?.message || error) + '</code>');
  }
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
