import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Scenes, Markup } from 'telegraf';
import { EVENT_ORDER, EVENT_TYPES } from './constants.js';
import { config } from '../config.js';
import { query, insertOfferAuditLog } from '../db/index.js';
import { uuid } from '../util/id.js';
import { buildTrackingUrl } from '../utils/tracking-link.js';

const logPrefix = '[adsWizard]';

const eventLabels = {
  [EVENT_TYPES.join_group]: 'Вступление в группу/канал',
  [EVENT_TYPES.forward]: 'Пересылка сообщения',
  [EVENT_TYPES.reaction]: 'Реакция на сообщение',
  [EVENT_TYPES.comment]: 'Комментарий',
  [EVENT_TYPES.paid]: 'Платное действие / покупка',
  [EVENT_TYPES.start_bot]: 'Старт бота / мини-аппа',
};

const minRates = config.MIN_RATES || {};

const allowedTelegramHosts = new Set(['t.me', 'telegram.me', 'telegram.dog']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const linksLogPath = path.resolve(__dirname, '../../var/links.log');

const CANCEL_KEYWORDS = new Set(['/cancel', 'отмена', '[отмена]', 'cancel']);
const BACK_KEYWORDS = new Set(['/back', 'назад', '[назад]']);

const Step = {
  INTRO: 0,
  TARGET_URL: 1,
  EVENT_TYPE: 2,
  BASE_BID: 3,
  PREMIUM_BID: 4,
  TOTAL_CAP: 5,
  CONFIRM: 6,
};

const STEP_NUMBERS = {
  [Step.TARGET_URL]: 1,
  [Step.EVENT_TYPE]: 2,
  [Step.BASE_BID]: 3,
  [Step.PREMIUM_BID]: 4,
  [Step.TOTAL_CAP]: 5,
};

const TOTAL_INPUT_STEPS = 6;

let offersColumnsPromise;
async function getOffersColumns() {
  if (!offersColumnsPromise) {
    offersColumnsPromise = query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'offers'`
    ).then((res) => new Set(res.rows.map((row) => row.column_name)));
  }
  return offersColumnsPromise;
}

async function logTrackingLink(offerId, title, trackingUrl) {
  try {
    await fs.mkdir(path.dirname(linksLogPath), { recursive: true });
    const line = `${new Date().toISOString()},${offerId},${JSON.stringify(title ?? '')},${trackingUrl}\n`;
    await fs.appendFile(linksLogPath, line, 'utf8');
  } catch (error) {
    console.error(`${logPrefix} failed to write tracking log`, { offerId, error: error?.message });
  }
}

async function notifyChat(telegram, chatId, text) {
  if (!chatId) return;
  try {
    await telegram.sendMessage(chatId, text);
  } catch (error) {
    console.error(`${logPrefix} failed to notify chat`, { chatId, error: error?.message });
  }
}

async function slugExists(slug) {
  const res = await query('SELECT 1 FROM offers WHERE slug = $1 LIMIT 1', [slug]);
  return res.rowCount > 0;
}

async function ensureUniqueSlug(base) {
  let slug = base;
  let counter = 2;
  while (await slugExists(slug)) {
    const suffix = `-${counter}`;
    const trimmed = base.slice(0, Math.max(0, 60 - suffix.length));
    slug = `${trimmed}${suffix}`;
    counter += 1;
  }
  return slug;
}

function parseNumber(text) {
  if (!text) return null;
  const normalized = text.replace(',', '.');
  if (!/^\d+(?:[.,]\d+)?$/.test(normalized.trim())) {
    return null;
  }
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function formatCapsTotal(value) {
  if (!value) return 'без ограничений';
  return String(value);
}

function formatChatRef(chatRef) {
  if (!chatRef) return '—';
  const parts = [];
  if (chatRef.type) parts.push(chatRef.type);
  if (chatRef.title) parts.push(chatRef.title);
  if (chatRef.username) parts.push(`@${chatRef.username}`);
  if (chatRef.start_param) parts.push(`start=${chatRef.start_param}`);
  if (chatRef.startapp_param) parts.push(`startapp=${chatRef.startapp_param}`);
  if (!parts.length && chatRef.id) parts.push(`#${chatRef.id}`);
  return parts.join(' · ');
}

function formatRate(value) {
  return `${value} ₽`;
}

function autoTitleFromLink(link) {
  if (!link) {
    return 'Offer';
  }

  try {
    const url = new URL(link);
    const segments = url.pathname.split('/').filter(Boolean);

    for (const segment of segments) {
      if (segment && segment.toLowerCase() !== 'c') {
        return segment;
      }
    }

    if (segments.length > 0) {
      return segments[segments.length - 1] || 'Offer';
    }

    const hostname = url.hostname.replace(/^www\./, '');
    if (hostname) {
      const base = hostname.split('.')[0];
      if (base) {
        return base;
      }
    }
  } catch (error) {
    // ignore
  }

  return 'Offer';
}

function autoSlugFromTitle(title) {
  const normalized = String(title || 'offer')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const base = normalized || 'offer';
  const suffix = Math.random().toString(16).slice(2, 8);
  const trimmed = base.slice(0, Math.max(1, 60 - suffix.length - 1));
  return `${trimmed}-${suffix}`;
}

function markAwaitingTargetLink(ctx) {
  if (!ctx.session) {
    ctx.session = {};
  }
  ctx.session.mode = 'offer:create';
  ctx.session.awaiting = 'target_link';
  delete ctx.session.target_link;
  delete ctx.session.raw_target_link;
}

function clearAwaitingTargetLink(ctx) {
  if (!ctx.session) {
    return;
  }
  if (ctx.session.mode === 'offer:create') {
    delete ctx.session.mode;
  }
  if (ctx.session.awaiting === 'target_link') {
    delete ctx.session.awaiting;
  }
}

function getMessageText(ctx) {
  return ctx.message?.text?.trim();
}

function isCancel(ctx) {
  const text = getMessageText(ctx);
  if (!text) return false;
  return CANCEL_KEYWORDS.has(text.toLowerCase());
}

function isBack(ctx) {
  const text = getMessageText(ctx);
  if (!text) return false;
  return BACK_KEYWORDS.has(text.toLowerCase());
}

async function cancelWizard(ctx, message = 'Мастер отменён.') {
  clearAwaitingTargetLink(ctx);
  if (ctx.session) {
    delete ctx.session.target_link;
    delete ctx.session.raw_target_link;
  }
  await ctx.reply(message);
  return ctx.scene.leave();
}

// Там, где показывается шаг "Пришлите ссылку на канал/чат"
async function promptTargetUrl(ctx) {
  const stepNum = STEP_NUMBERS[Step.TARGET_URL];
  markAwaitingTargetLink(ctx);
  await ctx.reply(
    `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Пришлите ссылку на канал/группу/бота в формате https://t.me/...\n` +
      'Команды: [Отмена] — выйти из мастера.'
  );
}

function buildEventKeyboard() {
  const rows = EVENT_ORDER.map((type) => [
    Markup.button.callback(eventLabels[type] || type, `event:${type}`),
  ]);
  rows.push([Markup.button.callback('↩️ Назад', 'nav:back')]);
  return Markup.inlineKeyboard(rows);
}

async function promptEventType(ctx) {
  const stepNum = STEP_NUMBERS[Step.EVENT_TYPE];
  await ctx.reply(
    `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Выберите тип целевого действия:`,
    buildEventKeyboard()
  );
}

async function promptBaseBid(ctx) {
  const { action_type: actionType } = ctx.wizard.state.offer;
  const min = Math.max(5, minRates[actionType]?.base ?? 0);
  const stepNum = STEP_NUMBERS[Step.BASE_BID];
  await ctx.reply(
    `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Введите базовую ставку, не ниже ${min}.\n` +
      'Можно использовать точку или запятую как разделитель. Команды: [Назад], [Отмена].'
  );
}

async function promptPremiumBid(ctx) {
  const stepNum = STEP_NUMBERS[Step.PREMIUM_BID];
  const { base_bid: baseBid, action_type: actionType } = ctx.wizard.state.offer;
  const minPremium = Math.max(baseBid ?? 0, 10, minRates[actionType]?.premium ?? 0);
  await ctx.reply(
    `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Введите ставку для премиум-пользователей (не ниже ${minPremium}).\n` +
      'Она не может быть ниже базовой ставки, 10 ₽ или минимального порога для премиума. Команды: [Назад], [Отмена].'
  );
}

async function promptTotalCap(ctx) {
  const stepNum = STEP_NUMBERS[Step.TOTAL_CAP];
  await ctx.reply(
    `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Введите общий лимит конверсий (целое число, 0 = без ограничений).\n` +
      'Команды: [Назад], [Отмена].'
  );
}

function parseTelegramUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new Error('Не получилось разобрать ссылку. Проверьте формат https://t.me/...');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Нужна защищённая ссылка https://t.me/...');
  }

  if (!allowedTelegramHosts.has(url.hostname.toLowerCase())) {
    throw new Error('Сейчас поддерживаются только ссылки на t.me.');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (!segments.length) {
    throw new Error('Ссылка должна содержать username или идентификатор ресурса.');
  }

  return {
    url,
    segments,
    normalized: `https://t.me/${segments.join('/')}${url.search}`,
    searchParams: url.searchParams,
  };
}

function buildChatLookup(parsed) {
  const [first, second, third] = parsed.segments;

  if (first === 'c') {
    if (!second || !/^\d+$/.test(second)) {
      throw new Error('Ссылка вида t.me/c/... должна содержать числовой идентификатор чата.');
    }
    const internalId = `-100${second}`;
    const messageId = third && /^\d+$/.test(third) ? Number(third) : null;
    const threadIdParam = parsed.searchParams.get('thread') || parsed.searchParams.get('comment');
    const threadId = threadIdParam && /^\d+$/.test(threadIdParam) ? Number(threadIdParam) : null;
    return {
      chatId: Number(internalId),
      messageId,
      threadId,
      username: null,
      linkType: 'internal',
    };
  }

  if (/^\+/.test(first) || first.toLowerCase() === 'joinchat') {
    throw new Error('Инвайт-ссылки t.me/+... не подходят. Укажите публичный @username чата или бота.');
  }

  if (!/^[a-zA-Z0-9_]{5,32}$/.test(first)) {
    throw new Error('Username должен содержать 5–32 символа: латиница, цифры и подчёркивания.');
  }

  const messageId = second && /^\d+$/.test(second) ? Number(second) : null;
  const threadIdParam = parsed.searchParams.get('thread') || parsed.searchParams.get('comment');
  const threadId = threadIdParam && /^\d+$/.test(threadIdParam) ? Number(threadIdParam) : null;

  return {
    chatId: `@${first}`,
    username: first,
    messageId,
    threadId,
    linkType: 'username',
  };
}

async function resolveTelegramTarget(ctx, rawUrl) {
  const parsed = parseTelegramUrl(rawUrl);
  const lookup = buildChatLookup(parsed);

  let chat;
  try {
    chat = await ctx.telegram.getChat(lookup.chatId);
  } catch (error) {
    console.warn(`${logPrefix} target lookup failed`, {
      reason: error?.response?.description || error?.message,
      lookup: typeof lookup.chatId === 'string' ? lookup.chatId : 'id',
    });
    throw new Error(
      'Не удалось проверить ссылку в Telegram. Убедитесь, что бот добавлен в чат и имеет права на просмотр.'
    );
  }

  const titleParts = [chat.title, chat.first_name, chat.last_name].filter(Boolean);
  const title = titleParts.join(' ') || chat.username || chat.id;
  const isBot = typeof chat.username === 'string' && chat.username.toLowerCase().endsWith('bot');

  const targetMeta = {
    normalizedUrl: parsed.normalized,
    chatId: chat.id,
    chatType: chat.type,
    title,
    username: chat.username || lookup.username || undefined,
    messageId: lookup.messageId,
    threadId: lookup.threadId,
    isForum: Boolean(chat.is_forum),
    isBot,
    startParam: (() => {
      const value = parsed.searchParams.get('start');
      return value && value.trim() ? value.trim() : undefined;
    })(),
    startAppParam: (() => {
      const value = parsed.searchParams.get('startapp');
      return value && value.trim() ? value.trim() : undefined;
    })(),
    linkType: lookup.linkType,
  };

  console.info(`${logPrefix} target resolved`, {
    chatType: targetMeta.chatType,
    hasMessage: Boolean(targetMeta.messageId),
    linkType: targetMeta.linkType,
    hasStartParam: Boolean(targetMeta.startParam || targetMeta.startAppParam),
  });

  return targetMeta;
}

function ensureEventCompatibility(targetMeta, eventType) {
  if (!targetMeta) {
    return 'Сначала укажите ссылку на ресурс.';
  }

  switch (eventType) {
    case EVENT_TYPES.join_group: {
      if (!['group', 'supergroup', 'channel'].includes(targetMeta.chatType)) {
        return 'Для вступления нужна ссылка на группу или канал.';
      }
      break;
    }
    case EVENT_TYPES.forward:
    case EVENT_TYPES.reaction:
    case EVENT_TYPES.comment: {
      if (!targetMeta.messageId) {
        return 'Для этого действия нужна ссылка на конкретное сообщение (https://t.me/.../123).';
      }
      if (!['channel', 'supergroup', 'group'].includes(targetMeta.chatType)) {
        return 'Ссылка должна вести на сообщение в группе или канале.';
      }
      if (
        eventType === EVENT_TYPES.comment &&
        !targetMeta.threadId
      ) {
        return 'Для комментариев используйте ссылку на обсуждение (с параметром ?comment= или ?thread=).';
      }
      break;
    }
    case EVENT_TYPES.start_bot: {
      if (!targetMeta.isBot) {
        return 'Нужна ссылка на бота или мини-апп (username должен заканчиваться на bot).';
      }
      if (!targetMeta.startParam && !targetMeta.startAppParam) {
        return 'Добавьте к ссылке параметр start=... или startapp=... — он нужен для трекинга старта.';
      }
      break;
    }
    case EVENT_TYPES.paid: {
      if (targetMeta.isBot) {
        if (!targetMeta.startParam && !targetMeta.startAppParam) {
          return 'Для оплаты через бота укажите параметр start=... или startapp=... для трекинга.';
        }
      } else if (!targetMeta.messageId) {
        return 'Для платного действия нужна ссылка на конкретное сообщение (например с кнопкой оплаты).';
      }
      break;
    }
    default:
      break;
  }

  return null;
}

function buildChatRef(targetMeta) {
  if (!targetMeta) return null;
  const ref = {
    id: targetMeta.chatId,
    type: targetMeta.chatType,
    title: targetMeta.title,
    username: targetMeta.username,
    message_id: targetMeta.messageId,
    thread_id: targetMeta.threadId,
    link_type: targetMeta.linkType,
  };
  if (targetMeta.startParam) {
    ref.start_param = targetMeta.startParam;
  }
  if (targetMeta.startAppParam) {
    ref.startapp_param = targetMeta.startAppParam;
  }
  return ref;
}

function buildSummary(offer) {
  const title = offer.title || offer.name || 'Offer';
  const lines = [
    `<b>${title}</b>`,
    `Целевая ссылка: ${offer.target_link}`,
    `Цель: ${formatChatRef(offer.chat_ref)}`,
    `ЦД: ${eventLabels[offer.action_type] || offer.action_type}`,
    `Базовая ставка: ${formatRate(offer.base_bid)}`,
    `Премиум ставка: ${formatRate(offer.premium_bid)}`,
    `Лимит: ${formatCapsTotal(offer.total_cap)}`,
  ];
  lines.push(`Slug: <code>${offer.slug}</code>`);
  return lines.join('\n');
}

async function promptForStep(ctx, step) {
  switch (step) {
    case Step.TARGET_URL:
      await promptTargetUrl(ctx);
      break;
    case Step.EVENT_TYPE:
      await promptEventType(ctx);
      break;
    case Step.BASE_BID:
      await promptBaseBid(ctx);
      break;
    case Step.PREMIUM_BID:
      await promptPremiumBid(ctx);
      break;
    case Step.TOTAL_CAP:
      await promptTotalCap(ctx);
      break;
    default:
      break;
  }
}

async function insertOffer(offer, audit) {
  const offerId = uuid();
  const { url: trackingUrl } = buildTrackingUrl(offerId, { src: 'heypay' });
  const columns = ['id'];
  const values = [offerId];

  const columnsSet = await getOffersColumns();

  const targetLink = offer.target_link || offer.target_url;
  if (columnsSet.has('target_link')) {
    columns.push('target_link');
    values.push(targetLink);
  }
  if (columnsSet.has('target_url')) {
    columns.push('target_url');
    values.push(targetLink);
  }

  const actionType = offer.action_type || offer.event_type;
  if (columnsSet.has('action_type')) {
    columns.push('action_type');
    values.push(actionType);
  }
  if (columnsSet.has('event_type')) {
    columns.push('event_type');
    values.push(actionType);
  }

  const title = offer.title || offer.name || 'Offer';
  if (columnsSet.has('title')) {
    columns.push('title');
    values.push(title);
  }
  if (columnsSet.has('name')) {
    columns.push('name');
    values.push(title);
  }

  if (columnsSet.has('slug')) {
    columns.push('slug');
    values.push(offer.slug);
  }

  const baseBid = Math.round(offer.base_bid ?? offer.base_rate ?? 0);
  if (columnsSet.has('base_bid')) {
    columns.push('base_bid');
    values.push(baseBid);
  }
  if (columnsSet.has('base_rate')) {
    columns.push('base_rate');
    values.push(baseBid);
  }

  const premiumBid = Math.round(offer.premium_bid ?? offer.premium_rate ?? 0);
  if (columnsSet.has('premium_bid')) {
    columns.push('premium_bid');
    values.push(premiumBid);
  }
  if (columnsSet.has('premium_rate')) {
    columns.push('premium_rate');
    values.push(premiumBid);
  }

  const totalCap = offer.total_cap ?? offer.caps_total ?? 0;
  if (columnsSet.has('total_cap')) {
    columns.push('total_cap');
    values.push(totalCap);
  }
  if (columnsSet.has('caps_total')) {
    columns.push('caps_total');
    values.push(totalCap);
  }

  if (columnsSet.has('cap_window')) {
    columns.push('cap_window');
    values.push(offer.cap_window ?? 0);
  }

  if (columnsSet.has('time_targeting')) {
    columns.push('time_targeting');
    values.push(offer.time_targeting ?? null);
  }

  if (columnsSet.has('status')) {
    columns.push('status');
    values.push('active');
  }
  if (columnsSet.has('tracking_url')) {
    columns.push('tracking_url');
    values.push(trackingUrl);
  }
  if (columnsSet.has('geo_mode')) {
    columns.push('geo_mode');
    values.push(offer.geo_mode ?? 'any');
  }
  if (columnsSet.has('geo_list')) {
    columns.push('geo_list');
    values.push(Array.isArray(offer.geo_list) ? offer.geo_list : []);
  }
  if (columnsSet.has('geo_input')) {
    columns.push('geo_input');
    values.push(offer.geo_input ?? null);
  }
  if (columnsSet.has('geo_whitelist')) {
    columns.push('geo_whitelist');
    values.push(Array.isArray(offer.geo_whitelist) ? offer.geo_whitelist : []);
  }
  if (columnsSet.has('chat_ref')) {
    columns.push('chat_ref');
    values.push(offer.chat_ref || null);
  }

  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const sql = `INSERT INTO offers (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`;
  const res = await query(sql, values);
  const insertedId = res.rows[0]?.id || offerId;

  await insertOfferAuditLog({
    offerId: insertedId,
    action: 'created',
    userId: audit.userId,
    chatId: audit.chatId,
    details: {
      started_at: audit.startedAt,
    },
  });

  console.info(`${logPrefix} offer inserted`, {
    offerId: insertedId,
    slug: offer.slug,
    eventType: offer.action_type || offer.event_type,
  });

  return { id: insertedId, trackingUrl };
}

const adsWizard = new Scenes.WizardScene(
  'ads-wizard',
  async (ctx) => {
    ctx.wizard.state.offer = {};
    ctx.wizard.state.audit = {
      userId: ctx.from?.id,
      chatId: ctx.chat?.id,
      startedAt: new Date().toISOString(),
    };
    await ctx.reply(
      '🧙‍♂️ Мастер размещения оффера. Отправляйте данные последовательно — всегда можно вернуться [Назад] или выйти командой [Отмена].'
    );
    await promptForStep(ctx, Step.TARGET_URL);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx)) {
      return cancelWizard(ctx);
    }
    if (isBack(ctx)) {
      await ctx.reply('Мы только начинаем. Чтобы выйти, используйте команду [Отмена].');
      return;
    }

    const url = getMessageText(ctx);
    if (!url) {
      await ctx.reply('Нужна ссылка вида https://t.me/... Попробуйте ещё раз.');
      return;
    }

    let targetMeta;
    try {
      targetMeta = await resolveTelegramTarget(ctx, url);
    } catch (error) {
      await ctx.reply(error.message || 'Не удалось обработать ссылку. Попробуйте другую.');
      return;
    }

    ctx.wizard.state.offer.target_link = targetMeta.normalizedUrl;
    ctx.wizard.state.offer.target_url = targetMeta.normalizedUrl;
    ctx.wizard.state.offer.target_meta = targetMeta;
    ctx.wizard.state.offer.chat_ref = buildChatRef(targetMeta);
    if (!ctx.session) {
      ctx.session = {};
    }
    ctx.session.target_link = targetMeta.normalizedUrl;
    ctx.session.raw_target_link = url;
    clearAwaitingTargetLink(ctx);

    await promptForStep(ctx, Step.EVENT_TYPE);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.message) {
      if (isCancel(ctx)) {
        return cancelWizard(ctx);
      }
      if (isBack(ctx)) {
        clearAwaitingTargetLink(ctx);
        if (ctx.session) {
          delete ctx.session.target_link;
          delete ctx.session.raw_target_link;
        }
        await promptForStep(ctx, Step.TARGET_URL);
        ctx.wizard.selectStep(Step.TARGET_URL);
        return;
      }
    }

    if (!ctx.callbackQuery?.data) {
      return;
    }

    await ctx.answerCbQuery();

    if (ctx.callbackQuery.data === 'nav:back') {
      await ctx.editMessageReplyMarkup();
      ctx.wizard.selectStep(Step.TARGET_URL);
      clearAwaitingTargetLink(ctx);
      if (ctx.session) {
        delete ctx.session.target_link;
        delete ctx.session.raw_target_link;
      }
      await promptForStep(ctx, Step.TARGET_URL);
      return;
    }

    if (!ctx.callbackQuery.data.startsWith('event:')) {
      return;
    }

    const eventType = ctx.callbackQuery.data.split(':')[1];
    const compatibilityError = ensureEventCompatibility(ctx.wizard.state.offer.target_meta, eventType);
    if (compatibilityError) {
      await ctx.reply(`${compatibilityError} Выберите другой тип.`);
      return;
    }

    ctx.wizard.state.offer.action_type = eventType;
    ctx.wizard.state.offer.event_type = eventType;
    await ctx.editMessageReplyMarkup();
    await promptForStep(ctx, Step.BASE_BID);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx)) {
      return cancelWizard(ctx);
    }
    if (isBack(ctx)) {
      await promptForStep(ctx, Step.EVENT_TYPE);
      ctx.wizard.selectStep(Step.EVENT_TYPE);
      return;
    }

    const value = parseNumber(getMessageText(ctx));
    const actionType = ctx.wizard.state.offer.action_type;
    const minBase = Math.max(5, minRates[actionType]?.base ?? 0);
    if (value === null || value < minBase) {
      await ctx.reply(`Нужно число не ниже ${minBase}. Попробуйте ещё раз.`);
      return;
    }

    ctx.wizard.state.offer.base_bid = value;
    ctx.wizard.state.offer.base_rate = value;
    const minPremium = Math.max(value, 10, minRates[actionType]?.premium ?? 0);
    ctx.wizard.state.offer.minPremium = minPremium;
    await promptForStep(ctx, Step.PREMIUM_BID);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx)) {
      return cancelWizard(ctx);
    }
    if (isBack(ctx)) {
      await promptForStep(ctx, Step.BASE_BID);
      ctx.wizard.selectStep(Step.BASE_BID);
      return;
    }

    const value = parseNumber(getMessageText(ctx));
    const { minPremium } = ctx.wizard.state.offer;
    if (value === null || value < minPremium) {
      await ctx.reply(`Нужно число не ниже ${minPremium}. Попробуйте ещё раз.`);
      return;
    }

    ctx.wizard.state.offer.premium_bid = value;
    ctx.wizard.state.offer.premium_rate = value;
    await promptForStep(ctx, Step.TOTAL_CAP);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx)) {
      return cancelWizard(ctx);
    }
    if (isBack(ctx)) {
      await promptForStep(ctx, Step.PREMIUM_BID);
      ctx.wizard.selectStep(Step.PREMIUM_BID);
      return;
    }

    const text = getMessageText(ctx);
    if (text === undefined || text === null || text === '') {
      await ctx.reply('Введите целое число (0 = без ограничений).');
      return;
    }

    const num = Number(text);
    if (!Number.isInteger(num) || num < 0) {
      await ctx.reply('Введите целое число не ниже 0.');
      return;
    }

    ctx.wizard.state.offer.total_cap = num;
    ctx.wizard.state.offer.caps_total = num;
    ctx.wizard.state.offer.cap_window = 0;
    ctx.wizard.state.offer.time_targeting = null;

    const targetMeta = ctx.wizard.state.offer.target_meta;
    const rawTitle =
      targetMeta?.username ||
      targetMeta?.title ||
      autoTitleFromLink(ctx.wizard.state.offer.target_link);
    const autoTitle = rawTitle ? String(rawTitle).trim() || 'Offer' : 'Offer';
    ctx.wizard.state.offer.title = autoTitle;
    ctx.wizard.state.offer.name = autoTitle;

    const baseSlug = autoSlugFromTitle(autoTitle);
    const uniqueSlug = await ensureUniqueSlug(baseSlug);
    ctx.wizard.state.offer.slug = uniqueSlug;

    const summary = buildSummary(ctx.wizard.state.offer);
    await ctx.replyWithHTML(
      `Проверьте данные:\n${summary}\n\nОтправить оффер?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Подтвердить', 'confirm:create')],
        [Markup.button.callback('↩️ Назад', 'confirm:back')],
        [Markup.button.callback('❌ Отмена', 'confirm:cancel')],
      ])
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.callbackQuery?.data) {
      if (ctx.message) {
        if (isCancel(ctx)) {
          return cancelWizard(ctx);
        }
        if (isBack(ctx)) {
          ctx.wizard.selectStep(Step.TOTAL_CAP);
          await promptForStep(ctx, Step.TOTAL_CAP);
        }
      }
      return;
    }

    await ctx.answerCbQuery();

    if (ctx.callbackQuery.data === 'confirm:cancel') {
      await ctx.editMessageText('Создание оффера отменено.');
      clearAwaitingTargetLink(ctx);
      if (ctx.session) {
        delete ctx.session.target_link;
        delete ctx.session.raw_target_link;
      }
      return ctx.scene.leave();
    }

    if (ctx.callbackQuery.data === 'confirm:back') {
      await ctx.editMessageText('Вернёмся и поправим данные.');
      ctx.wizard.selectStep(Step.TOTAL_CAP);
      await promptForStep(ctx, Step.TOTAL_CAP);
      return;
    }

    if (ctx.callbackQuery.data !== 'confirm:create') {
      return;
    }

    const offer = ctx.wizard.state.offer;
    try {
      const { id: offerId, trackingUrl } = await insertOffer(offer, ctx.wizard.state.audit);
      const notificationText = `🟢 Кампания #${offerId} активна. CPA ссылка: ${trackingUrl}.`;
      await ctx.editMessageText(notificationText);
      if (ctx.from?.id) {
        await notifyChat(ctx.telegram, ctx.from.id, notificationText);
      }
      const operatorChatId = (process.env.OPERATOR_TG_ID || '').trim();
      if (operatorChatId) {
        await notifyChat(ctx.telegram, operatorChatId, notificationText);
      }
      await logTrackingLink(offerId, offer.name, trackingUrl);
    } catch (error) {
      console.error(`${logPrefix} insert error`, error);
      await ctx.editMessageText('Не удалось сохранить оффер: ' + (error.message || 'ошибка БД'));
    }
    clearAwaitingTargetLink(ctx);
    if (ctx.session) {
      delete ctx.session.target_link;
      delete ctx.session.raw_target_link;
    }
    return ctx.scene.leave();
  }
);

adsWizard.command('cancel', async (ctx) => cancelWizard(ctx));
adsWizard.command('back', async (ctx) => {
  await ctx.reply('Используйте кнопку или напишите "Назад" в рамках шага.');
});

export default adsWizard;
