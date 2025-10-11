import 'dotenv/config';
import { bot } from './telegraf.js';

const username = process.env.BOT_USERNAME ? `@${process.env.BOT_USERNAME}` : 'bot';
console.log(`[bot] Webhook mode active for ${username}.`);
console.log('[bot] Start the API server to receive updates via webhook.');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
