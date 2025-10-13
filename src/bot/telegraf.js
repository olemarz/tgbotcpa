console.log('[BOOT] telegraf START | APP_VERSION=', process.env.APP_VERSION || 'n/a');

import 'dotenv/config';
// src/bot/telegraf.js
import { query } from '../db/index.js';
import { sendPostback } from '../services/postback.js';
import { approveJoin, createConversion } from '../services/conversion.js';
import { joinCheck } from '../services/joinCheck.js';
import { uuid, shortToken } from '../util/id.js';
import { registerStatHandlers } from './stat.js';
import { Telegraf, Scenes, session, Markup } from 'telegraf';
import { sessionStore } from './sessionStore.js';
import { adsWizardScene, startAdsWizard } from './adsWizard.js';

const token = (process.env.BOT_TOKEN || '').trim();
export const bot = new Telegraf(token);

// ---- Scenes
const stage = new Scenes.Stage([adsWizardScene]);

const ADMIN_IDS = new Set(
  (process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

function isAdmin(ctx) {
  const id = ctx.from?.id;
  return id != null && ADMIN_IDS.has(String(id));
}

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
  })
);
bot.use(stage.middleware()); // ← всегда до link-capture

// /start: если есть payload — оставляем текущее поведение (handleStartWithToken),
// иначе выводим приветствие с командами. Админ видит расширенный набор.
bot.start(async (ctx) => {
  const rawPayload = ctx.startPayload;
  if (typeof rawPayload === 'string' && rawPayload.trim()) {
    // существующая логика старта с токеном
    return handleStartWithToken(ctx, rawPayload);
  }

  const admin = isAdmin(ctx);

  const userText =
    '👋 *Бот на вебхуке готов\\.*\n' +
    'Доступные команды для рекламодателя:\n' +
    '• `/ads` — разместить оффер \(мастер\)\n' +
    '• `/claim \<TOKEN\>` — привязать оффер по токену\n' +
    '• `/whoami` — показать ваш Telegram ID';

  const adminText =
    '🛠 *Режим администратора\\.*\n' +
    'Дополнительные команды \(пока-заглушки\):\n' +
    '• `/offers` — управление офферами\n' +
    '• `/stats` — сводная статистика\n' +
    '• `/broadcast` — рассылка\n\n' +
    userText;

  // Кнопки для удобства
  const kb = admin
    ? Markup.keyboard([
        ['/ads', '/whoami'],
        ['/offers', '/stats'],
        ['/broadcast'],
      ]).resize()
    : Markup.keyboard([['/ads', '/whoami']]).resize();

  await ctx.replyWithMarkdownV2(admin ? adminText : userText, kb);
});

// guard для /ads: реагируем только на /ads (и его упоминание), без ложных срабатываний
bot.use(async (ctx, next) => {
  const txt = ctx.update?.message?.text || '';

  if (/^\/ads(?:@[\w_]+)?(?:\s|$)/i.test(txt)) {
    console.log('[GUARD] /ads matched → start wizard | text="%s"', txt);
    try {
      const init = {};
      return await startAdsWizard(ctx, init || {});
    } catch (e) {
      console.error('[GUARD] startAdsWizard error:', e?.message || e);
      // не блокируем цепочку даже при ошибке
    }
  }
  return next();
});

// ---- Команды мастера
console.log('[BOOT] adsWizard wired: /ads, /add, /ads2, /ads3');
bot.command(['ads', 'add', 'ads2', 'ads3'], async (ctx) => {
  try {
    console.log('[ADS] startAdsWizard invoked, hasScene=', !!ctx.scene);
    const init = {};
    await startAdsWizard(ctx, init || {});
    console.log('[ADS] ctx.scene.enter resolved');
  } catch (e) {
    console.error('[ADS] start error:', e?.message, e?.stack || '');
    await ctx.reply('❌ Не смог запустить мастер: ' + (e?.message || e));
  }
});

if (process.env.DISABLE_LINK_CAPTURE !== 'true') {
  const { default: linkCapture } = await import('./link-capture.js');
  bot.use(linkCapture()); // ← после stage
} else {
  console.log('[BOOT] link-capture DISABLED');
}

// ---- Инициализация бота ----
if (!token) {
  throw new Error('BOT_TOKEN is required');
}

// ===== TRACE middleware (diag) =====
bot.use(async (ctx, next) => {
  const u = ctx.update;
  const txt = u?.message?.text;
  const ents = u?.message?.entities;
  console.log('[TRACE:IN ] type=%s text=%j ents=%j', ctx.updateType, txt ?? null, ents ?? null);
  try {
    const r = await next();
    console.log('[TRACE:OUT] type=%s text=%j', ctx.updateType, txt ?? null);
    return r;
  } catch (e) {
    console.log('[TRACE:ERR] %s', e?.message || e);
    throw e;
  }
});
// ===== /TRACE =====

export function logUpdate(ctx, tag = 'update') {
  const u = ctx.update || {};
  console.log('[tg]', tag, {
    types: Object.keys(u),
    from: ctx.from ? { id: ctx.from.id, is_bot: ctx.from.is_bot } : null,
    text: ctx.message?.text,
    entities: ctx.message?.entities,
    startPayload: ctx.startPayload,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 0) Любая команда — сперва очищаем "ожидание ссылки", чтобы визард не висел
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
// ─────────────────────────────────────────────────────────────────────────────

// ---- Команды ----

const JOIN_GROUP_EVENT = 'join_group';

registerStatHandlers(bot, { logUpdate });
export async function handleStartWithToken(ctx, rawToken) {
  const tgId = ctx.from?.id;
  const token = rawToken?.trim();

  if (!tgId) {
    console.warn('[tg] missing from.id on start token', { token });
    await ctx.reply('Не удалось определить Telegram ID. Попробуйте ещё раз позже.');
    return;
  }

  if (!token || !/^[A-Za-z0-9_-]{1,64}$/.test(token)) {
    await ctx.reply('⛔️ Неверный токен. Сгенерируйте новую ссылку или используйте /claim <TOKEN>.');
    return;
  }

  const r = await query(
    `
    SELECT c.id AS click_id, c.offer_id, c.uid, o.target_url, o.event_type
    FROM clicks c JOIN offers o ON o.id=c.offer_id
    WHERE c.start_token=$1
    LIMIT 1
  `,
    [token],
  );

  if (!r.rowCount) {
    await ctx.reply('⛔️ Ссылка устарела или неверна. Сгенерируйте новую через /ads.');
    return;
  }

  const { click_id, offer_id, uid, target_url, event_type } = r.rows[0];

  const update = await query(
    `UPDATE clicks SET tg_id=$1, used_at=NOW() WHERE id=$2 AND (tg_id IS NULL OR tg_id=$1)`,
    [tgId, click_id],
  );
  if (!update.rowCount) {
    console.warn('[tg] start token already used', { token, tgId });
    await ctx.reply('⛔️ Ссылка уже использована другим пользователем.');
    return;
  }

  await query(
    `INSERT INTO attribution (click_id, offer_id, uid, tg_id, state) VALUES ($1,$2,$3,$4,'started')`,
    [click_id, offer_id, uid ?? null, tgId],
  );

  if (event_type === JOIN_GROUP_EVENT && target_url) {
    await ctx.reply('Нажмите, чтобы вступить в группу. После вступления зафиксируем событие:', {
      reply_markup: { inline_keyboard: [[{ text: '✅ Вступить в группу', url: target_url }]] },
    });
    await ctx.reply('Новая задача доступна: /ads');
    return;
  }

  await ctx.reply('Новая задача доступна: /ads');
}

export async function handleClaimCommand(ctx) {
  logUpdate(ctx, 'claim');
  const text = ctx.message?.text ?? '';
  const match =
    typeof text === 'string' ? text.match(/^\/claim(?:@[\w_]+)?\s+(\S+)/i) : null;

  if (!match) {
    await ctx.reply('Пришлите токен командой: /claim <TOKEN>');
    return;
  }

  const token = match[1];
  return handleStartWithToken(ctx, token);
}

bot.start(async (ctx) => {
  logUpdate(ctx, 'start');
  let token = ctx.startPayload?.trim();
  if (!token && typeof ctx.message?.text === 'string') {
    const m = ctx.message.text.match(/^\/start(?:@[\w_]+)?\s+(\S+)$/);
    if (m) token = m[1];
  }
  if (!token) {
    return ctx.reply(
      'Это /start без параметра кампании. Нажмите ссылку из оффера или пришлите токен командой:\n/claim <TOKEN>',
    );
  }
  return handleStartWithToken(ctx, token);
});

// ручной фолбэк для QA: /claim TOKEN
bot.command('claim', handleClaimCommand);

// QA shortcut: /go OFFER_ID [uid]
bot.hears(/^\/go\s+([0-9a-f-]{36})(?:\s+(\S+))?$/i, async (ctx) => {
  logUpdate(ctx, 'go');
  const tgId = ctx.from?.id;
  if (!tgId) {
    await ctx.reply('Не удалось определить Telegram ID. Попробуйте ещё раз позже.');
    return;
  }

  const offerId = ctx.match[1];
  const uid = ctx.match[2] || 'qa';

  const offer = await query(
    `SELECT id, target_url, event_type FROM offers WHERE id=$1 LIMIT 1`,
    [offerId],
  );
  if (!offer.rowCount) {
    await ctx.reply('⛔️ Оффер не найден.');
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
  } catch (err) {
    if (err?.code === '23505') {
      console.error('duplicate start_token on /go', { token, offerId, uid, tgId });
      await ctx.reply('⚠️ Не удалось сгенерировать токен. Попробуйте ещё раз.');
      return;
    }
    throw err;
  }

  await handleStartWithToken(ctx, token);
});

bot.command('whoami', async (ctx) => {
  try {
    await ctx.reply(`Your Telegram ID: ${ctx.from?.id}`);
  } catch (e) {
    console.error('❌ whoami send error', e);
  }
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    'Все офферы открываются через кнопку (WebApp). Если ничего не произошло — отправьте /claim <токен> из вашей ссылки.',
  );
});

// Рекомендуется иметь /cancel
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
    await ctx.reply('Мастер прерван. Можно начать заново: /ads');
  } catch (error) {
    console.error('cancel command reply error', error?.message || error);
  }
});

bot.command('stat', async (ctx) => {
  logUpdate(ctx, 'stat');
  const todayKey = formatDateKey(new Date());
  await respondWithStats(ctx, todayKey);
});

bot.action(/^stat:(.+)$/i, async (ctx) => {
  logUpdate(ctx, 'stat:action');
  const value = ctx.match[1];
  let date;
  if (value === 'today') {
    date = new Date();
  } else {
    date = parseDateKey(value);
  }

  if (!date) {
    await ctx.answerCbQuery('Некорректная дата');
    return;
  }

  const dateKey = formatDateKey(date);
  await respondWithStats(ctx, dateKey, { isCallback: true });
});

bot.on(['chat_member', 'my_chat_member'], async (ctx) => {
  logUpdate(ctx, 'chat_member');
  const upd = ctx.update.chat_member || ctx.update.my_chat_member;
  const user = upd?.new_chat_member?.user;
  const status = upd?.new_chat_member?.status;
  if (!user) return;
  if (!['member', 'administrator', 'creator'].includes(status)) return;

  const tgId = user.id;

  const r = await query(
    `
    SELECT click_id, offer_id, uid
    FROM attribution
    WHERE tg_id=$1 AND state='started'
      AND created_at >= NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC LIMIT 1
  `,
    [tgId],
  );
  if (!r.rowCount) return;

  const { click_id: attrClickId, offer_id, uid } = r.rows[0];
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
  } catch (e) {
    console.error('postback error:', e?.message || e);
  }

  try {
    await approveJoin({ offer_id, tg_id: tgId, click_id });
  } catch (e) {
    console.error('approveJoin error:', e?.message || e);
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
      [offerId]
    );

    if (!offer.rowCount) {
      await ctx.reply('⛔️ Оффер не найден.');
      return;
    }

    const payoutCents = Number(offer.rows[0]?.payout_cents ?? 0);

    const { ok } = await joinCheck({
      offer_id: offerId,
      tg_id: tgId,
      telegram: ctx.telegram,
    });

    if (!ok) {
      await ctx.reply('Пока не видим вступления…');
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

    await ctx.reply('✅ Готово!');
  } catch (error) {
    console.error('check handler error', error?.message || error);
    await ctx.reply('⚠️ Произошла ошибка. Попробуйте позже.');
  }
});

bot.catch((err, ctx) => console.error('[TELEGRAF] error', ctx.update?.update_id, err?.stack || err));
process.on('unhandledRejection', (e) => console.error('[UNHANDLED]', e?.stack || e));

// Безопасная остановка в webhook-режиме
function safeStop(reason) {
  try {
    bot.stop(reason);
  } catch (e) {
    if (!e || e.message !== 'Bot is not running!') {
      console.error(e);
    }
  }
}

process.once('SIGINT', () => safeStop('SIGINT'));
process.once('SIGTERM', () => safeStop('SIGTERM'));

// ---- Webhook export (один раз, внизу файла)
export const webhookCallback = bot.webhookCallback(process.env.WEBHOOK_PATH, {
  secretToken: process.env.WEBHOOK_SECRET || 'prod-secret',
});

export default bot;
