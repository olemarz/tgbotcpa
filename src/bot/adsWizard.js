import { finalizeOfferAndInvoiceStars } from './offerFinalize.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Scenes, Markup } from 'telegraf';
import { EVENT_ORDER, EVENT_TYPES } from './constants.js';
import { config, MIN_CAP as DEFAULT_MIN_CAP } from '../config.js';
import { query } from '../db/index.js';
import { uuid } from '../util/id.js';
import { parseGeoInput } from '../utils/geo.js';
import { buildTrackingUrl } from '../utils/tracking-link.js';
import { replyHtml } from './html.js';

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
const minCap = config.MIN_CAP ?? DEFAULT_MIN_CAP;
const allowedTelegramHosts = new Set(['t.me', 'telegram.me', 'telegram.dog']);

const OK_WORDS = new Set(['ok', 'okay', 'okey', 'ок', 'окей', 'согласен', 'согласна', 'оставить']);
const MIN_QTY = 25;

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
function makeSlug(input) {
  return String(input ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
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
function autoSlugFromOffer(offer = {}) {
  const source = offer && typeof offer === 'object' ? offer : {};
  const eventSlug = makeSlug(source.event_type || '');
  const quantityRaw = source.quantity ?? source.caps_total;
  const quantity = Number.isFinite(Number(quantityRaw)) ? Math.trunc(Number(quantityRaw)) : null;
  const parts = [eventSlug, quantity && quantity > 0 ? String(quantity) : null].filter(Boolean);
  return makeSlug(parts.join('-'));
}
function parseNumber(text) {
  if (!text) return null;
  const normalized = text.replace(',', '.');
  if (!/^\d+(?:[.,]\d+)?$/.test(normalized.trim())) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
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

function initializeWizardState(ctx) {
  const sceneState = ctx.scene?.state;
  const base = sceneState && typeof sceneState === 'object' ? sceneState : {};
  const offer = base.offer && typeof base.offer === 'object' ? base.offer : {};
  ctx.scene.state = { ...base, offer: { ...offer } };
}

function markStepPrompted(ctx) {
  const updateId = ctx.update?.update_id;
  const s = ctx.scene?.state || {};
  s.skipUpdate = updateId ?? true;
  ctx.scene.state = s;
}

function shouldSkipCurrentUpdate(ctx) {
  const s = ctx.scene?.state;
  const mark = s && typeof s === 'object' ? s.skipUpdate : undefined;
  if (mark === undefined) return false;
  const cur = ctx.update?.update_id;

  const matched = mark === true || (typeof mark === 'number' && mark === cur);
  if (s && typeof s === 'object') delete s.skipUpdate;
  return matched;
}

async function goToStep(ctx, step) {
  if (ctx.scene) markStepPrompted(ctx);
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
    `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Введите общий лимит конверсий (целое число ≥ ${MIN_QTY}).\n` +
    'Команды: [Назад], [Отмена].'
  );
}
async function promptGeoTargeting(ctx) {
  const stepNum = STEP_NUMBERS[Step.GEO_TARGETING];
  await replyHtml(
    ctx,
    [
      `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Введите GEO. Пример: <code>US,CA,DE</code> или <code>ANY</code>.`,
      '⚠️ Таргетинг по дорогим GEO увеличивает стоимость ~на 30%.',
      'Пусто или 0 — без ограничений.',
      'Команды: [Назад], [Отмена].',
    ].join('\n'),
  );
}
async function promptOfferName(ctx) {
  const stepNum = STEP_NUMBERS[Step.OFFER_NAME];
  await ctx.reply(`Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Введите название оффера.\nКоманды: [Назад], [Отмена].`);
}
async function promptOfferSlug(ctx) {
  const stepNum = STEP_NUMBERS[Step.OFFER_SLUG];
  const offer = ctx.wizard.state.offer || {};
  ctx.wizard.state.autoSlug = ctx.wizard.state.autoSlug || autoSlugFromOffer(offer);
  const titleSlug = makeSlug(offer.title || offer.name || '');
  if (!ctx.wizard.state.autoSlug && titleSlug) {
    ctx.wizard.state.autoSlug = titleSlug;
  }
  if (!ctx.wizard.state.autoSlug) {
    ctx.wizard.state.autoSlug = makeSlug(`offer-${Date.now()}`) || `offer-${Date.now()}`;
  }
  const auto = ctx.wizard.state.autoSlug || '—';
  await replyHtml(
    ctx,
    [
      `Шаг ${stepNum}/${TOTAL_INPUT_STEPS}. Текущий slug: <code>${auto}</code>.`,
      'Если хотите оставить — отправьте «ок» «ok» (или «согласен»).',
      'Если нужен свой slug (латиница/цифры/дефис, до 60 символов) — пришлите его.',
      'Команды: [Назад], [Отмена].',
    ].join('\n'),
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
//  await ctx.reply(
//   //  ['✅ Оффер создан!', `ID: <code>${offerId}</code>`, `Ссылка для трафика: ${trackingUrl}`].join('\n'),
  //  { parse_mode: 'HTML', disable_web_page_preview: true }
 // );
  if (config.ADMIN_IDS?.length) {
    for (const chatId of config.ADMIN_IDS) {
      await notifyChat(ctx.telegram, chatId, `Новый оффер #${offerId} создан. ${trackingUrl}`);
    }
  }
}

 ====================== STEPS: 1..8 + promptGeoTargeting ======================

// ШАГ 1 — целевой URL (канал/группа/бот/пост)
async function step1(ctx) {
  // переносим базовое состояние из scene → wizard, если нужно
  const base = (ctx.scene?.state && typeof ctx.scene.state === 'object') ? ctx.scene.state : {};
  ctx.wizard.state = (ctx.wizard.state && typeof ctx.wizard.state === 'object') ? ctx.wizard.state : { ...base };
  if (!ctx.wizard.state.offer || typeof ctx.wizard.state.offer !== 'object') ctx.wizard.state.offer = {};

  try {
    console.log('[WIZARD] enter step1, from=', ctx.from?.id);
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
    await goToStep(ctx, Step.EVENT_TYPE);
  } catch (e) {
    console.error('[WIZARD] step1 error:', e?.message || e, e?.stack || '');
    await ctx.reply('❌ Ошибка старта мастера: ' + (e?.message || e));
    return ctx.scene.leave();
  }
}

// ШАГ 2 — выбор типа события
async function step2(ctx) {
  if (shouldSkipCurrentUpdate(ctx)) return;
  if (isCancel(ctx)) return cancelWizard(ctx);
  if (isBack(ctx)) { await goToStep(ctx, Step.TARGET_URL); return; }

  const cb = ctx.callbackQuery?.data;
  if (cb === 'nav:back') { await ctx.answerCbQuery(); await goToStep(ctx, Step.TARGET_URL); return; }
  if (!cb?.startsWith?.('event:')) { await promptEventType(ctx); return; }

  ctx.wizard.state.offer.event_type = cb.slice('event:'.length);
  await ctx.answerCbQuery();
  await goToStep(ctx, Step.BASE_RATE);
}

// ШАГ 3 — базовая ставка
async function step3(ctx) {
  if (shouldSkipCurrentUpdate(ctx)) return;
  if (isCancel(ctx)) return cancelWizard(ctx);
  if (isBack(ctx)) { await goToStep(ctx, Step.EVENT_TYPE); return; }

  const n = parseNumber(getMessageText(ctx));
  const evt = ctx.wizard.state.offer.event_type;
  const min = minRates[evt]?.base ?? 0;

  if (n == null || n < min) {
    await ctx.reply(`Введите корректную сумму (не ниже ${min}).`);
    return;
  }

  ctx.wizard.state.offer.base_rate = n;
  await goToStep(ctx, Step.PREMIUM_RATE);
}

// ШАГ 4 — премиум-ставка
async function step4(ctx) {
  if (shouldSkipCurrentUpdate(ctx)) return;
  if (isCancel(ctx)) return cancelWizard(ctx);
  if (isBack(ctx)) { await goToStep(ctx, Step.BASE_RATE); return; }

  const n = parseNumber(getMessageText(ctx));
  const base = ctx.wizard.state.offer.base_rate ?? 0;
  const evt  = ctx.wizard.state.offer.event_type;
  const minPrem = minRates[evt]?.premium ?? base;

  if (n == null || n < base || n < minPrem) {
    await ctx.reply(`Число некорректно. Премиум-ставка не может быть ниже базовой (${base}) и порога (${minPrem}).`);
    return;
  }

  ctx.wizard.state.offer.premium_rate = n;
  await goToStep(ctx, Step.CAPS_TOTAL);
}

// ШАГ 5 — общий лимит конверсий
async function step5(ctx) {
  if (shouldSkipCurrentUpdate(ctx)) return;
  if (isCancel(ctx)) return cancelWizard(ctx);
  if (isBack(ctx)) { await goToStep(ctx, Step.PREMIUM_RATE); return; }

  const raw = String(getMessageText(ctx) ?? '').trim();
  const qtyRaw = Number(raw.replace(',', '.'));
  const effectiveMin = Math.max(minCap, MIN_QTY);

  if (!Number.isFinite(qtyRaw)) { await ctx.reply(`Введите целое число, не меньше ${effectiveMin}.`); return; }

  const qtyTrunc = Math.trunc(qtyRaw);

  if (!Number.isInteger(qtyRaw)) { await ctx.reply('Лимит должен быть целым числом.'); return; }
  if (qtyTrunc <= 0) {
    await ctx.reply(`Минимальный лимит конверсий — ${effectiveMin}. 0 (без ограничений) не допускается.`);
    return;
  }

  const qty = Math.max(effectiveMin, qtyTrunc);
  ctx.wizard.state.offer.quantity = qty;
  ctx.wizard.state.offer.caps_total = qty;

  if (qtyRaw < MIN_QTY) {
    await ctx.reply(`Минимум ЦД — ${MIN_QTY}. Я установил количество: ${qty}.`);
  } else if (qtyTrunc < minCap) {
    await ctx.reply(`Минимальный лимит конверсий — ${minCap}. Я установил количество: ${qty}.`);
  }
  await goToStep(ctx, Step.GEO_TARGETING);
}

// ПОДСКАЗКА ДЛЯ GEO (вызывается при входе в шаг)
async function promptGeoTargeting(ctx) {
  await replyHtml(
    ctx,
    [
      'Шаг 6/8. Введите GEO. Пример: <code>US,CA,DE</code> или <code>ANY</code>.',
      '⚠️ Таргетинг по дорогим GEO увеличивает стоимость ~на 30%.',
      'Пусто или 0 — без ограничений.',
      'Команды: [Назад], [Отмена].',
    ].join('\n'),
  );
}

// ШАГ 6 — ввод GEO
async function step6(ctx) {
  if (shouldSkipCurrentUpdate(ctx)) return;
  if (isCancel(ctx)) return cancelWizard(ctx);
  if (isBack(ctx))  { await goToStep(ctx, Step.CAPS_TOTAL); return; }

  const raw = (getMessageText(ctx) || '').trim();

  // Пусто / 0 / ALL / "без ограничений" — значит без GEO
  if (!raw || raw === '0' || /^без\s*огранич/i.test(raw) || raw.toUpperCase() === 'ALL') {
    ctx.wizard.state.offer.geo_mode   = GEO.ANY;
    ctx.wizard.state.offer.geo_input  = null;
    delete ctx.wizard.state.offer.geo_list;
    delete ctx.wizard.state.offer.geo;
    await goToStep(ctx, Step.OFFER_NAME);
    return;
  }

  // Парсим коды
  const tokens = raw
    .split(/[\s,;]+/g)
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  const valid = [];
  const invalid = [];
  for (const t of tokens) {
    if (/^[A-Z]{2}$/.test(t)) valid.push(t);
    else invalid.push(t);
  }

  if (invalid.length) {
    await ctx.reply(`Некорректные коды: ${invalid.join(', ')}. Пример: RU, KZ, US. Введите через запятую/пробел.`);
    return;
  }

  const uniq = Array.from(new Set(valid));
  if (uniq.length === 0) {
    ctx.wizard.state.offer.geo_mode   = GEO.ANY;
    ctx.wizard.state.offer.geo_input  = null;
    delete ctx.wizard.state.offer.geo_list;
    delete ctx.wizard.state.offer.geo;
    await goToStep(ctx, Step.OFFER_NAME);
    return;
  }

  // Сохраняем GEO whitelist
  ctx.wizard.state.offer.geo_mode   = GEO.WHITELIST;
  ctx.wizard.state.offer.geo_input  = raw;
  ctx.wizard.state.offer.geo_list   = uniq;
  ctx.wizard.state.offer.geo        = uniq;
  // флаг/множитель для последующего перерасчёта цены при сохранении оффера:
  ctx.wizard.state.offer.geo_enabled    = true;
  ctx.wizard.state.offer.geo_multiplier = 1.3; // использовать там, где считаешь финальную ставку

  await goToStep(ctx, Step.OFFER_NAME);
}

// ШАГ 7 — название оффера
async function step7(ctx) {
  if (shouldSkipCurrentUpdate(ctx)) return;
  if (isCancel(ctx)) return cancelWizard(ctx);
  if (isBack(ctx)) { await goToStep(ctx, Step.GEO_TARGETING); return; }

  const name = (getMessageText(ctx) || '').trim();
  if (!name) { await ctx.reply('Пустое название — пришлите непустую строку.'); return; }

  ctx.wizard.state.offer.title = name;
  ctx.wizard.state.offer.name  = name;

  await goToStep(ctx, Step.OFFER_SLUG);
}

// ШАГ 8 — слаг/подтверждение (начало шага)
async function step8(ctx) {
  if (shouldSkipCurrentUpdate(ctx)) return;
  if (isCancel(ctx)) return cancelWizard(ctx);
  if (isBack(ctx)) { await goToStep(ctx, Step.OFFER_NAME); return; }

  const text = (ctx.message?.text || '').trim();
  const stripped = text.replace(/[.,!…—-]+$/u, '').trim();
  const lowered = text.toLowerCase();
  const loweredStripped = stripped.toLowerCase();
  const isKeepAuto = OK_WORDS.has(lowered) || OK_WORDS.has(loweredStripped);

  const offerState = ctx.wizard.state.offer || {};
  ctx.wizard.state.autoSlug = ctx.wizard.state.autoSlug || autoSlugFromOffer(offerState);

  let candidate;

  if (isKeepAuto) {
    const sources = [ctx.wizard.state.autoSlug, autoSlugFromOffer(offerState), `offer-${Date.now()}`];
    for (const source of sources) {
      const slug = makeSlug(source);
      if (slug) {
        candidate = slug;
        break;
      }
    }
    if (!candidate) {
      candidate = makeSlug(`offer-${Date.now()}`) || `offer-${Date.now()}`;
    }
  } else {
    const slug = makeSlug(stripped || text);
    if (!slug) {
      await ctx.reply('Slug пуст или некорректен. Пришлите другой.');
      return;
    }
    candidate = slug;
  }

  const unique = await ensureUniqueSlug(candidate);
  ctx.wizard.state.offer.slug = unique;
  ctx.wizard.state.autoSlug = unique;

  await finalizeWizardAfterSlug(ctx, unique);
}

// ====================== END STEPS ======================

async function finalizeWizardAfterSlug(ctx, unique) {
  const offerState = ctx.wizard.state.offer || {};
  const baseRateRaw = Number.isFinite(Number(offerState.base_rate)) ? Number(offerState.base_rate) : null;
  const premiumRateRaw = Number.isFinite(Number(offerState.premium_rate))
    ? Number(offerState.premium_rate)
    : null;

  let payoutCents = Number.isFinite(Number(offerState.payout_cents)) ? Number(offerState.payout_cents) : null;
  if (!payoutCents && baseRateRaw != null) {
    payoutCents = Math.round(baseRateRaw * 100);
  }
  if (!payoutCents && premiumRateRaw != null) {
    payoutCents = Math.round(premiumRateRaw * 100);
  }

  const capsTotalRaw = Number.isFinite(Number(offerState.caps_total)) ? Number(offerState.caps_total) : null;
  let budgetCents = Number.isFinite(Number(offerState.budget_cents))
    ? Number(offerState.budget_cents)
    : null;
  if ((budgetCents == null || budgetCents <= 0) && payoutCents && capsTotalRaw && capsTotalRaw > 0) {
    budgetCents = payoutCents * capsTotalRaw;
  }
  if (!budgetCents && payoutCents) {
    budgetCents = payoutCents;
  }

  const geoValue = (() => {
    if (offerState.geo) return offerState.geo;
    if (offerState.geo_list) return offerState.geo_list;
    if (offerState.geo_input) return offerState.geo_input;
    return null;
  })();

  const form = {
    title: offerState.title ?? offerState.name ?? null,
    target_url: offerState.target_url,
    event_type: offerState.event_type,
    payout_cents: payoutCents ?? 0,
    budget_cents: budgetCents ?? (payoutCents ?? 0),
    geo: geoValue,
    slug: unique,
    base_rate_rub: baseRateRaw,
    base_rate_cents: baseRateRaw != null ? Math.round(baseRateRaw * 100) : null,
    premium_rate_rub: premiumRateRaw,
    premium_rate_cents: premiumRateRaw != null ? Math.round(premiumRateRaw * 100) : null,
    caps_total: capsTotalRaw,
    status: 'draft',
  };

  if (ctx.session) {
    ctx.session.form = form;
  }

  // Выставляем счёт Stars и завершаем мастер
  await finalizeOfferAndInvoiceStars(ctx, form);
  try {
    await ctx.scene.leave();
  } catch {}
}

export const adsWizardScene = new Scenes.WizardScene(
  ADS_WIZARD_ID,
  step1,
  step2,
  step3,
  step4,
  step5,
  step6,
  step7,
  step8
);

adsWizardScene.enter(initializeWizardState);

export const initializeAdsWizard = initializeWizardState;

export const startAdsWizard = (ctx, init = {}) =>
  ctx.scene.enter(ADS_WIZARD_ID, init && typeof init === 'object' ? init : {});

export default adsWizardScene;

if (typeof adsWizardScene === 'undefined' || typeof startAdsWizard !== 'function') {
  console.error('[adsWizard] bad export', { hasScene: !!adsWizardScene, hasStart: typeof startAdsWizard });
}

queueMicrotask(() => {
  console.log('[BOOT] adsWizard LOADED, id=%s', ADS_WIZARD_ID);
});
