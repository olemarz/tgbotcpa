import { bot } from './telegraf.js';
bot.launch().then(()=>console.log('Bot launched (long polling)'));
