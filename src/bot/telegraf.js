// src/bot/telegraf.js
import { Telegraf, Scenes, session, Markup } from 'telegraf';
import adsWizard from './adsWizard.js';
import { config } from '../config.js';

// ---- Инициализация бота ----
if (!config.botToken) {
  throw new Error('BOT_TOKEN is required');
}

export const bot = new Telegraf(config.botToken);

const stage = new Scenes.Stage([adsWizard]);

bot.use(session());
bot.use(stage.middleware());

const logUpdate = (ctx) => {
  const text = ctx.message?.text || ctx.callbackQuery?.data;
  console.log('➡️ update', {
    from: ctx.from?.id,
    text,
    type: Object.keys(ctx.update)
  });
};

// простой логгер апдейтов
bot.use(async (ctx, next) => {
  try {
    logUpdate(ctx);
  } catch (e) {
    // swallow logging errors to avoid breaking middleware chain
  }
  return next();
});

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
export const webhookCallback = async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
  } catch (e) {
    console.error('webhook error:', e);
  }
  res.sendStatus(200);
};

// Для локального запуска (не на PM2/не на вебхуке)
if (config.nodeEnv === 'dev' && !config.webhookPath) {
  bot.launch().then(() => console.log('Bot polling on', config.port));
}

// Корректное завершение
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
