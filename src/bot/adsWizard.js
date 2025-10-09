import { Scenes, Markup } from 'telegraf';
import { EVENT_ORDER, EVENT_TYPES } from './constants.js';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { uuid } from '../util/id.js';

const eventLabels = {
  [EVENT_TYPES.join_group]: 'Вступление в группу/канал',
  [EVENT_TYPES.forward]: 'Пересылка сообщения',
  [EVENT_TYPES.reaction]: 'Реакция на сообщение',
  [EVENT_TYPES.comment]: 'Комментарий',
  [EVENT_TYPES.paid]: 'Платное действие / покупка',
  [EVENT_TYPES.start_bot]: 'Старт бота / мини-аппа',
};

const minRates = config.MIN_RATES || {};

const baseUrlHost = (() => {
  try {
    return new URL(config.baseUrl).host;
  } catch (e) {
    return config.baseUrl || '';
  }
})();

const timeTargetingPresets = {
  all: {
    preset: '24/7',
    BYDAY: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'],
    BYHOUR: Array.from({ length: 24 }, (_, i) => i),
  },
  weekdays: {
    preset: 'weekdays',
    BYDAY: ['MO', 'TU', 'WE', 'TH', 'FR'],
    BYHOUR: Array.from({ length: 24 }, (_, i) => i),
  },
  working_hours: {
    preset: 'business_hours',
    BYDAY: ['MO', 'TU', 'WE', 'TH', 'FR'],
    BYHOUR: Array.from({ length: 10 }, (_, i) => i + 9), // 09:00-18:00
  },
  weekend: {
    preset: 'weekend',
    BYDAY: ['SA', 'SU'],
    BYHOUR: Array.from({ length: 24 }, (_, i) => i),
  },
};

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

function isCancel(ctx) {
  const text = ctx.message?.text?.trim();
  return text === '/cancel';
}

function ensureMinRate(eventType, value, tier) {
  const min = minRates[eventType]?.[tier] ?? 0;
  return value >= min;
}

function parseNumber(text) {
  if (!text) return null;
  const n = Number(text.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function parseCapsWindow(text) {
  const normalized = text.trim().toLowerCase();
  if (['0', 'none', 'нет', 'no'].includes(normalized)) return null;
  const match = normalized.match(/^(\d+)\s*\/(day|hour|week|month)$/);
  if (!match) return undefined;
  return { size: Number(match[1]), unit: match[2] };
}

function formatCapsWindow(capsWindow) {
  if (!capsWindow) return 'без окна';
  return `${capsWindow.size}/${capsWindow.unit}`;
}

function formatTimeTargeting(targeting) {
  if (!targeting) return '24/7';
  if (targeting.preset) return targeting.preset;
  const obj = {};
  if (targeting.BYDAY) obj.BYDAY = targeting.BYDAY;
  if (targeting.BYHOUR) obj.BYHOUR = targeting.BYHOUR;
  return JSON.stringify(obj);
}

const adsWizard = new Scenes.WizardScene(
  'ads-wizard',
  async (ctx) => {
    ctx.wizard.state.offer = {};
    await ctx.reply(
      '🧙‍♂️ Мастер размещения оффера\nОтправьте ссылку на канал/группу/бота в формате https://t.me/...\nНапишите /cancel чтобы выйти.'
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx)) {
      await ctx.reply('Мастер отменён.');
      return ctx.scene.leave();
    }
    const url = ctx.message?.text?.trim();
    if (!url || !/^https:\/\/t\.me\/.+/.test(url)) {
      await ctx.reply('Нужна ссылка вида https://t.me/... Попробуйте ещё раз.');
      return;
    }
    ctx.wizard.state.offer.target_url = url;
    await ctx.reply(
      'Выберите тип целевого действия:',
      Markup.inlineKeyboard(
        EVENT_ORDER.map((type) =>
          Markup.button.callback(eventLabels[type] || type, `event:${type}`)
        ),
        { columns: 1 }
      )
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('event:')) {
      return;
    }
    await ctx.answerCbQuery();
    const eventType = ctx.callbackQuery.data.split(':')[1];
    ctx.wizard.state.offer.event_type = eventType;
    const min = minRates[eventType];
    await ctx.editMessageReplyMarkup();
    await ctx.reply(
      `Введите базовую ставку (минимум ${min?.base ?? 0}):`
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx)) {
      await ctx.reply('Мастер отменён.');
      return ctx.scene.leave();
    }
    const value = parseNumber(ctx.message?.text);
    const eventType = ctx.wizard.state.offer.event_type;
    if (value === null || !ensureMinRate(eventType, value, 'base')) {
      await ctx.reply(`Нужно число не ниже ${minRates[eventType]?.base ?? 0}.`);
      return;
    }
    ctx.wizard.state.offer.base_rate = value;
    const minPremium = Math.max(value, minRates[eventType]?.premium ?? 0);
    await ctx.reply(
      `Введите ставку для премиум-пользователей (>= ${minPremium}):`
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx)) {
      await ctx.reply('Мастер отменён.');
      return ctx.scene.leave();
    }
    const value = parseNumber(ctx.message?.text);
    const { event_type: eventType, base_rate: baseRate } = ctx.wizard.state.offer;
    const minPremium = Math.max(baseRate, minRates[eventType]?.premium ?? 0);
    if (value === null || value < minPremium) {
      await ctx.reply(`Нужно число не ниже ${minPremium}.`);
      return;
    }
    ctx.wizard.state.offer.premium_rate = value;
    await ctx.reply('Введите общий лимит конверсий (целое число, 0 для безлимита):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx)) {
      await ctx.reply('Мастер отменён.');
      return ctx.scene.leave();
    }
    const value = ctx.message?.text?.trim();
    const num = Number(value);
    if (!Number.isInteger(num) || num < 0) {
      await ctx.reply('Нужно целое число 0 или больше.');
      return;
    }
    ctx.wizard.state.offer.caps_total = num;
    await ctx.reply('Введите окно капа в формате N/day|hour|week|month или 0 для безлимитного окна:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx)) {
      await ctx.reply('Мастер отменён.');
      return ctx.scene.leave();
    }
    const input = ctx.message?.text;
    if (!input) {
      await ctx.reply('Введите значение.');
      return;
    }
    const window = parseCapsWindow(input);
    if (window === undefined) {
      await ctx.reply('Используйте формат 10/day, 5/week или 0.');
      return;
    }
    ctx.wizard.state.offer.caps_window = window;
    await ctx.reply(
      'Выберите временной таргетинг:',
      Markup.inlineKeyboard([
        [Markup.button.callback('24/7', 'tt:all')],
        [Markup.button.callback('Будни', 'tt:weekdays')],
        [Markup.button.callback('Рабочие дни 09-18', 'tt:working_hours')],
        [Markup.button.callback('Выходные', 'tt:weekend')],
        [Markup.button.callback('Ввести JSON вручную', 'tt:manual')],
      ])
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('tt:')) {
      return;
    }
    await ctx.answerCbQuery();
    const value = ctx.callbackQuery.data.split(':')[1];
    if (value === 'manual') {
      await ctx.editMessageReplyMarkup();
      await ctx.reply('Отправьте JSON с полями BYDAY и/или BYHOUR, например {"BYDAY":["MO","TU"],"BYHOUR":[10,11]}.');
      return ctx.wizard.next();
    }
    const preset = timeTargetingPresets[value];
    ctx.wizard.state.offer.time_targeting = preset ? JSON.parse(JSON.stringify(preset)) : null;
    await ctx.editMessageReplyMarkup();
    await ctx.reply('Введите название оффера:');
    return ctx.wizard.selectStep(9);
  },
  async (ctx) => {
    if (isCancel(ctx)) {
      await ctx.reply('Мастер отменён.');
      return ctx.scene.leave();
    }
    let parsed;
    try {
      parsed = JSON.parse(ctx.message?.text ?? '');
    } catch (e) {
      await ctx.reply('Не получилось разобрать JSON. Попробуйте ещё раз.');
      return;
    }
    if (typeof parsed !== 'object' || !parsed) {
      await ctx.reply('JSON должен быть объектом.');
      return;
    }
    const { BYDAY, BYHOUR } = parsed;
    if (BYDAY && (!Array.isArray(BYDAY) || BYDAY.some((d) => typeof d !== 'string'))) {
      await ctx.reply('BYDAY должен быть массивом строк (например ["MO","TU"]).');
      return;
    }
    if (BYHOUR && (!Array.isArray(BYHOUR) || BYHOUR.some((h) => !Number.isInteger(h) || h < 0 || h > 23))) {
      await ctx.reply('BYHOUR должен быть массивом чисел 0-23.');
      return;
    }
    ctx.wizard.state.offer.time_targeting = { BYDAY, BYHOUR };
    await ctx.reply('Введите название оффера:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx)) {
      await ctx.reply('Мастер отменён.');
      return ctx.scene.leave();
    }
    const name = ctx.message?.text?.trim();
    if (!name) {
      await ctx.reply('Введите непустое название.');
      return;
    }
    ctx.wizard.state.offer.name = name;
    const base = slugify(name);
    const unique = await ensureUniqueSlug(base);
    ctx.wizard.state.offer.slug = unique;
    await ctx.reply(
      `Сгенерированный slug: ${unique}\nЕсли хотите свой slug (латиница, цифры, тире), отправьте его сейчас. Или отправьте - чтобы оставить как есть.`
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (isCancel(ctx)) {
      await ctx.reply('Мастер отменён.');
      return ctx.scene.leave();
    }
    const text = ctx.message?.text?.trim();
    if (text && text !== '-') {
      if (!/^[a-z0-9][a-z0-9-]{2,}$/.test(text)) {
        await ctx.reply('Slug должен содержать латиницу, цифры и тире, минимум 3 символа.');
        return;
      }
      if (await slugExists(text)) {
        await ctx.reply('Такой slug уже занят, попробуйте другой.');
        return;
      }
      ctx.wizard.state.offer.slug = text;
    }
    const offer = ctx.wizard.state.offer;
    const summary = `\n<b>${offer.name}</b>\n` +
      `URL: ${offer.target_url}\n` +
      `ЦД: ${eventLabels[offer.event_type]}\n` +
      `Базовая ставка: ${offer.base_rate}\n` +
      `Premium ставка: ${offer.premium_rate}\n` +
      `Лимит: ${offer.caps_total}\n` +
      `Окно: ${formatCapsWindow(offer.caps_window)}\n` +
      `Таргетинг: ${formatTimeTargeting(offer.time_targeting)}\n` +
      `Slug: ${offer.slug}`;
    await ctx.replyWithHTML(
      `Проверьте данные:${summary}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Создать', 'confirm:create')],
        [Markup.button.callback('❌ Отмена', 'confirm:cancel')],
      ])
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('confirm:')) {
      return;
    }
    await ctx.answerCbQuery();
    if (ctx.callbackQuery.data === 'confirm:cancel') {
      await ctx.editMessageText('Создание оффера отменено.');
      return ctx.scene.leave();
    }
    const offer = ctx.wizard.state.offer;
    try {
      const offerId = uuid();
      const columns = ['id', 'target_url', 'event_type', 'name', 'slug', 'base_rate', 'premium_rate', 'caps_total', 'status'];
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
        values.push(offer.time_targeting);
      }
      const placeholders = columns.map((_, i) => `$${i + 1}`);
      const sql = `INSERT INTO offers (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`;
      const res = await query(sql, values);
      const insertedId = res.rows[0]?.id || offerId;
      const clickUrl = `https://${baseUrlHost}/click/${insertedId}?uid={your_uid}`;
      await ctx.editMessageText(
        `✅ Оффер создан!\nСсылка для трафика: ${clickUrl}\nЗамените {your_uid} на значение из вашей CPA-сети.`
      );
    } catch (e) {
      console.error('ads wizard insert error', e);
      await ctx.editMessageText('Не удалось сохранить оффер: ' + e.message);
    }
    return ctx.scene.leave();
  }
);

adsWizard.command('cancel', async (ctx) => ctx.scene.leave());

export default adsWizard;
