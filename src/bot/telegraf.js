/* eslint-disable no-console */
import 'dotenv/config';
import { Telegraf, Scenes, session, Markup } from 'telegraf';
import { sessionStore } from './sessionStore.js';
import { adsWizardScene, startAdsWizard } from './adsWizard.js';

// ---- BOT TOKEN ----
const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
console.log('[BOOT] BOT_TOKEN len=', BOT_TOKEN.length || 0);
if (!BOT_TOKEN) {
  console.error('[BOOT] BOT_TOKEN is empty – check .env');
  process.exit(1);
}

// ---- BOT INSTANCE ----
export const bot = new Telegraf(BOT_TOKEN);

// ---- Scenes ----
const stage = new Scenes.Stage([adsWizardScene]);

// ---- Admins (optional) ----
const ADMIN_IDS = new Set(
  (process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
function isAdmin(ctx) {
  const id = ctx.from?.id;
  return id != null && ADMIN_IDS.has(String(id));
}

// ---- Session ----
bot.use(
  session({
    store: sessionStore,
    getSessionKey(ctx) {
      const fromId = ctx.from?.id;
      if (!['string', 'number', 'bigint'].includes(typeof fromId)) {
        return undefined;
      }
      const key = String(fromId);
      return /^[0-9]+$/.test(key) ? key : undefined;
    },
  })
);
bot.use(stage.middleware());

// ---- optional link-capture ----
(async () => {
  try {
    if (process.env.DISABLE_LINK_CAPTURE !== 'true') {
      const { default: linkCapture } = await import('./link-capture.js');
      bot.use(linkCapture());
    } else {
      console.log('[BOOT] link-capture DISABLED');
    }
  } catch (e) {
    console.warn('[BOOT] link-capture load skipped:', e?.message || e);
  }
})();

// ===== TRACE middleware (diag) =====
bot.use(async (ctx, next) => {
  try {
    const u = ctx.update;
    const txt =
      u?.message?.text ??
      u?.callback_query?.data ??
      (u?.my_chat_member ? 'chat_member' : null);
    console.log(
      '[TRACE:IN ] type=%s text=%j ents=%s',
      Object.keys(u || {})[0] || 'unknown',
      txt,
      u?.message?.entities ? 'yes' : 'null'
    );
    await next();
  } finally {
    const outText = ctx?.state?.__lastReplyText || null;
    console.log(
      '[TRACE:OUT] type=%s text=%j',
      Object.keys(ctx.update || {})[0] || 'unknown',
      outText
    );
  }
});

// ===== helpers =====
async function handleStartWithToken(ctx, rawPayload) {
  const token = String(rawPayload || '').trim();
  if (!token) {
    return ctx.reply('Нужен токен кампании. Используйте:\n/claim <TOKEN>');
  }
  // TODO: ваша реальная логика обработки токена
  return ctx.reply(`Принял токен кампании: ${token}`);
}

// ===== commands =====

// /ads — запуск мастера объявлений
bot.command('ads', async (ctx) => {
  console.log('[ADS] startAdsWizard invoked, hasScene=', !!ctx.scene);
  await startAdsWizard(ctx, {});
});

// /claim <TOKEN> — ручная передача токена
bot.command('claim', async (ctx) => {
  const text = ctx.message?.text || '';
  const m = text.match(/^\/claim(?:@[\w_]+)?\s+(\S+)$/i);
  const token = m?.[1] || '';
  if (!token) {
    return ctx.reply('Использование: /claim <TOKEN>');
  }
  return handleStartWithToken(ctx, token);
});

// /start — с payload или подсказка
bot.start(async (ctx) => {
  const raw = ctx.startPayload;
  if (typeof raw === 'string' && raw.trim()) {
    return handleStartWithToken(ctx, raw.trim());
  }
  return ctx.reply(
    'Это /start без параметра кампании. Нажмите ссылку из оффера или пришлите токен командой:\n/claim <TOKEN>'
  );
});

// ===== error handler =====
bot.catch((err, ctx) => {
  console.error('[TELEGRAF] error', ctx.update?.update_id, err);
});
