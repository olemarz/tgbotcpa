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
bot.start(async (ctx) => {
  const startToken = ctx.startPayload?.trim();
  const tgId = ctx.from?.id;

  if (startToken && tgId) {
    try {
      const { rows } = await query(
        `SELECT id, offer_id, uid, click_id
         FROM clicks
         WHERE start_token = $1 AND used_at IS NULL
         LIMIT 1`,
        [startToken]
      );

      if (rows.length) {
        const click = rows[0];
        await query(
          `INSERT INTO attribution (id, click_id, offer_id, uid, tg_id, state)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [uuid(), click.id, click.offer_id, click.uid, tgId, 'started']
        );
        await query('UPDATE clicks SET used_at = now(), tg_id = $1 WHERE id = $2', [tgId, click.id]);
        console.log('attribution started', {
          tg_id: tgId,
          offer_id: click.offer_id,
          start_token: startToken,
        });
      } else {
        console.warn('start token not found or already used', { start_token: startToken, tg_id: tgId });
      }
    } catch (error) {
      console.error('start handler attribution error', { error, start_token: startToken, tg_id: tgId });
    }
  }

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
    // не отвечаем «echo:/ads», если пользователь в сцене
    if (!ctx.scene?.current) {
      await ctx.reply('echo: ' + ctx.message.text);
    }
  } catch (e) {
    console.error('❌ send error', e);
  }
  return next();
});

const CHAT_MEMBER_TYPES = new Set(['group', 'supergroup', 'channel']);
const JOIN_STATUSES = new Set(['member', 'administrator', 'creator']);
const ATTRIBUTION_LOOKBACK_MS = 24 * 60 * 60 * 1000;

bot.on('chat_member', async (ctx, next) => {
  const update = ctx.update?.chat_member;
  const chatType = ctx.chat?.type;
  const tgId = update?.new_chat_member?.user?.id;
  const status = update?.new_chat_member?.status;

  if (!update || !CHAT_MEMBER_TYPES.has(chatType) || !JOIN_STATUSES.has(status) || !tgId) {
    return next();
  }

  try {
    const { rows } = await query(
      `SELECT a.id, a.offer_id, a.uid, a.click_id, a.created_at, c.click_id AS external_click_id
       FROM attribution a
       JOIN clicks c ON c.id = a.click_id
       WHERE a.tg_id = $1 AND a.state = 'started'
       ORDER BY a.created_at DESC
       LIMIT 1`,
      [tgId]
    );

    if (!rows.length) {
      return next();
    }

    const attribution = rows[0];
    const createdAt = new Date(attribution.created_at);
    if (Number.isNaN(createdAt.getTime()) || Date.now() - createdAt.getTime() > ATTRIBUTION_LOOKBACK_MS) {
      return next();
    }

    await query('INSERT INTO events (id, offer_id, tg_id, type) VALUES ($1, $2, $3, $4)', [
      uuid(),
      attribution.offer_id,
      tgId,
      'join_group',
    ]);

    await query('UPDATE attribution SET state = $1 WHERE id = $2', ['converted', attribution.id]);

    try {
      await sendPostback({
        offer_id: attribution.offer_id,
        tg_id: tgId,
        uid: attribution.uid,
        click_id: attribution.external_click_id,
        event: 'join_group',
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
});

// ---- Экспорт обработчика вебхука для Express (всегда 200) ----
export const webhookCallback = bot.webhookCallback('/bot/webhook');

export { bot };
export default bot;

// Для локального запуска (не на PM2/не на вебхуке)
if (config.nodeEnv === 'dev' && !config.webhookPath) {
  bot.launch().then(() => console.log('Bot polling on', config.port));
}

// Корректное завершение
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
