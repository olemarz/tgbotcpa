import 'dotenv/config';

export const config = {
  botToken: process.env.BOT_TOKEN,
  baseUrl: process.env.BASE_URL,
  port: parseInt(process.env.PORT || '3000', 10),
  dbUrl: process.env.DATABASE_URL,
  cpaPostbackUrl: process.env.CPA_POSTBACK_URL,
  cpaSecret: process.env.CPA_PB_SECRET,
  allowedUpdates: (process.env.ALLOWED_UPDATES || '').split(',').map(s => s.trim()).filter(Boolean),
  tz: process.env.TZ || 'Europe/Rome',
  MIN_RATES: {
    join_group: { base: 5, premium: 10 },
    forward: { base: 2, premium: 7 },
    reaction: { base: 1, premium: 5 },
    comment: { base: 3, premium: 10 },
    paid: { base: 30, premium: 30 },
    start_bot: { base: 3, premium: 10 }
  }
};

if (!config.botToken) throw new Error('BOT_TOKEN is required');
if (!config.baseUrl) throw new Error('BASE_URL is required');
if (!config.dbUrl) throw new Error('DATABASE_URL is required');
if (!config.cpaPostbackUrl) throw new Error('CPA_POSTBACK_URL is required');
if (!config.cpaSecret) { console.warn('CPA_PB_SECRET not set: signature checks disabled'); config.cpaSecret = 'dev-secret'; }
