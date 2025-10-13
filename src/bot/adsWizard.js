import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Scenes, Markup } from 'telegraf';
import { EVENT_ORDER, EVENT_TYPES } from './constants.js';
import { config } from '../config.js';
import { query, insertOfferAuditLog } from '../db/index.js';
import { uuid } from '../util/id.js';
import { parseGeoInput } from '../utils/geo.js';
import { buildTrackingUrl } from '../utils/tracking-link.js';

const logPrefix = '[adsWizard]';

export const ADS_WIZARD_ID = 'ads-wizard';

const eventLabels = {
  [EVENT_TYPES.join_group]: 'Вступление в группу/канал',
  [EVENT_TYPES.forward]: 'Пересылка сообщения',
  [EVENT_TYPES.reaction]: 'Реакция на сообщение',
  [EVENT_TYPES.comment]: 'Комментарий',
  [EVENT_TYPES.paid]: 'Платное действие / покупка',
  [EVENT_TYPES.start_bot]: 'Старт бота / мини-аппа',
};

export const GEO = Object.freeze({
  ANY: 'any',
  WHITELIST: 'whitelist',
});

const minRates = config.MIN_RATES || {};
const allowedTelegramHosts = new Set(['t.me', 'telegram.me', 'telegram.dog']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const linksLogPath = path.resolve(__dirname, '../../var/links.log');

const CANCEL_KEYWORDS = new Set(['/cancel', 'отмена', '[отмена]', 'cancel']);
const BACK_KEYWORDS = new Set(['/back', 'назад', '[назад]']);

const Step = Object.freeze({
  TARGET_URL: 0,
  EVENT_TYPE: 1,
  BASE_RATE: 2,
  PREMIUM_RATE: 3,
  CAPS_TOTAL: 4,
  GEO_TARGETING: 5,
  OFFER_NAME: 6,
  OFFER_SLUG: 7,
});

const INPUT_STEP_ORDER = Object.freeze([
  Step.TARGET_URL,
  Step.EVENT_TYPE,
  Step.BASE_RATE,
  Step.PREMIUM_RATE,
  Step.CAPS_TOTAL,
  Step.GEO_TARGETING,
  Step.OFFER_NAME,
  Step.OFFER_SLUG,
]);

const STEP_NUMBERS = Object.freeze(
  Object.fromEntries(INPUT_STEP_ORDER.map((step, index) => [step, index + 1]))
);
const TOTAL_INPUT_STEPS = INPUT_STEP_ORDER.length;

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
function slugify(name) {
  const base = (name || '')
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
  if (!/^\d+(?:[.,]\d+)?$/.test(normalized.trim())) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}
function parseIntNonNegative(text) {
  if (!text) return null;
  const v = Number(String(text).trim());
  if (!Number.isInteger(v) || v < 0) return null;
  return v;
}
function formatRate(v) { return `${v} ₽`; }
function getMessageText(ctx) { return ctx.message?.text?.trim(); }
function isCancel(ctx) { const t = getMessageText(ctx); return !!t && CANCEL_KEYWORDS.has(t.toLowerCase()); }
function isBack(ctx) { const t = getMessageText(ctx); return !!t && BACK_KEYWORDS.has(t.toLowerCase()); }
async function cancelWizard(ctx, msg='Мастер отменён.') { await ctx.reply(msg); return ctx.scene.leave(); }

function normalizeTelegramUrl(raw) {
  try {
    const u = new URL(raw.trim());
    if (!allowedTelegramHosts.has(u.hostname)) return null;
    return u.toString();
  } catch { return null; }
}

function resetWizardState(ctx) {
  ctx.wizard.state = { offer: {} };
}

function markStepPrompted(ctx) {
  const updateId = ctx.update?.update_id;
  ctx.wizard.state.skipUpdate = updateId ?? true;
}

function shouldSkipCurrentUpdate(ctx) {
  const skipMark = ctx.wizard?.state?.skipUpdate;
  if (skipMark === undefined) {
    return false;
  }
  const currentId = ctx.update?.update_id;
  if (skipMark === true || (typeof skipMark === 'number' && skipMark === currentId)) {
    delete ctx.wizard.state.skipUpdate;
    return true;
  }
  if (typeof skipMark === 'number' && currentId !== undefined) {
    delete ctx.wizard.state.skipUpdate;
  }
  return false;
}

async function goToStep(ctx, step) {
  markStepPrompted(ctx);
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
    case Step.GEO_TARGETING:
      await promptGeoTargeting(ctx);
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
  return ctx.wizard.selectStep(step);
}

async function promptTargetUrl(ctx) {
  const stepNum = STEP_NUMBERS[Step.TARGET_URL];
  await ctx.reply(
    `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Пришлите ссылку на канал/группу/бота в формате https://t.me/...\n` +
    'Команды: [Отмена] — выйти из мастера.'
  );
}
function buildEventKeyboard() {
  const rows = EVENT_ORDER.map((type) => [Markup.button.callback(eventLabels[type] || type, `event:${type}`)]);
  rows.push([Markup.button.callback('↩️ Назад', 'nav:back')]);
  return Markup.inlineKeyboard(rows);
}
async function promptEventType(ctx) {
  const stepNum = STEP_NUMBERS[Step.EVENT_TYPE];
  await ctx.reply(`Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Выберите тип целевого действия:`, buildEventKeyboard());
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
    `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Введите общий лимит конверсий (целое число, 0 — без ограничений).\n` +
    'Команды: [Назад], [Отмена].'
  );
}
async function promptGeoTargeting(ctx) {
  const stepNum = STEP_NUMBERS[Step.GEO_TARGETING];
  await ctx.reply(
    `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Введите список стран/регионов через запятую (например: RU, UA; либо JSON).\n` +
    `Пусто или 0 — без гео-ограничений. Команды: [Назад], [Отмена].`
  );
}
async function promptOfferName(ctx) {
  const stepNum = STEP_NUMBERS[Step.OFFER_NAME];
  await ctx.reply(`Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Введите название оффера.\nКоманды: [Назад], [Отмена].`);
}
async function promptOfferSlug(ctx) {
  const stepNum = STEP_NUMBERS[Step.OFFER_SLUG];
  const { title } = ctx.wizard.state.offer;
  const auto = slugify(title || '');
  ctx.wizard.state.autoSlug = auto;
  await ctx.reply(
    `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Текущий slug: <code>${auto}</code>.\n` +
    `Если хотите оставить — отправьте «-». Если нужен свой slug (латиница/цифры/дефис, до 60 символов) — пришлите его.\n` +
    'Команды: [Назад], [Отмена].',
    { parse_mode: 'HTML' }
  );
}

async function createOfferReturningId(offer) {
  const cols = await getOffersColumns();
  const data = {
    id: uuid(),
    title: offer.title || null,
    name: offer.name ?? offer.title ?? null,
    slug: offer.slug || null,
    event_type: offer.event_type || null,
    base_rate: offer.base_rate ?? null,
    premium_rate: offer.premium_rate ?? null,
    caps_total: offer.caps_total ?? null,
    geo_mode: offer.geo_mode,
    geo_input: offer.geo_input ?? null,
    geo_list: Array.isArray(offer.geo_list) && offer.geo_list.length ? offer.geo_list : undefined,
    target_url: offer.target_url || null,
    created_by_tg: offer.created_by_tg ?? null,
  };
  const names = [], values = [], params = [];
  let i = 1;
  for (const [k, v] of Object.entries(data)) {
    if (!cols.has(k)) continue;
    if (v === undefined) continue;
    names.push(k); params.push(`$${i++}`); values.push(v);
  }
  const sql = `INSERT INTO offers (${names.join(',')}) VALUES (${params.join(',')}) RETURNING id`;
  const res = await query(sql, values);
  return res.rows[0].id;
}
async function finishAndSend(ctx, offerId) {
  const baseUrl = (config.baseUrl || process.env.BASE_URL || '').replace(/\/+$/, '');
  let trackingUrl;
  try {
    trackingUrl = buildTrackingUrl({ baseUrl, offerId });
  } catch (error) {
    console.error(`${logPrefix} failed to build tracking url`, { offerId, error: error?.message });
    trackingUrl = baseUrl ? `${baseUrl}/click/${offerId}` : `/click/${offerId}`;
  }
  await logTrackingLink(offerId, ctx.wizard.state.offer?.title, trackingUrl);
  await ctx.reply(
    ['✅ Оффер создан!', `ID: <code>${offerId}</code>`, `Ссылка для трафика: ${trackingUrl}`].join('\n'),
    { parse_mode: 'HTML', disable_web_page_preview: true }
  );
  if (config.ADMIN_IDS?.length) {
    for (const chatId of config.ADMIN_IDS) {
      await notifyChat(ctx.telegram, chatId, `Новый оффер #${offerId} создан. ${trackingUrl}`);
    }
  }
}

export const adsWizardScene = new Scenes.WizardScene(
  ADS_WIZARD_ID,
  async (ctx) => {
    if (shouldSkipCurrentUpdate(ctx)) return;
    if (isCancel(ctx)) return cancelWizard(ctx);
    if (isBack(ctx)) { await goToStep(ctx, Step.TARGET_URL); return; }
    const text = getMessageText(ctx);
    const normalized = normalizeTelegramUrl(text || '');
    if (!normalized) {
      await ctx.reply('Ссылка вида https://t.me/... не распознана. Попробуйте ещё раз.');
      return;
    }
    ctx.wizard.state.offer.target_url = normalized;
    return goToStep(ctx, Step.EVENT_TYPE);
  },
  async (ctx) => {
    if (shouldSkipCurrentUpdate(ctx)) return;
    if (isCancel(ctx)) return cancelWizard(ctx);
    if (isBack(ctx)) { await goToStep(ctx, Step.TARGET_URL); return; }
    const cb = ctx.callbackQuery?.data;
    if (cb === 'nav:back') { await ctx.answerCbQuery(); return goToStep(ctx, Step.TARGET_URL); }
    if (!cb?.startsWith?.('event:')) { await promptEventType(ctx); return; }
    ctx.wizard.state.offer.event_type = cb.slice('event:'.length);
    await ctx.answerCbQuery();
    return goToStep(ctx, Step.BASE_RATE);
  },
  async (ctx) => {
    if (shouldSkipCurrentUpdate(ctx)) return;
    if (isCancel(ctx)) return cancelWizard(ctx);
    if (isBack(ctx)) { await goToStep(ctx, Step.EVENT_TYPE); return; }
    const n = parseNumber(getMessageText(ctx));
    const evt = ctx.wizard.state.offer.event_type;
    const min = minRates[evt]?.base ?? 0;
    if (n == null || n < min) { await ctx.reply(`Введите корректную сумму (не ниже ${min}).`); return; }
    ctx.wizard.state.offer.base_rate = n;
    return goToStep(ctx, Step.PREMIUM_RATE);
  },
  async (ctx) => {
    if (shouldSkipCurrentUpdate(ctx)) return;
    if (isCancel(ctx)) return cancelWizard(ctx);
    if (isBack(ctx)) { await goToStep(ctx, Step.BASE_RATE); return; }
    const n = parseNumber(getMessageText(ctx));
    const base = ctx.wizard.state.offer.base_rate ?? 0;
    const evt = ctx.wizard.state.offer.event_type;
    const minPrem = minRates[evt]?.premium ?? base;
    if (n == null || n < base || n < minPrem) {
      await ctx.reply(`Число некорректно. Премиум-ставка не может быть ниже базовой (${base}) и порога (${minPrem}).`);
      return;
    }
    ctx.wizard.state.offer.premium_rate = n;
    return goToStep(ctx, Step.CAPS_TOTAL);
  },
  async (ctx) => {
    if (shouldSkipCurrentUpdate(ctx)) return;
    if (isCancel(ctx)) return cancelWizard(ctx);
    if (isBack(ctx)) { await goToStep(ctx, Step.PREMIUM_RATE); return; }
    const n = parseIntNonNegative(getMessageText(ctx));
    if (n == null) { await ctx.reply('Введите целое число (0 — без ограничений).'); return; }
    ctx.wizard.state.offer.caps_total = n === 0 ? null : n;
    return goToStep(ctx, Step.GEO_TARGETING);
  },
  async (ctx) => {
    if (shouldSkipCurrentUpdate(ctx)) return;
    if (isCancel(ctx)) return cancelWizard(ctx);
    if (isBack(ctx)) { await goToStep(ctx, Step.CAPS_TOTAL); return; }
    const raw = (getMessageText(ctx) || '').trim();
    if (!raw || raw === '0' || /^без\s*огранич/i.test(raw)) {
      ctx.wizard.state.offer.geo_mode = GEO.ANY;
      ctx.wizard.state.offer.geo_input = null;
      delete ctx.wizard.state.offer.geo_list;
    } else {
      try {
        const parsed = parseGeoInput(raw);
        ctx.wizard.state.offer.geo_mode = GEO.WHITELIST;
        ctx.wizard.state.offer.geo_input = raw;
        ctx.wizard.state.offer.geo_list = parsed;
      } catch (e) {
        await ctx.reply(`Не получилось разобрать гео. ${e?.message || ''} Попробуйте ещё раз.`);
        return;
      }
    }
    return goToStep(ctx, Step.OFFER_NAME);
  },
  async (ctx) => {
    if (shouldSkipCurrentUpdate(ctx)) return;
    if (isCancel(ctx)) return cancelWizard(ctx);
    if (isBack(ctx)) { await goToStep(ctx, Step.GEO_TARGETING); return; }
    const name = (getMessageText(ctx) || '').trim();
    if (!name) { await ctx.reply('Пустое название — пришлите непустую строку.'); return; }
    ctx.wizard.state.offer.title = name;
    ctx.wizard.state.offer.name = name;
    return goToStep(ctx, Step.OFFER_SLUG);
  },
  async (ctx) => {
    if (shouldSkipCurrentUpdate(ctx)) return;
    if (isCancel(ctx)) return cancelWizard(ctx);
    if (isBack(ctx)) { await goToStep(ctx, Step.OFFER_NAME); return; }
    let candidate = (getMessageText(ctx) || '').trim();
    if (candidate === '-' || candidate === '—') candidate = ctx.wizard.state.autoSlug;
    candidate = slugify(candidate);
    if (!candidate) { await ctx.reply('Slug пуст или некорректен. Пришлите другой.'); return; }
    const unique = await ensureUniqueSlug(candidate);
    ctx.wizard.state.offer.slug = unique;
    const offer = { ...ctx.wizard.state.offer, created_by_tg: ctx.from?.id ?? null };
    let offerId;
    try {
      offerId = await createOfferReturningId(offer);
      await insertOfferAuditLog?.(offerId, 'created_by_wizard', { tg_id: ctx.from?.id }).catch(() => {});
    } catch (e) {
      console.error(`${logPrefix} create offer failed`, e);
      await ctx.reply('❌ Не удалось создать оффер. Попробуйте позже.');
      return cancelWizard(ctx);
    }
    await finishAndSend(ctx, offerId);
    return ctx.scene.leave();
  }
);

export async function initializeAdsWizard(ctx) {
  resetWizardState(ctx);
  await goToStep(ctx, Step.TARGET_URL);
}

adsWizardScene.enter(initializeAdsWizard);

export const startAdsWizard = (ctx) => ctx.scene.enter(ADS_WIZARD_ID);

export default adsWizardScene;

if (typeof adsWizardScene === 'undefined' || typeof startAdsWizard !== 'function') {
  console.error('[adsWizard] bad export', { hasScene: !!adsWizardScene, hasStart: typeof startAdsWizard });
}

queueMicrotask(() => {
  console.log(
    '[BOOT] adsWizard LOADED, id=%s, steps=%s',
    ADS_WIZARD_ID,
    typeof TOTAL_INPUT_STEPS !== 'undefined' ? TOTAL_INPUT_STEPS : 'n/a'
  );
});
