import 'dotenv/config';
import { Telegraf, Scenes, session } from 'telegraf';

import { query } from '../db/index.js';
import { sendPostback } from '../services/postback.js';
import { approveJoin, createConversion } from '../services/conversion.js';
import { joinCheck } from '../services/joinCheck.js';
import { uuid, shortToken } from '../util/id.js';
import { registerStatHandlers } from './stat.js';
import { sessionStore } from './sessionStore.js';
import { adsWizardScene, startAdsWizard } from './adsWizard.js';

console.log('[BOOT] telegraf init');

const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
if (!BOT_TOKEN) {
  console.error('[BOOT] BOT_TOKEN env is required');
  process.exit(1);
}

export const bot = new Telegraf(BOT_TOKEN);

const stage = new Scenes.Stage([adsWizardScene]);

bot.use(
  session({
    store: sessionStore,
    getSessionKey(ctx) {
      const fromId = ctx.from?.id;
      if (!['string', 'number', 'bigint'].includes(typeof fromId)) {
        return undefined;
      }
      const key = String(fromId);
      return /^[0-9]+$/.test(key) ? key : undefined;
    },
  }),
);
bot.use(stage.middleware());

if (process.env.DISABLE_LINK_CAPTURE !== 'true') {
  try {
    const module = await import('./link-capture.js');
    const linkCapture = module?.default;
    if (linkCapture) {
      bot.use(linkCapture());
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

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function replyHtml(ctx, html, extra = {}) {
  return ctx.reply(html, { parse_mode: 'HTML', ...extra });
}

function isAdminCtx(ctx) {
  const adminId = Number(process.env.ADMIN_TG_ID || 0);
  return adminId && ctx.from?.id && Number(ctx.from.id) === adminId;
}

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
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
});

bot.command('offer_status', async (ctx) => {
  if (!isAdminCtx(ctx)) return;
  const m = (ctx.message?.text || '').match(/^\/offer_status\s+([0-9a-f-]{36})\s+(active|paused|stopped|draft)$/i);
  if (!m) return ctx.reply('Формат: /offer_status <UUID> <active|paused|stopped|draft>');
  const [, id, st] = m;
  const r = await query(`UPDATE offers SET status=$2 WHERE id=$1 RETURNING id,status`, [id, st.toLowerCase()]);
  if (!r.rowCount) return ctx.reply('Не найдено');
  await ctx.reply(`OK: ${r.rows[0].id} → ${r.rows[0].status}`);
});

bot.use(async (ctx, next) => {
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
});

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
    'Это <code>/start</code> без параметра кампании. Пришлите токен командой:<br/><code>/claim &lt;TOKEN&gt;</code>',
  );
});

bot.command('ads', async (ctx) => {
  logUpdate(ctx, 'ads');
  try {
    await startAdsWizard(ctx, {});
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
    await replyHtml(ctx, 'Новая задача доступна: <code>/ads</code>');
    return;
  }

  await replyHtml(ctx, 'Новая задача доступна: <code>/ads</code>');
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

bot.catch((err, ctx) => console.error('[TELEGRAF] error', ctx.update?.update_id, err?.stack || err));
process.on('unhandledRejection', (error) => console.error('[UNHANDLED]', error?.stack || error));

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
