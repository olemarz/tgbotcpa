import { Scenes, Markup } from 'telegraf';
import { EVENT_ORDER, EVENT_TYPES } from './constants.js';
import { config } from '../config.js';
import { query, insertOfferAuditLog } from '../db/index.js';
import { uuid } from '../util/id.js';

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

const baseUrlOrigin = (() => {
  try {
    return new URL(config.baseUrl).origin;
  } catch (error) {
    return config.baseUrl;
  }
})();

const CANCEL_KEYWORDS = new Set(['/cancel', 'отмена', '[отмена]', 'cancel']);
const BACK_KEYWORDS = new Set(['/back', 'назад', '[назад]']);

const Step = {
  INTRO: 0,
  TARGET_URL: 1,
  EVENT_TYPE: 2,
  BASE_RATE: 3,
  PREMIUM_RATE: 4,
  CAPS_TOTAL: 5,
  OFFER_NAME: 6,
  OFFER_SLUG: 7,
  CONFIRM: 8,
};

const STEP_NUMBERS = {
  [Step.TARGET_URL]: 1,
  [Step.EVENT_TYPE]: 2,
  [Step.BASE_RATE]: 3,
  [Step.PREMIUM_RATE]: 4,
  [Step.CAPS_TOTAL]: 5,
  [Step.OFFER_NAME]: 6,
  [Step.OFFER_SLUG]: 7,
};

const TOTAL_INPUT_STEPS = Math.max(...Object.values(STEP_NUMBERS));

let offersColumnsPromise;
async function getOffersColumns() {
  if (!offersColumnsPromise) {
    offersColumnsPromise = query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'offers'`
    ).then((res) => new Set(res.rows.map((row) => row.column_name)));
  }
  return offersColumnsPromise;
}

async function slugExists(slug) {
  const res = await query('SELECT 1 FROM offers WHERE slug = $1 LIMIT 1', [slug]);
  return res.rowCount > 0;
}

function slugify(name) {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || `offer-${Math.random().toString(36).slice(2, 6)}`;
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

function ensureMinRate(eventType, value, tier) {
  const min = minRates[eventType]?.[tier] ?? 0;
  return value >= min;
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
  await ctx.reply(message);
  return ctx.scene.leave();
}

async function promptTargetUrl(ctx) {
  const stepNum = STEP_NUMBERS[Step.TARGET_URL];
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

async function promptBaseRate(ctx) {
  const { event_type: eventType } = ctx.wizard.state.offer;
  const min = minRates[eventType]?.base ?? 0;
  const stepNum = STEP_NUMBERS[Step.BASE_RATE];
  await ctx.reply(
    `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Введите базовую ставку, не ниже ${min}.\n` +
      'Можно использовать точку или запятую как разделитель. Команды: [Назад], [Отмена].'
  );
}

async function promptPremiumRate(ctx) {
  const stepNum = STEP_NUMBERS[Step.PREMIUM_RATE];
  await ctx.reply(
    `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Введите ставку для премиум-пользователей.\n` +
      'Она не может быть ниже базовой ставки или минимального порога для премиума. Команды: [Назад], [Отмена].'
  );
}

async function promptCapsTotal(ctx) {
  const stepNum = STEP_NUMBERS[Step.CAPS_TOTAL];
  await ctx.reply(
    `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Введите общий лимит конверсий (целое число от 10 и выше).\n` +
      'Команды: [Назад], [Отмена].'
  );
}

async function promptOfferName(ctx) {
  const stepNum = STEP_NUMBERS[Step.OFFER_NAME];
  await ctx.reply(
    `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Введите название оффера.\n` +
      'Команды: [Назад], [Отмена].'
  );
}

async function promptOfferSlug(ctx) {
  const stepNum = STEP_NUMBERS[Step.OFFER_SLUG];
  const { autoSlug } = ctx.wizard.state.offer;
  const prompt =
    `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Текущий slug: <code>${autoSlug}</code>.\n` +
    'Если хотите оставить — отправьте «-». Если нужен свой slug (латиница, цифры, тире, от 3 символов) — пришлите его.\n' +
    'Команды: [Назад], [Отмена].';
  await ctx.replyWithHTML(prompt);
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
  const lines = [
    `<b>${offer.name}</b>`,
    `Целевая ссылка: ${offer.target_url}`,
    `Цель: ${formatChatRef(offer.chat_ref)}`,
    `ЦД: ${eventLabels[offer.event_type]}`,
    `Базовая ставка: ${formatRate(offer.base_rate)}`,
    `Премиум ставка: ${formatRate(offer.premium_rate)}`,
    `Кап: ${formatCapsTotal(offer.caps_total)}`,
    `Slug: <code>${offer.slug}</code>`,
  ];
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
    case Step.BASE_RATE:
      await promptBaseRate(ctx);
      break;
    case Step.PREMIUM_RATE:
      await promptPremiumRate(ctx);
      break;
    case Step.CAPS_TOTAL:
      await promptCapsTotal(ctx);
      break;
    case Step.OFFER_NAME:
      await promptOfferName(ctx);
      break;
    case Step.OFFER_SLUG:
      await promptOfferSlug(ctx);
      break;
    default:
      break;
  }
}

async function insertOffer(offer, audit) {
  const offerId = uuid();
  const columns = [
    'id',
    'target_url',
    'event_type',
    'name',
    'slug',
    'base_rate',
    'premium_rate',
    'caps_total',
    'status',
  ];
  const values = [
    offerId,
    offer.target_url,
    offer.event_type,
    offer.name,
    offer.slug,
    Math.round(offer.base_rate),
    Math.round(offer.premium_rate),
    offer.caps_total,
    'active',
  ];

  const columnsSet = await getOffersColumns();
  if (columnsSet.has('caps_window')) {
    columns.push('caps_window');
    values.push(offer.caps_window);
  }
  if (columnsSet.has('time_targeting')) {
    columns.push('time_targeting');
    values.push(offer.time_targeting || null);
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
    eventType: offer.event_type,
  });

  return insertedId;
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

    ctx.wizard.state.offer.target_url = targetMeta.normalizedUrl;
    ctx.wizard.state.offer.target_meta = targetMeta;
    ctx.wizard.state.offer.chat_ref = buildChatRef(targetMeta);

    await promptForStep(ctx, Step.EVENT_TYPE);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.message) {
      if (isCancel(ctx)) {
        return cancelWizard(ctx);
      }
      if (isBack(ctx)) {
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

    ctx.wizard.state.offer.event_type = eventType;
    await ctx.editMessageReplyMarkup();
    await promptForStep(ctx, Step.BASE_RATE);
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
    const eventType = ctx.wizard.state.offer.event_type;
    if (value === null || !ensureMinRate(eventType, value, 'base')) {
      await ctx.reply(`Нужно число не ниже ${minRates[eventType]?.base ?? 0}. Попробуйте ещё раз.`);
      return;
    }

    ctx.wizard.state.offer.base_rate = value;
    const minPremium = Math.max(value, minRates[eventType]?.premium ?? 0);
    ctx.wizard.state.offer.minPremium = minPremium;
    await promptForStep(ctx, Step.PREMIUM_RATE);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx)) {
      return cancelWizard(ctx);
    }
    if (isBack(ctx)) {
      await promptForStep(ctx, Step.BASE_RATE);
      ctx.wizard.selectStep(Step.BASE_RATE);
      return;
    }

    const value = parseNumber(getMessageText(ctx));
    const { minPremium } = ctx.wizard.state.offer;
    if (value === null || value < minPremium) {
      await ctx.reply(`Нужно число не ниже ${minPremium}. Попробуйте ещё раз.`);
      return;
    }

    ctx.wizard.state.offer.premium_rate = value;
    await promptForStep(ctx, Step.CAPS_TOTAL);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx)) {
      return cancelWizard(ctx);
    }
    if (isBack(ctx)) {
      await promptForStep(ctx, Step.PREMIUM_RATE);
      ctx.wizard.selectStep(Step.PREMIUM_RATE);
      return;
    }

    const text = getMessageText(ctx);
    if (!text) {
      await ctx.reply('Минимум 10. Введите значение от 10 и выше.');
      return;
    }
    const num = Number(text);
    if (!Number.isInteger(num) || num < 10) {
      await ctx.reply('Минимум 10. Введите значение от 10 и выше.');
      return;
    }

    ctx.wizard.state.offer.caps_total = num;
    await promptForStep(ctx, Step.OFFER_NAME);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx)) {
      return cancelWizard(ctx);
    }
    if (isBack(ctx)) {
      ctx.wizard.selectStep(Step.CAPS_TOTAL);
      await promptForStep(ctx, Step.CAPS_TOTAL);
      return;
    }

    const name = getMessageText(ctx);
    if (!name) {
      await ctx.reply('Введите непустое название.');
      return;
    }

    ctx.wizard.state.offer.name = name;
    const base = slugify(name);
    const unique = await ensureUniqueSlug(base);
    ctx.wizard.state.offer.slug = unique;
    ctx.wizard.state.offer.autoSlug = unique;
    if (unique !== base) {
      console.info(`${logPrefix} slug adjusted to avoid conflict`, { base, unique });
    }

    await promptForStep(ctx, Step.OFFER_SLUG);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx)) {
      return cancelWizard(ctx);
    }
    if (isBack(ctx)) {
      ctx.wizard.selectStep(Step.OFFER_NAME);
      await promptForStep(ctx, Step.OFFER_NAME);
      return;
    }

    const text = getMessageText(ctx);
    const { autoSlug } = ctx.wizard.state.offer;

    if (!text || text === '-') {
      ctx.wizard.state.offer.slug = autoSlug;
    } else {
      if (!/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/i.test(text) || text.length < 3 || text.length > 60) {
        await ctx.reply('Slug должен содержать латиницу, цифры и тире (3–60 символов), без пробелов.');
        return;
      }
      const normalized = text.toLowerCase();
      if (await slugExists(normalized)) {
        const suggestion = await ensureUniqueSlug(normalized);
        console.warn(`${logPrefix} slug conflict`, { slug: normalized, suggestion });
        await ctx.reply(
          `Такой slug уже занят. Доступный вариант: ${suggestion}. Отправьте его или придумайте другой.`
        );
        return;
      }
      ctx.wizard.state.offer.slug = normalized;
    }

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
          ctx.wizard.selectStep(Step.OFFER_SLUG);
          await promptForStep(ctx, Step.OFFER_SLUG);
        }
      }
      return;
    }

    await ctx.answerCbQuery();

    if (ctx.callbackQuery.data === 'confirm:cancel') {
      await ctx.editMessageText('Создание оффера отменено.');
      return ctx.scene.leave();
    }

    if (ctx.callbackQuery.data === 'confirm:back') {
      await ctx.editMessageText('Вернёмся и поправим slug или другие данные.');
      ctx.wizard.selectStep(Step.OFFER_SLUG);
      await promptForStep(ctx, Step.OFFER_SLUG);
      return;
    }

    if (ctx.callbackQuery.data !== 'confirm:create') {
      return;
    }

    const offer = ctx.wizard.state.offer;
    try {
      const offerId = await insertOffer(offer, ctx.wizard.state.audit);
      const clickUrl = `${baseUrlOrigin}/click/${offerId}?uid={your_uid}`;
      await ctx.editMessageText(
        `✅ Оффер создан!\nСсылка для трафика: ${clickUrl}\nЗамените {your_uid} на значение из вашей CPA-сети.`
      );
    } catch (error) {
      console.error(`${logPrefix} insert error`, error);
      await ctx.editMessageText('Не удалось сохранить оффер: ' + (error.message || 'ошибка БД'));
    }
    return ctx.scene.leave();
  }
);

adsWizard.command('cancel', async (ctx) => cancelWizard(ctx));
adsWizard.command('back', async (ctx) => {
  await ctx.reply('Используйте кнопку или напишите "Назад" в рамках шага.');
});

export default adsWizard;
