// src/bot/telegraf.js
import { Telegraf, Scenes, session, Markup } from 'telegraf';
import adsWizard from './adsWizard.js';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { uuid } from '../util/id.js';
import { sendPostback } from '../services/postback.js';

// ---- Инициализация бота ----
if (!config.botToken) {
  throw new Error('BOT_TOKEN is required');
}

const bot = new Telegraf(config.botToken);

// лёгкий лог апдейтов (debug)
bot.use(async (ctx, next) => {
  console.log('➡️ update', ctx.updateType, {
    text: ctx.message?.text,
    data: ctx.callbackQuery?.data,
    from: ctx.from?.id,
    chat: ctx.chat?.id
  });
  return next();
});

// session — строго ДО stage
bot.use(session());

// сцены
const stage = new Scenes.Stage([adsWizard]);
bot.use(stage.middleware());

// ---- Команды ----

const JOIN_GROUP_EVENT = 'join_group';
const CHAT_MEMBER_TYPES = new Set(['group', 'supergroup', 'channel']);
const JOIN_STATUSES = new Set(['member', 'administrator', 'creator']);
const ATTRIBUTION_LOOKBACK_MS = 24 * 60 * 60 * 1000;

async function sendDefaultStartReply(ctx) {
  await ctx.reply(
    '👋 Привет! Бот на вебхуке готов. Напиши /whoami или /ads',
    Markup.inlineKeyboard([
      [
        Markup.button.url(
          'Документация',
          'https://github.com/olemarz/tgbotcpa/blob/main/docs/SUMMARY.md'
        )
      ]
    ])
  );
}

export async function handleStart(ctx) {
  const startToken = ctx.startPayload?.trim();
  const tgId = ctx.from?.id;

  if (!startToken || !tgId) {
    await sendDefaultStartReply(ctx);
    return;
  }

  try {
    const { rows } = await query(
      `SELECT c.id, c.offer_id, c.uid, o.target_url, o.event_type
       FROM clicks c
       JOIN offers o ON o.id = c.offer_id
       WHERE c.start_token = $1
       ORDER BY c.created_at DESC
       LIMIT 1`,
      [startToken]
    );

    if (!rows.length) {
      await ctx.reply('Ссылка устарела');
      console.warn('start token not found', { start_token: startToken, tg_id: tgId });
      return;
    }

    const click = rows[0];

    const updateResult = await query(
      `UPDATE clicks
         SET tg_id = $1,
             used_at = now()
       WHERE id = $2 AND (tg_id IS NULL OR tg_id = $1)
       RETURNING id`,
      [tgId, click.id]
    );

    if (!updateResult.rowCount) {
      await ctx.reply('Ссылка уже использована другим пользователем.');
      console.warn('start token already claimed', { start_token: startToken, tg_id: tgId });
      return;
    }

    const attributionId = uuid();

    await query(
      `INSERT INTO attribution (id, click_id, offer_id, uid, tg_id, state)
       VALUES ($1, $2, $3, $4, $5, 'started')`,
      [attributionId, click.id, click.offer_id, click.uid ?? null, tgId]
    );

    console.log('attribution started', {
      tg_id: tgId,
      offer_id: click.offer_id,
      click_id: click.id,
      start_token: startToken,
    });

    if (click.event_type === JOIN_GROUP_EVENT && click.target_url) {
      await ctx.reply(
        'Нажмите, чтобы вступить в группу. После вступления мы автоматически зафиксируем событие.',
        Markup.inlineKeyboard([[Markup.button.url('✅ Вступить в группу', click.target_url)]])
      );
      return;
    }
  } catch (error) {
    console.error('start handler attribution error', { error, start_token: startToken, tg_id: tgId });
  }

  await sendDefaultStartReply(ctx);
}

bot.start(handleStart);

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
    // не отвечаем «echo:/ads», если пользователь в сцене
    if (!ctx.scene?.current) {
      await ctx.reply('echo: ' + ctx.message.text);
    }
  } catch (e) {
    console.error('❌ send error', e);
  }
  return next();
});

async function handleChatMember(ctx, next) {
  const update = ctx.update?.chat_member ?? ctx.update?.my_chat_member;
  const chatType = update?.chat?.type ?? ctx.chat?.type;
  const newMember = update?.new_chat_member;
  const tgId = newMember?.user?.id;
  const status = newMember?.status;

  if (!update || !CHAT_MEMBER_TYPES.has(chatType) || !JOIN_STATUSES.has(status) || !tgId || newMember.user?.is_bot) {
    return next();
  }

  try {
    const { rows } = await query(
      `SELECT a.id, a.offer_id, a.uid, a.click_id, a.created_at, o.event_type
       FROM attribution a
       JOIN offers o ON o.id = a.offer_id
       WHERE a.tg_id = $1
         AND a.state = 'started'
         AND a.created_at >= now() - interval '24 hours'
       ORDER BY a.created_at DESC
       LIMIT 1`,
      [tgId]
    );

    if (!rows.length) {
      return next();
    }

    const attribution = rows[0];
    if (attribution.event_type !== JOIN_GROUP_EVENT) {
      return next();
    }

    const createdAt = new Date(attribution.created_at);
    if (Number.isNaN(createdAt.getTime()) || Date.now() - createdAt.getTime() > ATTRIBUTION_LOOKBACK_MS) {
      return next();
    }

    await query('INSERT INTO events (offer_id, tg_id, type) VALUES ($1, $2, $3)', [
      attribution.offer_id,
      tgId,
      JOIN_GROUP_EVENT,
    ]);

    await query('UPDATE attribution SET state = $1 WHERE id = $2', ['converted', attribution.id]);

    try {
      await sendPostback({
        offer_id: attribution.offer_id,
        tg_id: tgId,
        uid: attribution.uid,
        click_id: attribution.click_id,
        event: JOIN_GROUP_EVENT,
      });
    } catch (error) {
      console.error('sendPostback error', {
        error: error?.message,
        offer_id: attribution.offer_id,
        tg_id: tgId,
      });
    }
  } catch (error) {
    console.error('chat_member handler error', error);
  }

  return next();
}

bot.on('chat_member', handleChatMember);
bot.on('my_chat_member', handleChatMember);

// ---- Экспорт обработчика вебхука для Express (всегда 200) ----
const webhookPath = config.webhookPath || '/bot/webhook';
export const webhookCallback = bot.webhookCallback(webhookPath);

export { bot };
export default bot;

// Для локального запуска (не на PM2/не на вебхуке)
if (config.nodeEnv === 'dev' && !config.webhookPath) {
  bot.launch().then(() => console.log('Bot polling on', config.port));
}

// Корректное завершение
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
