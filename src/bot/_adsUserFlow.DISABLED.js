throw new Error('FATAL: old adsUserFlow imported. Remove all imports.');

import fs from 'node:fs/promises';
import path from 'node:path';
import { query } from '../db/index.js';
import { uuid } from '../util/id.js';
import { normalizeToISO2, isAllowedByGeo as isGeoAllowed } from '../util/geo.js';
import { sendPostback } from '../services/postback.js';

const LOG_PATH = path.join(process.cwd(), 'var', 'links.log');
const JOIN_GROUP_EVENT = 'join_group';

let offersColumnsPromise;
async function getOffersColumns() {
  if (!offersColumnsPromise) {
    offersColumnsPromise = query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'offers'`
    ).then((res) => new Set(res.rows.map((row) => row.column_name)));
  }
  return offersColumnsPromise;
}

function ensureSession(ctx) {
  if (!ctx.session) {
    // telegraf session middleware guarantees object, but double-check
    ctx.session = {};
  }
  if (!ctx.session.adsUser) {
    ctx.session.adsUser = {
      seen: [],
      country: null,
    };
  }
  if (!Array.isArray(ctx.session.adsUser.seen)) {
    ctx.session.adsUser.seen = [];
  }
  return ctx.session.adsUser;
}

const LANGUAGE_COUNTRY_MAP = new Map(
  [
    ['ru', 'RU'],
    ['uk', 'UA'],
    ['be', 'BY'],
    ['kk', 'KZ'],
    ['kz', 'KZ'],
    ['uz', 'UZ'],
    ['az', 'AZ'],
    ['hy', 'AM'],
    ['ka', 'GE'],
    ['it', 'IT'],
    ['de', 'DE'],
    ['fr', 'FR'],
    ['es', 'ES'],
    ['pt', 'PT'],
    ['tr', 'TR'],
    ['tg', 'TJ'],
    ['tk', 'TM'],
    ['ky', 'KG'],
    ['uz-uz', 'UZ'],
    ['ru-ru', 'RU'],
    ['uk-ua', 'UA'],
    ['az-az', 'AZ'],
    ['tr-tr', 'TR'],
  ].map(([lang, country]) => [lang.toLowerCase(), country])
);

const SUPPORTED_COUNTRY_CODES = new Set(LANGUAGE_COUNTRY_MAP.values());

function resolveUserCountry(ctx) {
  const session = ensureSession(ctx);
  if (session.country) {
    return session.country;
  }
  const sessionGeo = ctx.session?.geo_country || ctx.session?.geoCountry || ctx.session?.geo?.country;
  if (typeof sessionGeo === 'string') {
    const isoFromSession = normalizeToISO2(sessionGeo);
    if (isoFromSession) {
      session.country = isoFromSession;
      return session.country;
    }
  }
  const langCode = ctx.from?.language_code;
  if (typeof langCode === 'string' && langCode.trim()) {
    const normalized = langCode.trim().toLowerCase();
    const direct = LANGUAGE_COUNTRY_MAP.get(normalized);
    if (direct) {
      session.country = direct;
      return session.country;
    }
    const parts = normalized.split(/[-_]/);
    if (parts.length === 2) {
      const regionIso = normalizeToISO2(parts[1]);
      if (regionIso && SUPPORTED_COUNTRY_CODES.has(regionIso)) {
        session.country = regionIso;
        return session.country;
      }
    }
    const iso = normalizeToISO2(langCode);
    if (iso && SUPPORTED_COUNTRY_CODES.has(iso)) {
      session.country = iso;
      return session.country;
    }
  }
  return null;
}

function normalizeGeoList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item : String(item || '')).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter(Boolean);
  }
  return [];
}

function isOfferAllowedForCountry(offer, country) {
  const mode = (offer.geo_mode || 'any').toLowerCase();
  const list = normalizeGeoList(offer.geo_list);

  if (!list.length || mode === 'any' || mode === 'disabled' || mode === 'off') {
    return true;
  }

  if (!country) {
    return mode !== 'whitelist' && mode !== 'include' && mode !== 'allow';
  }

  if (mode === 'whitelist' || mode === 'allow' || mode === 'include') {
    return isGeoAllowed(list, country);
  }

  if (mode === 'blacklist' || mode === 'deny' || mode === 'exclude') {
    return !isGeoAllowed(list, country);
  }

  return true;
}

async function fetchCandidateOffers(excludeIds = []) {
  const columns = await getOffersColumns();
  const selectParts = ['id', 'name', 'event_type'];
  if (columns.has('description')) {
    selectParts.push('description');
  }
  selectParts.push('target_url');
  if (columns.has('target_link')) {
    selectParts.push('target_link');
  }
  if (columns.has('geo_mode')) {
    selectParts.push('geo_mode');
  }
  if (columns.has('geo_list')) {
    selectParts.push('geo_list');
  }
  if (columns.has('chat_ref')) {
    selectParts.push('chat_ref');
  }

  const conditions = [`event_type = '${JOIN_GROUP_EVENT}'`];
  if (columns.has('status')) {
    conditions.push(`status = 'active'`);
  }
  if (columns.has('target_link')) {
    conditions.push(`target_link IS NOT NULL AND target_link <> ''`);
  } else {
    conditions.push(`target_url IS NOT NULL AND target_url <> ''`);
  }

  const params = [];
  if (excludeIds.length) {
    params.push(excludeIds);
    conditions.push(`id <> ALL($${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const text = `
    SELECT ${selectParts.join(', ')}
    FROM offers
    ${where}
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 20
  `;
  const result = await query(text, params);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name || 'Без названия',
    description: row.description || null,
    target_link: row.target_link || row.target_url,
    geo_mode: row.geo_mode || 'any',
    geo_list: row.geo_list || [],
    chat_ref: row.chat_ref || null,
  }));
}

function buildOfferText(offer) {
  const parts = [`<b>${offer.name || 'Оффер'}</b>`];
  if (offer.description) {
    parts.push(offer.description);
  }
  return parts.join('\n\n');
}

async function appendLinkLog({ tgId, offerId, targetLink }) {
  if (!tgId || !offerId || !targetLink) {
    return;
  }
  const dir = path.dirname(LOG_PATH);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      console.error('[adsUserFlow] mkdir failed', error);
      return;
    }
  }
  const line = `${new Date().toISOString()},${tgId},${offerId},${targetLink}\n`;
  try {
    await fs.appendFile(LOG_PATH, line, 'utf8');
  } catch (error) {
    console.error('[adsUserFlow] append log failed', error);
  }
}

async function showOfferCard(ctx, offer, { edit } = {}) {
  const text = buildOfferText(offer);
  const keyboard = {
    inline_keyboard: [
      [{ text: 'Открыть оффер', url: offer.target_link }],
      [
        { text: '🔄 Проверить', callback_data: `check:${offer.id}` },
        { text: '⏭ Пропустить', callback_data: `skip:${offer.id}` },
      ],
    ],
  };

  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: keyboard,
      });
    } catch (error) {
      console.warn('[adsUserFlow] edit message failed, fallback to reply', error?.message);
      await ctx.reply(text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: keyboard,
      });
    }
  } else {
    await ctx.reply(text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: keyboard,
    });
  }

  await appendLinkLog({ tgId: ctx.from?.id, offerId: offer.id, targetLink: offer.target_link });
}

async function findNextOffer(ctx, exclude) {
  const country = resolveUserCountry(ctx);
  const candidates = await fetchCandidateOffers(exclude);
  for (const offer of candidates) {
    if (isOfferAllowedForCountry(offer, country)) {
      return offer;
    }
  }
  return null;
}

export async function handleAdsUserCommand(ctx) {
  const session = ensureSession(ctx);
  session.seen = [];
  session.currentOfferId = null;

  const offer = await findNextOffer(ctx, session.seen);
  if (!offer) {
    await ctx.reply('На сейчас задач нет');
    return;
  }

  session.currentOfferId = offer.id;
  session.seen.push(offer.id);
  await showOfferCard(ctx, offer, { edit: false });
}

export async function handleAdsSkip(ctx, offerId) {
  const session = ensureSession(ctx);
  if (offerId && !session.seen.includes(offerId)) {
    session.seen.push(offerId);
  }
  session.currentOfferId = null;
  await ctx.answerCbQuery('Пропускаем');

  const next = await findNextOffer(ctx, session.seen);
  if (!next) {
    const message = 'На сейчас задач нет';
    if (ctx.callbackQuery?.message) {
      try {
        await ctx.editMessageText(message, { reply_markup: { inline_keyboard: [] } });
      } catch (error) {
        console.warn('[adsUserFlow] edit on empty offers failed', error?.message);
        await ctx.reply(message);
      }
    } else {
      await ctx.reply(message);
    }
    return;
  }

  session.currentOfferId = next.id;
  if (!session.seen.includes(next.id)) {
    session.seen.push(next.id);
  }
  await showOfferCard(ctx, next, { edit: true });
}

async function ensureAttribution(offerId, tgId) {
  const existing = await query(
    `
      SELECT id, click_id, uid, state
      FROM attribution
      WHERE offer_id = $1 AND tg_id = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [offerId, tgId]
  );

  if (existing.rowCount) {
    return existing.rows[0];
  }

  const inserted = await query(
    `INSERT INTO attribution (id, offer_id, tg_id, state, created_at)
     VALUES ($1, $2, $3, 'started', NOW())
     RETURNING id, click_id, uid, state`,
    [uuid(), offerId, tgId]
  );
  return inserted.rows[0];
}

async function registerJoinConversion({ offerId, tgId, attribution }) {
  const existingEvent = await query(
    `SELECT id FROM events WHERE offer_id = $1 AND tg_id = $2 AND event_type = $3 LIMIT 1`,
    [offerId, tgId, JOIN_GROUP_EVENT]
  );
  if (existingEvent.rowCount) {
    const eventId = existingEvent.rows[0].id;
    console.log('[EVENT] saved', { event_id: eventId, event_type: JOIN_GROUP_EVENT, offer_id: offerId, tg_id: tgId });
    return { already: true };
  }

  const inserted = await query(
    `INSERT INTO events(offer_id, tg_id, event_type) VALUES($1,$2,$3) RETURNING id`,
    [offerId, tgId, JOIN_GROUP_EVENT]
  );
  const eventId = inserted.rows[0]?.id;
  console.log('[EVENT] saved', { event_id: eventId, event_type: JOIN_GROUP_EVENT, offer_id: offerId, tg_id: tgId });
  await query(`UPDATE attribution SET state='converted' WHERE click_id=$1`, [attribution.click_id]);

  try {
    await sendPostback({
      offer_id: offerId,
      event_id: eventId,
      event_type: JOIN_GROUP_EVENT,
      tg_id: tgId,
      uid: attribution.uid ?? null,
      click_id: attribution.click_id ?? null,
    });
  } catch (error) {
    console.error('[adsUserFlow] postback error', error?.message || error);
  }

  return { already: false };
}

function resolveChatIdentifier(chatRef) {
  if (!chatRef) {
    return null;
  }
  if (chatRef.username) {
    const username = chatRef.username.startsWith('@') ? chatRef.username : `@${chatRef.username}`;
    return username;
  }
  if (chatRef.id) {
    return chatRef.id;
  }
  return null;
}

export async function handleAdsCheck(ctx, offerId) {
  await ctx.answerCbQuery();

  const tgId = ctx.from?.id;
  if (!tgId) {
    await ctx.reply('Не удалось определить ваш Telegram ID. Попробуйте позже.');
    return;
  }

  const columns = await getOffersColumns();
  const selectParts = ['id', 'name', 'target_url', 'chat_ref'];
  if (columns.has('target_link')) {
    selectParts.push('target_link');
  }

  const offerRes = await query(
    `
      SELECT ${selectParts.join(', ')}
      FROM offers
      WHERE id = $1
      LIMIT 1
    `,
    [offerId]
  );

  if (!offerRes.rowCount) {
    await ctx.reply('Оффер не найден или больше не активен.');
    return;
  }

  const offer = offerRes.rows[0];
  const chatRef = offer.chat_ref || null;
  const chatId = resolveChatIdentifier(chatRef);

  if (!chatId) {
    await ctx.reply('У этого оффера отсутствует информация о чате для проверки.');
    return;
  }

  let member;
  try {
    member = await ctx.telegram.getChatMember(chatId, tgId);
  } catch (error) {
    const description = error?.response?.description || error?.message || '';
    console.warn('[adsUserFlow] getChatMember failed', { offerId, tgId, description });
    if (error?.response?.error_code === 400) {
      await ctx.reply(
        '⚠️ Не удалось проверить участие. Если это приватный канал, напомните рекламодателю добавить бота как наблюдателя.'
      );
      return;
    }
    throw error;
  }

  const status = member?.status;
  if (!['member', 'administrator', 'creator'].includes(status)) {
    await ctx.reply('Пока не видим вступления. Проверьте, что вы подписаны и попробуйте позже.');
    return;
  }

  const attribution = await ensureAttribution(offerId, tgId);
  const result = await registerJoinConversion({ offerId, tgId, attribution });

  if (result.already) {
    await ctx.reply('Мы уже засчитали это вступление ранее. Спасибо!');
  } else {
    await ctx.reply('✅ Вступление засчитано, спасибо!');
  }
}
