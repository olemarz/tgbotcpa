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
import {
  notifyOfferCapsIfNeeded,
  OFFER_CAPS_INCREASE_CALLBACK_PREFIX,
  fetchOfferForIncrease,
  registerCapsTelegramClient,
} from '../services/offerCaps.js';
import { centsToXtr } from '../util/xtr.js';
import { sendStarsInvoice } from './paymentsStars.js';

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

registerCapsTelegramClient(bot.telegram);

await ensureBotSelf(bot);

// сцены
const stage = new Scenes.Stage([adsWizardScene]);

const STARS_ENABLED = String(process.env.STARS_ENABLED || '').toLowerCase() === 'true';

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

async function handleIncreaseCapsInput(ctx) {
  const awaiting = ctx.session?.awaiting;
  if (!awaiting || awaiting.type !== 'increase_caps') {
    return false;
  }

  const text = ctx.message?.text;
  if (typeof text !== 'string' || !text.trim()) {
    await replyHtml(ctx, 'Введите положительное целое число — сколько лидов добавить.');
    return true;
  }

  const normalized = text.replace(/[\s,]+/g, '').trim();
  const deltaCaps = Number.parseInt(normalized, 10);
  if (!Number.isFinite(deltaCaps) || deltaCaps <= 0) {
    await replyHtml(ctx, 'Введите положительное целое число — сколько лидов добавить.');
    return true;
  }

  const offer = await fetchOfferForIncrease(awaiting.offerId);
  if (!offer) {
    if (ctx.session) {
      delete ctx.session.awaiting;
    }
    await replyHtml(ctx, '⚠️ Оффер не найден. Возможно, он уже удалён или архивирован.');
    return true;
  }

  const payoutCents = Math.max(0, Number(offer.payoutCents || 0));
  const deltaBudgetCents = deltaCaps * payoutCents;
  const deltaBudgetStars = deltaBudgetCents > 0 ? Math.max(1, centsToXtr(deltaBudgetCents)) : 0;
  const offerName = escapeHtml(offer.slug || offer.title || offer.id);
  const newLimit = (Number(offer.capsTotal) || 0) + deltaCaps;

  if (STARS_ENABLED && deltaBudgetCents > 0) {
    try {
      await sendStarsInvoice(ctx, {
        title: `Увеличение лимита: ${offerName}`,
        description: `Дополнительные лиды: ${deltaCaps}. К оплате: ${deltaBudgetStars} ⭐️.`,
        totalStars: deltaBudgetStars,
        payloadMeta: {
          kind: 'caps_increase',
          offer_id: offer.id,
          delta_caps: deltaCaps,
          delta_budget_cents: deltaBudgetCents,
          requested_by: ctx.from?.id ?? null,
        },
      });
      await replyHtml(
        ctx,
        `💳 Счёт на <b>${deltaBudgetStars} ⭐️</b> за ${deltaCaps} дополнительных лидов отправлен.\n` +
          `После оплаты лимит увеличится до <b>${newLimit}</b>.`,
      );
      if (ctx.session) {
        delete ctx.session.awaiting;
      }
    } catch (error) {
      console.error('[caps.increase] invoice error', error?.message || error);
      await replyHtml(ctx, '⚠️ Не удалось отправить счёт. Попробуйте позже.');
    }
    return true;
  }

  const columns = await getOfferColumns();
  const values = [offer.id];
  const updates = [];

  if (columns.has('caps_total')) {
    values.push(deltaCaps);
    updates.push(`caps_total = COALESCE(caps_total,0) + $${values.length}`);
  }
  if (deltaBudgetCents > 0 && columns.has('budget_cents')) {
    values.push(deltaBudgetCents);
    updates.push(`budget_cents = COALESCE(budget_cents,0) + $${values.length}`);
  }
  if (deltaBudgetStars > 0 && columns.has('budget_xtr')) {
    values.push(deltaBudgetStars);
    updates.push(`budget_xtr = COALESCE(budget_xtr,0) + $${values.length}`);
  }
  if (columns.has('caps_reached_notified_at')) {
    updates.push('caps_reached_notified_at = NULL');
  }

  if (!updates.length) {
    await replyHtml(ctx, '⚠️ Не удалось обновить лимит — отсутствуют необходимые поля.');
    if (ctx.session) {
      delete ctx.session.awaiting;
    }
    return true;
  }

  try {
    await query(`UPDATE offers SET ${updates.join(', ')} WHERE id=$1`, values);
    const budgetNote =
      deltaBudgetStars > 0 ? ` Бюджет увеличен на <b>${deltaBudgetStars} ⭐️</b>.` : '';
    await replyHtml(
      ctx,
      `✅ Лимит оффера <b>${offerName}</b> увеличен до <b>${newLimit}</b>.${budgetNote}`,
    );
  } catch (error) {
    console.error('[caps.increase] update error', error?.message || error);
    await replyHtml(ctx, '⚠️ Не удалось обновить лимит. Попробуйте позже.');
    return true;
  } finally {
    if (ctx.session) {
      delete ctx.session.awaiting;
    }
  }

  return true;
}

function buildPaymentSummary(columns, row, fallbackPaidXtr) {
  if (columns.has('paid_xtr')) {
    const paidValueXtr = Number(row.paid_xtr ?? 0);
    const budgetValueXtr = columns.has('budget_xtr') ? Number(row.budget_xtr ?? 0) : null;
    const budgetText = budgetValueXtr ? `/${budgetValueXtr}` : '';
    return `${paidValueXtr}${budgetText} XTR`;
  }

  const paidCents = columns.has('paid_cents')
    ? Number(row.paid_cents ?? 0)
    : (Number(fallbackPaidXtr) || 0) * 100;
  const budgetCents = columns.has('budget_cents') ? Number(row.budget_cents ?? 0) : 0;
  const budgetText = budgetCents ? `/${(budgetCents / 100).toFixed(2)} ₽` : '';
  return `${(paidCents / 100).toFixed(2)} ₽${budgetText}`;
}

async function applyCapsIncreasePayment(ctx, { columns, offerId, paidXtr, payload }) {
  const deltaCaps = Number(payload?.delta_caps ?? 0);
  const deltaBudgetCents = Number(payload?.delta_budget_cents ?? 0);
  const deltaBudgetStars = deltaBudgetCents > 0 ? Math.max(1, centsToXtr(deltaBudgetCents)) : 0;

  const values = [offerId];
  const updateParts = [];
  const returning = ['id'];
  const increments = {};

  if (columns.has('caps_total') && deltaCaps > 0) {
    values.push(deltaCaps);
    updateParts.push(`caps_total = COALESCE(caps_total,0) + $${values.length}`);
    returning.push('caps_total');
  }

  if (deltaBudgetCents > 0 && columns.has('budget_cents')) {
    values.push(deltaBudgetCents);
    updateParts.push(`budget_cents = COALESCE(budget_cents,0) + $${values.length}`);
    returning.push('budget_cents');
  }

  if (deltaBudgetStars > 0 && columns.has('budget_xtr')) {
    values.push(deltaBudgetStars);
    updateParts.push(`budget_xtr = COALESCE(budget_xtr,0) + $${values.length}`);
    returning.push('budget_xtr');
  }

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
    await ctx.reply('💳 Оплата получена, но обновление лимита недоступно. Свяжитесь с поддержкой.');
    return true;
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

  if (columns.has('caps_reached_notified_at')) {
    updateParts.push('caps_reached_notified_at = NULL');
  }

  if (columns.has('budget_xtr')) returning.push('budget_xtr');
  if (columns.has('budget_cents')) returning.push('budget_cents');

  const result = await query(
    `UPDATE offers SET ${updateParts.join(', ')} WHERE id=$1 RETURNING ${[...new Set(returning)].join(', ')}`,
    values,
  );

  if (!result.rowCount) {
    await ctx.reply('⚠️ Оплата получена, но оффер не найден. Свяжитесь с поддержкой.');
    return true;
  }

  const row = result.rows[0];
  const status = columns.has('status') ? row.status ?? 'active' : 'active';
  const summary = buildPaymentSummary(columns, row, paidXtr);
  const newLimit = columns.has('caps_total') ? Number(row.caps_total ?? 0) : null;
  const limitText = deltaCaps > 0 && newLimit != null ? ` Лимит увеличен до ${newLimit}.` : '';
  const budgetText = deltaBudgetStars > 0 ? ` Бюджет пополнен на ${deltaBudgetStars} ⭐️.` : '';

  await ctx.reply(
    `💳 Оплата принята. Оффер ${row.id} → ${status}. Оплачено: ${summary}.${limitText}${budgetText}`,
  );
  return true;
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

  if (inserted?.id) {
    await withEventError(`caps.notify:${eventType}`, () =>
      notifyOfferCapsIfNeeded({ offerId: context.offerId, telegram: ctx.telegram }),
    );
  }

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
  try {
    await notifyOfferCapsIfNeeded({ offerId: offer_id, telegram: ctx.telegram });
  } catch (error) {
    console.error('[chat_member] caps notify error', error?.message || error);
  }
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
  if (await handleIncreaseCapsInput(ctx)) {
    return;
  }
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

  if (typeof data === 'string' && data.startsWith(OFFER_CAPS_INCREASE_CALLBACK_PREFIX)) {
    const offerId = data.slice(OFFER_CAPS_INCREASE_CALLBACK_PREFIX.length).trim();
    try {
      await ctx.answerCbQuery();
    } catch (error) {
      console.error('[caps.increase] answerCbQuery error', error?.message || error);
    }

    if (!offerId) {
      await replyHtml(ctx, '⚠️ Оффер не найден.');
      return;
    }

    const offer = await fetchOfferForIncrease(offerId);
    if (!offer) {
      await replyHtml(ctx, '⚠️ Оффер не найден или недоступен.');
      return;
    }

    if (ctx.session) {
      ctx.session.awaiting = {
        type: 'increase_caps',
        offerId: offer.id,
        requestedBy: ctx.from?.id ?? null,
      };
    }

    const offerName = escapeHtml(offer.slug || offer.title || offer.id);
    const payoutStars = offer.payoutCents > 0 ? Math.max(1, centsToXtr(offer.payoutCents)) : 0;
    const payoutLine = payoutStars ? `Текущий payout: <b>${payoutStars} ⭐️</b>.\n` : '';
    const currentLimit = Number.isFinite(Number(offer.capsTotal)) ? Number(offer.capsTotal) : 0;
    await replyHtml(
      ctx,
      `Сколько дополнительных лидов добавить для <b>${offerName}</b>?\n` +
        payoutLine +
        `Текущий лимит: <b>${currentLimit}</b>.`,
    );
    return;
  }

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
    const paidXtr = Number(sp.total_amount || 0);
    const payloadRaw = sp.invoice_payload;
    let payload = null;
    if (typeof payloadRaw === 'string' && payloadRaw.trim().startsWith('{')) {
      try {
        payload = JSON.parse(payloadRaw);
      } catch (error) {
        payload = null;
      }
    }

    const kind = payload?.kind ?? null;
    const offerId = payload?.offer_id ?? (typeof payloadRaw === 'string' ? payloadRaw : null);

    if (!offerId) {
      await ctx.reply('⚠️ Оплата получена, но оффер не найден. Свяжитесь с поддержкой.');
      return;
    }

    const columns = await getOfferColumns();

    if (kind === 'caps_increase') {
      const handled = await applyCapsIncreasePayment(ctx, {
        columns,
        offerId,
        paidXtr,
        payload,
      });
      if (handled) {
        return;
      }
    }

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
    const summary = buildPaymentSummary(columns, row, paidXtr);

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
