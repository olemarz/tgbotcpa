// src/bot/telegraf.js
import { Telegraf, Scenes, session, Markup } from 'telegraf';
import adsWizard from './adsWizard.js';
import { config } from '../config.js';

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
