// src/bot/telegraf.js
import { Telegraf } from 'telegraf';

if (!process.env.BOT_TOKEN) {
  console.error('BOT_TOKEN is not set');
}

export const bot = new Telegraf(process.env.BOT_TOKEN);

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

// /start
bot.start(async (ctx) => {
  await ctx.reply('👋 Привет! Бот на вебхуке готов. Напиши /whoami');
});

// /whoami
bot.command('whoami', async (ctx) => {
  try {
    await ctx.reply(`Your Telegram ID: ${ctx.from?.id}`);
  } catch (e) {
    console.error('❌ whoami send error', e);
  }
});

// эхо на любой текст
bot.on('text', async (ctx) => {
  console.log('🗣 text', ctx.from?.id, '->', ctx.message?.text);
  try {
    await ctx.reply('echo: ' + ctx.message.text);
  } catch (e) {
    console.error('❌ send error', e);
  }
});

// ❗ Экспорт готового обработчика от Telegraf
export const webhookCallback = bot.webhookCallback('/bot/webhook', {
  timeout: 30000, // можно убрать, но пусть будет
});
