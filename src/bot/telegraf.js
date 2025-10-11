import 'dotenv/config';
// src/bot/telegraf.js
import { Telegraf, Scenes, session } from 'telegraf';
import adsWizard from './adsWizard.js';
import { query } from '../db/index.js';
import { sendPostback } from '../services/postback.js';
import { approveJoin, createConversion } from '../services/conversion.js';
import { joinCheck } from '../services/joinCheck.js';
import { uuid, shortToken } from '../util/id.js';
import { config } from '../config.js';
import { handleAdsUserCommand, handleAdsSkip, handleAdsCheck } from './adsUserFlow.js';

// ---- Инициализация бота ----
const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is required');
}

export const bot = new Telegraf(token, {
  handlerTimeout: 10000,
});

export function logUpdate(ctx, tag = 'update') {
  const u = ctx.update || {};
  console.log('[tg]', tag, {
    types: Object.keys(u),
    from: ctx.from ? { id: ctx.from.id, is_bot: ctx.from.is_bot } : null,
    text: ctx.message?.text,
    startPayload: ctx.startPayload,
  });
}

// session — строго ДО stage
bot.use(session());

// сцены
const stage = new Scenes.Stage([adsWizard]);
bot.use(stage.middleware());

// ---- Команды ----

const JOIN_GROUP_EVENT = 'join_group';
const STAT_CALLBACK_PREFIX = 'stat:';
const STAT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
  if (!value || !STAT_DATE_RE.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDisplayDate(date) {
  try {
    return date.toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch (err) {
    return formatDateKey(date);
  }
}

function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function buildStatKeyboard(dateKey) {
  const currentDate = parseDateKey(dateKey) || new Date();
  const prev = new Date(currentDate);
  prev.setDate(currentDate.getDate() - 1);
  const next = new Date(currentDate);
  next.setDate(currentDate.getDate() + 1);
  return {
    inline_keyboard: [
      [
        { text: '〈 день', callback_data: `${STAT_CALLBACK_PREFIX}${formatDateKey(prev)}` },
        { text: 'сегодня', callback_data: `${STAT_CALLBACK_PREFIX}today` },
        { text: '〉 день', callback_data: `${STAT_CALLBACK_PREFIX}${formatDateKey(next)}` },
      ],
    ],
  };
}

function computeCr(clicks, conversions) {
  if (!clicks || clicks <= 0 || !conversions) return '0.0';
  return (Math.round((conversions / clicks) * 1000) / 10).toFixed(1);
}

function buildTable(rows, type) {
  const mapped = rows.map((row) => {
    const clicks = type === 'day' ? Number(row.day_clicks || 0) : Number(row.total_clicks || 0);
    const conversions = type === 'day' ? Number(row.day_conversions || 0) : Number(row.total_conversions || 0);
    const amountCents = type === 'day' ? Number(row.day_amount_cents || 0) : Number(row.total_amount_cents || 0);
    const spend = (amountCents || 0) / 100;
    return {
      offer_id: row.offer_id,
      title: truncateText(row.title || '', 24),
      clicks,
      conversions,
      cr: computeCr(clicks, conversions),
      spend: spend.toFixed(2),
      amount_cents: amountCents || 0,
    };
  });

  const totals = mapped.reduce(
    (acc, row) => {
      acc.clicks += row.clicks;
      acc.conversions += row.conversions;
      acc.amount_cents += row.amount_cents;
      return acc;
    },
    { clicks: 0, conversions: 0, amount_cents: 0 },
  );

  const tableRows = mapped.map((row) => ({
    offer_id: row.offer_id,
    title: row.title,
    clicks: String(row.clicks),
    conversions: String(row.conversions),
    cr: row.cr,
    spend: row.spend,
  }));

  tableRows.push({
    offer_id: '—',
    title: 'Итого',
    clicks: String(totals.clicks),
    conversions: String(totals.conversions),
    cr: computeCr(totals.clicks, totals.conversions),
    spend: (totals.amount_cents / 100).toFixed(2),
  });

  const headers = {
    offer_id: 'offer_id',
    title: 'title',
    clicks: 'clicks',
    conversions: 'conversions',
    cr: 'CR%',
    spend: 'spend',
  };

  const columns = Object.keys(headers);
  const widths = columns.reduce((acc, key) => {
    const headerWidth = headers[key].length;
    const cellWidth = tableRows.reduce((max, row) => Math.max(max, (row[key] || '').length), 0);
    acc[key] = Math.min(Math.max(headerWidth, cellWidth), key === 'title' ? 32 : 48);
    return acc;
  }, {});

  const formatRow = (row) =>
    columns
      .map((key) => {
        const value = row[key] || '';
        if (key === 'offer_id') {
          return value.toString().padEnd(widths[key]);
        }
        if (key === 'title') {
          return value.toString().padEnd(widths[key]);
        }
        return value.toString().padStart(widths[key]);
      })
      .join('  ');

  const headerLine = formatRow(headers);
  const lines = [headerLine, headerLine.replace(/./g, '—')];
  for (const row of tableRows) {
    lines.push(formatRow(row));
  }
  return `<pre>${escapeHtml(lines.join('\n'))}</pre>`;
}

async function fetchOwnedOffers(tgId) {
  if (!tgId) return [];

  try {
    const res = await query(
      `SELECT id AS offer_id, COALESCE(name, slug, id::text) AS title FROM offers WHERE owner_tg_id=$1`,
      [tgId],
    );
    if (res.rowCount) {
      return res.rows;
    }
  } catch (error) {
    if (error?.code !== '42703') {
      throw error;
    }
  }

  try {
    const res = await query(
      `
      SELECT DISTINCT ON (o.id)
        o.id AS offer_id,
        COALESCE(o.name, o.slug, o.id::text) AS title
      FROM offers o
      JOIN offer_audit_log a ON a.offer_id = o.id
      WHERE a.action = 'created' AND a.user_id = $1
      ORDER BY o.id, a.created_at DESC
    `,
      [tgId],
    );
    return res.rows;
  } catch (error) {
    if (error?.code === '42P01') {
      return [];
    }
    throw error;
  }
}

async function fetchStatsForOffers(offers, dateKey) {
  if (!offers.length) return [];
  const offerIds = offers.map((row) => row.offer_id);
  const titles = offers.map((row) => row.title || '');

  const sql = `
    WITH owner_offers AS (
      SELECT * FROM UNNEST($1::uuid[], $2::text[]) AS t(offer_id, title)
    ),
    clicks_day AS (
      SELECT offer_id, COUNT(*)::bigint AS clicks
      FROM clicks
      WHERE offer_id = ANY($1) AND created_at >= $3::date AND created_at < ($3::date + INTERVAL '1 day')
      GROUP BY offer_id
    ),
    conv_day AS (
      SELECT offer_id, COUNT(*)::bigint AS conversions, COALESCE(SUM(amount_cents),0)::bigint AS amount_cents
      FROM conversions
      WHERE offer_id = ANY($1) AND created_at >= $3::date AND created_at < ($3::date + INTERVAL '1 day')
      GROUP BY offer_id
    ),
    clicks_total AS (
      SELECT offer_id, COUNT(*)::bigint AS clicks
      FROM clicks
      WHERE offer_id = ANY($1)
      GROUP BY offer_id
    ),
    conv_total AS (
      SELECT offer_id, COUNT(*)::bigint AS conversions, COALESCE(SUM(amount_cents),0)::bigint AS amount_cents
      FROM conversions
      WHERE offer_id = ANY($1)
      GROUP BY offer_id
    )
    SELECT
      o.offer_id,
      o.title,
      COALESCE(cd.clicks, 0) AS day_clicks,
      COALESCE(cv.conversions, 0) AS day_conversions,
      COALESCE(cv.amount_cents, 0) AS day_amount_cents,
      COALESCE(ct.clicks, 0) AS total_clicks,
      COALESCE(ctv.conversions, 0) AS total_conversions,
      COALESCE(ctv.amount_cents, 0) AS total_amount_cents
    FROM owner_offers o
    LEFT JOIN clicks_day cd ON cd.offer_id = o.offer_id
    LEFT JOIN conv_day cv ON cv.offer_id = o.offer_id
    LEFT JOIN clicks_total ct ON ct.offer_id = o.offer_id
    LEFT JOIN conv_total ctv ON ctv.offer_id = o.offer_id
    ORDER BY o.title, o.offer_id
  `;

  try {
    const res = await query(sql, [offerIds, titles, dateKey]);
    return res.rows;
  } catch (error) {
    if (error?.code !== '42P01') throw error;
  }

  const fallbackSql = `
    WITH owner_offers AS (
      SELECT * FROM UNNEST($1::uuid[], $2::text[]) AS t(offer_id, title)
    ),
    clicks_day AS (
      SELECT offer_id, COUNT(*)::bigint AS clicks
      FROM clicks
      WHERE offer_id = ANY($1) AND created_at >= $3::date AND created_at < ($3::date + INTERVAL '1 day')
      GROUP BY offer_id
    ),
    clicks_total AS (
      SELECT offer_id, COUNT(*)::bigint AS clicks
      FROM clicks
      WHERE offer_id = ANY($1)
      GROUP BY offer_id
    )
    SELECT
      o.offer_id,
      o.title,
      COALESCE(cd.clicks, 0) AS day_clicks,
      0 AS day_conversions,
      0 AS day_amount_cents,
      COALESCE(ct.clicks, 0) AS total_clicks,
      0 AS total_conversions,
      0 AS total_amount_cents
    FROM owner_offers o
    LEFT JOIN clicks_day cd ON cd.offer_id = o.offer_id
    LEFT JOIN clicks_total ct ON ct.offer_id = o.offer_id
    ORDER BY o.title, o.offer_id
  `;

  const fallbackRes = await query(fallbackSql, [offerIds, titles, dateKey]);
  return fallbackRes.rows;
}

function buildStatsMessage(dateKey, rows) {
  const date = parseDateKey(dateKey) || new Date();
  const dateLabel = formatDisplayDate(date);
  const dayTable = buildTable(rows, 'day');
  const totalTable = buildTable(rows, 'total');
  return `📊 Статистика за ${dateLabel}\n${dayTable}\n\n📈 Всего\n${totalTable}`;
}

async function respondWithStats(ctx, dateKey, { isCallback } = {}) {
  const tgId = ctx.from?.id;
  if (!tgId) {
    if (isCallback) {
      await ctx.answerCbQuery('Не удалось определить пользователя');
    } else {
      await ctx.reply('Не удалось определить Telegram ID. Попробуйте ещё раз позже.');
    }
    return;
  }

  const offers = await fetchOwnedOffers(tgId);
  if (!offers.length) {
    const message = 'У вас пока нет офферов, созданных через этого бота.';
    if (isCallback) {
      await ctx.answerCbQuery('Нет офферов для отображения');
      try {
        await ctx.editMessageText(message);
      } catch (error) {
        if (error?.description !== 'Bad Request: message is not modified') throw error;
      }
    } else {
      await ctx.reply(message);
    }
    return;
  }

  const statsRows = await fetchStatsForOffers(offers, dateKey);
  const text = buildStatsMessage(dateKey, statsRows);
  const replyMarkup = buildStatKeyboard(dateKey);

  if (isCallback) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: replyMarkup });
    } catch (error) {
      if (error?.description !== 'Bad Request: message is not modified') throw error;
    }
    await ctx.answerCbQuery();
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: replyMarkup });
  }
}

export async function handleStartWithToken(ctx, rawToken) {
  const tgId = ctx.from?.id;
  const token = rawToken?.trim();

  if (!tgId) {
    console.warn('[tg] missing from.id on start token', { token });
    await ctx.reply('Не удалось определить Telegram ID. Попробуйте ещё раз позже.');
    return;
  }

  if (!token || !/^[A-Za-z0-9_-]{1,64}$/.test(token)) {
    await ctx.reply('⛔️ Неверный токен. Сгенерируйте новую ссылку или используйте /claim <TOKEN>.');
    return;
  }

  const r = await query(
    `
    SELECT c.id AS click_id, c.offer_id, c.uid, o.target_url, o.event_type
    FROM clicks c JOIN offers o ON o.id=c.offer_id
    WHERE c.start_token=$1
    LIMIT 1
  `,
    [token],
  );

  if (!r.rowCount) {
    await ctx.reply('⛔️ Ссылка устарела или неверна. Сгенерируйте новую через /ads.');
    return;
  }

  const { click_id, offer_id, uid, target_url, event_type } = r.rows[0];

  const update = await query(
    `UPDATE clicks SET tg_id=$1, used_at=NOW() WHERE id=$2 AND (tg_id IS NULL OR tg_id=$1)`,
    [tgId, click_id],
  );
  if (!update.rowCount) {
    console.warn('[tg] start token already used', { token, tgId });
    await ctx.reply('⛔️ Ссылка уже использована другим пользователем.');
    return;
  }

  await query(
    `INSERT INTO attribution (click_id, offer_id, uid, tg_id, state) VALUES ($1,$2,$3,$4,'started')`,
    [click_id, offer_id, uid ?? null, tgId],
  );

  if (event_type === JOIN_GROUP_EVENT && target_url) {
    await ctx.reply('Нажмите, чтобы вступить в группу. После вступления зафиксируем событие:', {
      reply_markup: { inline_keyboard: [[{ text: '✅ Вступить в группу', url: target_url }]] },
    });
    await ctx.reply('Новая задача доступна: /ads');
    return;
  }

  await ctx.reply('Новая задача доступна: /ads');
}

bot.start(async (ctx) => {
  logUpdate(ctx, 'start');
  let token = ctx.startPayload?.trim();
  if (!token && typeof ctx.message?.text === 'string') {
    const m = ctx.message.text.match(/^\/start(?:@[\w_]+)?\s+(\S+)$/);
    if (m) token = m[1];
  }
  if (!token) {
    return ctx.reply(
      'Это /start без параметра кампании. Нажмите ссылку из оффера или пришлите токен командой:\n/claim <TOKEN>',
    );
  }
  return handleStartWithToken(ctx, token);
});

// ручной фолбэк для QA: /claim TOKEN
bot.hears(/^\/claim\s+(\S+)/i, async (ctx) => {
  logUpdate(ctx, 'claim');
  const token = ctx.match[1];
  return handleStartWithToken(ctx, token);
});

// QA shortcut: /go OFFER_ID [uid]
bot.hears(/^\/go\s+([0-9a-f-]{36})(?:\s+(\S+))?$/i, async (ctx) => {
  logUpdate(ctx, 'go');
  const tgId = ctx.from?.id;
  if (!tgId) {
    await ctx.reply('Не удалось определить Telegram ID. Попробуйте ещё раз позже.');
    return;
  }

  const offerId = ctx.match[1];
  const uid = ctx.match[2] || 'qa';

  const offer = await query(
    `SELECT id, target_url, event_type FROM offers WHERE id=$1 LIMIT 1`,
    [offerId],
  );
  if (!offer.rowCount) {
    await ctx.reply('⛔️ Оффер не найден.');
    return;
  }

  let token = shortToken().slice(0, 32);
  for (let attempts = 0; attempts < 4; attempts += 1) {
    const exists = await query(`SELECT 1 FROM clicks WHERE start_token=$1 LIMIT 1`, [token]);
    if (!exists.rowCount) break;
    token = shortToken().slice(0, 32);
  }

  const clickId = uuid();
  try {
    await query(
      `INSERT INTO clicks (id, offer_id, uid, start_token, created_at, tg_id)
       VALUES ($1,$2,$3,$4,NOW(),$5)`,
      [clickId, offerId, uid, token, tgId],
    );
  } catch (err) {
    if (err?.code === '23505') {
      console.error('duplicate start_token on /go', { token, offerId, uid, tgId });
      await ctx.reply('⚠️ Не удалось сгенерировать токен. Попробуйте ещё раз.');
      return;
    }
    throw err;
  }

  await handleStartWithToken(ctx, token);
});

bot.command('whoami', async (ctx) => {
  try {
    await ctx.reply(`Your Telegram ID: ${ctx.from?.id}`);
  } catch (e) {
    console.error('❌ whoami send error', e);
  }
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    'Все офферы открываются через кнопку (WebApp). Если ничего не произошло — отправьте /claim <токен> из вашей ссылки.',
  );
});

bot.command('ads', async (ctx) => {
  const userId = ctx.from?.id;
  if (userId && config.adsMasters?.has(String(userId))) {
    return ctx.scene.enter('ads-wizard');
  }
  return handleAdsUserCommand(ctx);
});

bot.action(/^skip:([0-9a-f-]{36})$/i, async (ctx) => {
  if (ctx.scene?.current) {
    await ctx.answerCbQuery();
    return;
  }
  const offerId = ctx.match?.[1];
  if (!offerId) {
    await ctx.answerCbQuery();
    return;
  }
  await handleAdsSkip(ctx, offerId);
});

bot.action(/^check:([0-9a-f-]{36})$/i, async (ctx) => {
  if (ctx.scene?.current) {
    await ctx.answerCbQuery();
    return;
  }
  const offerId = ctx.match?.[1];
  if (!offerId) {
    await ctx.answerCbQuery();
    return;
  }
  await handleAdsCheck(ctx, offerId);
});

bot.command('stat', async (ctx) => {
  logUpdate(ctx, 'stat');
  const todayKey = formatDateKey(new Date());
  await respondWithStats(ctx, todayKey);
});

bot.action(/^stat:(.+)$/i, async (ctx) => {
  logUpdate(ctx, 'stat:action');
  const value = ctx.match[1];
  let date;
  if (value === 'today') {
    date = new Date();
  } else {
    date = parseDateKey(value);
  }

  if (!date) {
    await ctx.answerCbQuery('Некорректная дата');
    return;
  }

  const dateKey = formatDateKey(date);
  await respondWithStats(ctx, dateKey, { isCallback: true });
});

// эхо на любой текст (вне сцен)
bot.on('text', async (ctx, next) => {
  if (ctx.scene?.current) return next();
  if (ctx.message?.text?.startsWith('/')) return next();
  console.log('🗣 text', ctx.from?.id, '->', ctx.message?.text);
  try {
    if (!ctx.scene?.current) {
      await ctx.reply('echo: ' + ctx.message.text);
    }
  } catch (e) {
    console.error('❌ send error', e);
  }
  return next();
});

bot.on(['chat_member', 'my_chat_member'], async (ctx) => {
  logUpdate(ctx, 'chat_member');
  const upd = ctx.update.chat_member || ctx.update.my_chat_member;
  const user = upd?.new_chat_member?.user;
  const status = upd?.new_chat_member?.status;
  if (!user) return;
  if (!['member', 'administrator', 'creator'].includes(status)) return;

  const tgId = user.id;

  const r = await query(
    `
    SELECT id, click_id, offer_id, uid
    FROM attribution
    WHERE tg_id=$1 AND state='started'
      AND created_at >= NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC LIMIT 1
  `,
    [tgId],
  );
  if (!r.rowCount) return;

  const { id: attrId, click_id, offer_id, uid } = r.rows[0];
  const existing = await query(
    `SELECT id FROM events WHERE offer_id=$1 AND tg_id=$2 AND type=$3 LIMIT 1`,
    [offer_id, tgId, JOIN_GROUP_EVENT],
  );
  if (existing.rowCount) {
    await query(`UPDATE attribution SET state='converted' WHERE id=$1`, [attrId]);
    return;
  }

  await query(`INSERT INTO events(offer_id, tg_id, type) VALUES($1,$2,$3)`, [offer_id, tgId, JOIN_GROUP_EVENT]);
  const updated = await query(
    `UPDATE attribution SET state='converted' WHERE id=$1 RETURNING id`,
    [attrId],
  );

  if (!updated.rowCount) {
    return;
  }

  try {
    await sendPostback({ offer_id, tg_id: tgId, uid, click_id, event: JOIN_GROUP_EVENT });
  } catch (e) {
    console.error('postback error:', e?.message || e);
  }

  try {
    await approveJoin({ offer_id, tg_id: tgId, click_id });
  } catch (e) {
    console.error('approveJoin error:', e?.message || e);
  }
});

bot.action(/^check:([\w-]{6,64})$/i, async (ctx) => {
  logUpdate(ctx, 'check');

  const offerId = ctx.match?.[1];
  const tgId = ctx.from?.id;

  if (!offerId) {
    await ctx.answerCbQuery('⛔️ Некорректный запрос.');
    return;
  }

  if (!tgId) {
    await ctx.answerCbQuery('⛔️ Не удалось определить ваш аккаунт.');
    return;
  }

  await ctx.answerCbQuery();

  try {
    const offer = await query(
      `
        SELECT id,
               COALESCE(NULLIF(payout_cents, 0), NULLIF(premium_rate, 0), NULLIF(base_rate, 0), 0) AS payout_cents
        FROM offers
        WHERE id=$1
        LIMIT 1
      `,
      [offerId]
    );

    if (!offer.rowCount) {
      await ctx.reply('⛔️ Оффер не найден.');
      return;
    }

    const payoutCents = Number(offer.rows[0]?.payout_cents ?? 0);

    const { ok } = await joinCheck({
      offer_id: offerId,
      tg_id: tgId,
      telegram: ctx.telegram,
    });

    if (!ok) {
      await ctx.reply('Пока не видим вступления…');
      return;
    }

    try {
      await createConversion({
        offer_id: offerId,
        tg_id: tgId,
        amount_cents: payoutCents,
      });
    } catch (error) {
      console.error('createConversion error', error?.message || error);
    }

    await ctx.reply('✅ Готово!');
  } catch (error) {
    console.error('check handler error', error?.message || error);
    await ctx.reply('⚠️ Произошла ошибка. Попробуйте позже.');
  }
});

// Безопасная остановка в webhook-режиме
function safeStop(reason) {
  try {
    bot.stop(reason);
  } catch (e) {
    if (!e || e.message !== 'Bot is not running!') {
      console.error(e);
    }
  }
}

process.once('SIGINT', () => safeStop('SIGINT'));
process.once('SIGTERM', () => safeStop('SIGTERM'));
