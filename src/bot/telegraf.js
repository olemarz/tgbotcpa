// src/bot/telegraf.js
import { Telegraf, Scenes, session, Markup } from 'telegraf';
import { config } from '../config.js';
import { adsWizard } from './adsWizard.js';

// ---- Инициализация бота ----
if (!config.botToken) {
  throw new Error('BOT_TOKEN is required');
}
export const bot = new Telegraf(config.botToken, {
  handlerTimeout: 30_000,
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

// ВАЖНО: эта команда переводит пользователя в мастер
bot.command('ads', (ctx) => ctx.scene.enter('ads-wizard'));

// Пока заглушка
bot.command('statistic', async (ctx) => {
  await ctx.reply('📊 Статистика в разработке. Для теста постбеков используй /debug-ручки на сервере.');
});

bot.command('debug', async (ctx) => {
  await ctx.reply('🔧 Тестовые ручки включены на сервере: /debug/seed_offer и /debug/complete.');
});

// Логируем и эхо на произвольный текст (полезно в отладке)
bot.on('text', async (ctx) => {
  console.log('🗣 text', ctx.from?.id, '->', ctx.message?.text);
  try {
    // не отвечаем «echo:/ads», если пользователь в сцене
    if (!ctx.scene?.current) {
      await ctx.reply('echo: ' + ctx.message.text);
    }
  } catch (e) {
    console.error('❌ send error', e);
  }
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
