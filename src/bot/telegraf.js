// src/bot/telegraf.js
import TelegrafPkg, { Telegraf, Scenes, session } from 'telegraf';
import adsWizard from './adsWizard.js';
import { query } from '../db/index.js';
import { sendPostback } from '../services/postback.js';
import { uuid, shortToken } from '../util/id.js';

// ---- Инициализация бота ----
const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is required');
}

export const bot = new Telegraf(token);

export function logUpdate(ctx, tag = 'update') {
  const u = ctx.update || {};
  console.log('[tg]', tag, {
    types: Object.keys(u),
    from: ctx.from ? { id: ctx.from.id, is_bot: ctx.from.is_bot } : null,
    text: ctx.message?.text,
    startPayload: ctx.startPayload,
  });
}

// session — строго ДО stage
bot.use(session());

// сцены
const stage = new Scenes.Stage([adsWizard]);
bot.use(stage.middleware());

// ---- Команды ----

const JOIN_GROUP_EVENT = 'join_group';

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
    return;
  }

  await ctx.reply('Готово! Продолжайте в боте.');
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
bot.hears(/^\/claim\s+(\S+)/i, async (ctx) => {
  logUpdate(ctx, 'claim');
  const token = ctx.match[1];
  return handleStartWithToken(ctx, token);
});

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

bot.command('ads', (ctx) => ctx.scene.enter('ads-wizard'));

// эхо на любой текст (вне сцен)
bot.on('text', async (ctx, next) => {
  if (ctx.scene?.current) return next();
  if (ctx.message?.text?.startsWith('/')) return next();
  console.log('🗣 text', ctx.from?.id, '->', ctx.message?.text);
  try {
    if (!ctx.scene?.current) {
      await ctx.reply('echo: ' + ctx.message.text);
    }
  } catch (e) {
    console.error('❌ send error', e);
  }
  return next();
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
    SELECT id, click_id, offer_id, uid
    FROM attribution
    WHERE tg_id=$1 AND state='started'
      AND created_at >= NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC LIMIT 1
  `,
    [tgId],
  );
  if (!r.rowCount) return;

  const { id: attrId, click_id, offer_id, uid } = r.rows[0];
  const existing = await query(
    `SELECT id FROM events WHERE offer_id=$1 AND tg_id=$2 AND type=$3 LIMIT 1`,
    [offer_id, tgId, JOIN_GROUP_EVENT],
  );
  if (existing.rowCount) {
    await query(`UPDATE attribution SET state='converted' WHERE id=$1`, [attrId]);
    return;
  }

  await query(`INSERT INTO events(offer_id, tg_id, type) VALUES($1,$2,$3)`, [offer_id, tgId, JOIN_GROUP_EVENT]);
  const updated = await query(
    `UPDATE attribution SET state='converted' WHERE id=$1 RETURNING id`,
    [attrId],
  );

  try {
    if (updated.rowCount) {
      await sendPostback({ offer_id, tg_id: tgId, uid, click_id, event: JOIN_GROUP_EVENT });
    }
  } catch (e) {
    console.error('postback error:', e?.message || e);
  }
});

// ---- Экспорт обработчика вебхука для Express (всегда 200) ----
// Webhook callback, используется сервером
const secretToken = process.env.WEBHOOK_SECRET || 'prod-secret';
const webhookPath = process.env.WEBHOOK_PATH || '/bot/webhook';
const telegrafWebhookFactory =
  typeof TelegrafPkg?.webhookCallback === 'function' ? TelegrafPkg.webhookCallback : null;

export const webhookCallback = telegrafWebhookFactory
  ? telegrafWebhookFactory(bot, { secretToken })
  : bot.webhookCallback(webhookPath, { secretToken });

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
