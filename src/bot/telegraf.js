import https from 'node:https';
import 'dotenv/config';
import { Telegraf, Scenes, session } from 'telegraf';

import { query } from '../db/index.js';
import { sendPostback } from '../services/postback.js';
import { approveJoin, createConversion } from '../services/conversion.js';
import { joinCheck } from '../services/joinCheck.js';
import { uuid, shortToken } from '../util/id.js';
import { adjustPayoutCents } from '../util/pricing.js';
import { centsToXtr } from '../util/xtr.js';
import { registerStatHandlers } from './stat.js';
import { sessionStore } from './sessionStore.js';
import { adsWizardScene, startAdsWizard } from './adsWizard.js';
import { ensureBotSelf } from './self.js';
import { replyHtml } from './html.js';

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

function isAdminCtx(ctx) {
  const adminId = Number(process.env.ADMIN_TG_ID || 0);
  return adminId && ctx.from?.id && Number(ctx.from.id) === adminId;
}

// ─── admin команды ────────────────────────────────────────────────────────────

bot.command('admin_offers', async (ctx) => {
  if (!isAdminCtx(ctx)) return;
  const r = await query(
    `SELECT id, title, status, budget_cents, paid_cents, payout_cents, created_by_tg_id
       FROM offers
      ORDER BY created_at DESC
      LIMIT 20`,
  );
  if (!r.rowCount) return ctx.reply('Пусто');
  const lines = r.rows.map(
    (o) =>
      `• <code>${o.id}</code> — ${o.title || '(без названия)'} [${o.status}] ` +
      `бюджет ${(o.budget_cents / 100).toFixed(2)} ₽, оплачено ${(o.paid_cents / 100).toFixed(2)} ₽, payout ${(o.payout_cents / 100).toFixed(2)} ₽`,
  );
  await replyHtml(ctx, lines.join('\n'));
});

bot.command('offer_status', async (ctx) => {
  if (!isAdminCtx(ctx)) return;
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

function normalizeGeoForInsert(geo) {
  const list = (() => {
    if (!geo) return [];
    if (Array.isArray(geo)) {
      return geo
        .map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : ''))
        .filter(Boolean);
    }
    if (typeof geo === 'string') {
      return geo
        .split(/[,\s]+/)
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean);
    }
    return [];
  })();
  const geoInput = list.length ? list.join(',') : null;
  return { list: list.length ? list : null, input: geoInput };
}

export async function finalizeOfferAndInvoiceStars(ctx, form = {}) {
  const columns = await getOfferColumns();
  const tgId = ctx.from?.id ?? null;

  const basePayoutCents = Number.isFinite(Number(form?.payout_cents))
    ? Number(form.payout_cents)
    : 0;
  const geo = form?.geo ?? null;
  const payoutAdjusted = adjustPayoutCents(basePayoutCents, geo); // +30% для high GEO с округлением вверх

  const providedBudgetCents = Number.isFinite(Number(form?.budget_cents))
    ? Number(form.budget_cents)
    : 0;
  const normalizedBudgetCents =
    providedBudgetCents > 0 ? providedBudgetCents : payoutAdjusted;

  const providedBudgetXtr = Number.isFinite(Number(form?.budget_xtr))
    ? Number(form.budget_xtr)
    : null;
  const normalizedBudgetXtr =
    providedBudgetXtr && providedBudgetXtr > 0
      ? Math.floor(providedBudgetXtr)
      : centsToXtr(normalizedBudgetCents);

  const insertColumns = [];
  const values = [];
  const params = [];
  const push = (column, value) => {
    if (!columns.has(column)) return;
    insertColumns.push(column);
    values.push(value);
    params.push(`$${values.length}`);
  };

  const title = form?.title ?? form?.name ?? null;
  if (columns.has('title')) push('title', title);
  else if (columns.has('name')) push('name', title);

  if (form?.slug != null) push('slug', form.slug);
  if (columns.has('target_url')) push('target_url', form?.target_url ?? null);
  if (columns.has('target_link') && form?.target_link != null)
    push('target_link', form.target_link);
  if (columns.has('event_type'))
    push('event_type', form?.event_type ?? 'join_group');

  if (columns.has('payout_cents')) push('payout_cents', payoutAdjusted);

  const baseRateRub = Number.isFinite(Number(form?.base_rate_rub))
    ? Number(form.base_rate_rub)
    : Number.isFinite(Number(form?.base_rate))
    ? Number(form.base_rate)
    : null;
  const baseRateCents = Number.isFinite(Number(form?.base_rate_cents))
    ? Number(form.base_rate_cents)
    : baseRateRub != null
    ? Math.round(baseRateRub * 100)
    : null;
  if (columns.has('base_rate')) {
    if (baseRateCents != null) push('base_rate', baseRateCents);
    else if (baseRateRub != null) push('base_rate', baseRateRub);
    else if (!columns.has('payout_cents'))
      push('base_rate', Math.round(payoutAdjusted / 100));
  }

  const premiumRateRub = Number.isFinite(Number(form?.premium_rate_rub))
    ? Number(form.premium_rate_rub)
    : Number.isFinite(Number(form?.premium_rate))
    ? Number(form.premium_rate)
    : null;
  const premiumRateCents = Number.isFinite(Number(form?.premium_rate_cents))
    ? Number(form.premium_rate_cents)
    : premiumRateRub != null
    ? Math.round(premiumRateRub * 100)
    : null;
  if (columns.has('premium_rate')) {
    if (premiumRateCents != null) push('premium_rate', premiumRateCents);
    else if (premiumRateRub != null) push('premium_rate', premiumRateRub);
  }

  if (columns.has('caps_total') && form?.caps_total != null)
    push('caps_total', form.caps_total);
  if (columns.has('budget_cents')) push('budget_cents', normalizedBudgetCents);
  if (columns.has('budget_xtr')) push('budget_xtr', normalizedBudgetXtr);

  const geoNormalized = normalizeGeoForInsert(geo);
  if (columns.has('geo'))
    push(
      'geo',
      Array.isArray(geoNormalized.list)
        ? geoNormalized.list.join(',')
        : geoNormalized.input,
    );
  if (columns.has('geo_input') && geoNormalized.input !== null)
    push('geo_input', geoNormalized.input);
  if (columns.has('geo_list') && geoNormalized.list)
    push('geo_list', geoNormalized.list);
  if (columns.has('geo_whitelist') && geoNormalized.list)
    push('geo_whitelist', geoNormalized.list);

  if (columns.has('created_by_tg')) push('created_by_tg', tgId);
  if (columns.has('created_by_tg_id')) push('created_by_tg_id', tgId);
  if (columns.has('status')) push('status', form?.status ?? 'draft');

  const text = `
    INSERT INTO offers (id${insertColumns.length ? ',' + insertColumns.join(',') : ''})
    VALUES (gen_random_uuid()${params.length ? ',' + params.join(',') : ''})
    RETURNING id${columns.has('title') ? ', title' : ''}${
      !columns.has('title') && columns.has('name') ? ', name' : ''
    }${columns.has('budget_cents') ? ', budget_cents' : ''}${
      columns.has('budget_xtr') ? ', budget_xtr' : ''
    }
  `;

  const ins = await query(text, values);
  const row = ins.rows[0] || {};
  const offer = {
    id: row.id,
    title: row.title ?? row.name ?? title ?? row.id,
    budget_cents: columns.has('budget_cents')
      ? row.budget_cents ?? normalizedBudgetCents
      : normalizedBudgetCents,
    budget_xtr: columns.has('budget_xtr')
      ? row.budget_xtr ?? normalizedBudgetXtr
      : normalizedBudgetXtr,
  };

  const amountInStars =
    offer.budget_xtr || centsToXtr(offer.budget_cents);

  await ctx.replyWithInvoice({
    title: `Оплата оффера: ${offer.title || offer.id}`,
    description: `Бюджет: ${amountInStars} XTR. Payout: ${(payoutAdjusted / 100).toFixed(2)} ₽`,
    payload: String(offer.id),
    provider_token: '', // Stars не требует токен провайдера
    currency: 'XTR',
    prices: [{ label: 'Budget', amount: amountInStars }],
    start_parameter: String(offer.id),
  });

  return offer;
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
    await startAdsWizard(ctx, { finalizeOffer: finalizeOfferAndInvoiceStars });
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
    SELECT c.id AS click_id, c.offer_id, c.uid, o.target_url, o.event_type
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

  const { click_id, offer_id, uid, target_url, event_type } = res.rows[0];

  const update = await query(
    `UPDATE clicks SET tg_id=$1, used_at=NOW() WHERE id=$2 AND (tg_id IS NULL OR tg_id=$1)`,
    [tgId, click_id],
  );
  if (!update.rowCount) {
    console.warn('[tg] start token already used', { token, tgId });
    await replyHtml(ctx, '⛔️ Ссылка уже использована другим пользователем.');
    return;
  }

  await query(
    `INSERT INTO attribution (click_id, offer_id, uid, tg_id, state) VALUES ($1,$2,$3,$4,'started')`,
    [click_id, offer_id, uid ?? null, tgId],
  );

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

// вступление в группу (chat_member)
bot.on(['chat_member', 'my_chat_member'], async (ctx) => {
  logUpdate(ctx, 'chat_member');
  const upd = ctx.update.chat_member || ctx.update.my_chat_member;
  const user = upd?.new_chat_member?.user;
  const status = upd?.new_chat_member?.status;
  if (!user) return;
  if (!['member', 'administrator', 'creator'].includes(status)) return;

  const tgId = user.id;

  const res = await query(
    `
    SELECT click_id, offer_id, uid
    FROM attribution
    WHERE tg_id=$1 AND state='started'
      AND created_at >= NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC LIMIT 1
  `,
    [tgId],
  );
  if (!res.rowCount) return;

  const { click_id: attrClickId, offer_id, uid } = res.rows[0];
  const existing = await query(
    `SELECT id FROM events WHERE offer_id=$1 AND tg_id=$2 AND type=$3 LIMIT 1`,
    [offer_id, tgId, JOIN_GROUP_EVENT],
  );
  if (existing.rowCount) {
    await query(`UPDATE attribution SET state='converted' WHERE click_id=$1`, [attrClickId]);
    return;
  }

  await query(`INSERT INTO events(offer_id, tg_id, type) VALUES($1,$2,$3)`, [offer_id, tgId, JOIN_GROUP_EVENT]);
  const updated = await query(`UPDATE attribution SET state='converted' WHERE click_id=$1`, [attrClickId]);

  if (!updated.rowCount) {
    return;
  }

  try {
    await sendPostback({
      offer_id,
      tg_id: tgId,
      uid,
      click_id: attrClickId,
      event: JOIN_GROUP_EVENT,
    });
  } catch (error) {
    console.error('postback error:', error?.message || error);
  }

  try {
    await approveJoin({ offer_id, tg_id: tgId, click_id: attrClickId });
  } catch (error) {
    console.error('approveJoin error:', error?.message || error);
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
