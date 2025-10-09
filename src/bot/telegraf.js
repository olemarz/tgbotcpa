// src/bot/telegraf.js
import { Telegraf, Scenes, session } from 'telegraf';
import adsWizard from './adsWizard.js';

// ---- Инициализация бота ----
if (!config.botToken) {
  throw new Error('BOT_TOKEN is required');
}

export const bot = new Telegraf(process.env.BOT_TOKEN);

const stage = new Scenes.Stage([adsWizard]);
bot.use(session());
bot.use(stage.middleware());

// простой логгер апдейтов
bot.use(async (ctx, next) => {
  try {
    const t = ctx.message?.text || ctx.callbackQuery?.data;
    console.log('➡️ update', {
      from: ctx.from?.id,
      text: t,
      type: Object.keys(ctx.update)
    });
  } catch (e) {}
  return next();
});

// ---- Сцены (мастер /ads) ----
const stage = new Scenes.Stage([adsWizard]);
bot.use(session());             // важно: должна идти ДО stage.middleware()
bot.use(stage.middleware());

// ---- Команды ----
bot.start(async (ctx) => {
  await ctx.reply(
    '👋 Привет! Бот на вебхуке готов. Напиши /whoami или /ads',
    Markup.inlineKeyboard([[Markup.button.url('Док', 'https://t.me')]])
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
if (process.env.NODE_ENV === 'dev' && !process.env.WEBHOOK_PATH) {
  const port = Number(process.env.PORT || 3000);
  bot.launch().then(() => console.log('Bot polling on', port));
}

// Корректное завершение
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
