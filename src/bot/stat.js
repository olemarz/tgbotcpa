import { query } from '../db/index.js';
import { replyHtml, sanitizeTelegramHtml } from './html.js';

export const STAT_CALLBACK_PREFIX = 'stat:';
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
  const safe = sanitizeTelegramHtml(text);

  if (isCallback) {
    try {
      await ctx.editMessageText(safe, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: replyMarkup,
      });
    } catch (error) {
      if (error?.description !== 'Bad Request: message is not modified') throw error;
    }
    await ctx.answerCbQuery();
  } else {
    await replyHtml(ctx, text, { reply_markup: replyMarkup });
  }
}

export function registerStatHandlers(bot, { logUpdate, enableCommand = true } = {}) {
  if (!bot) {
    throw new Error('bot instance is required');
  }

  if (enableCommand) {
    bot.command('stat', async (ctx) => {
      logUpdate?.(ctx, 'stat');
      const todayKey = formatDateKey(new Date());
      await respondWithStats(ctx, todayKey);
    });
  }

  const regexp = new RegExp(`^${STAT_CALLBACK_PREFIX}(.+)$`, 'i');
  bot.action(regexp, async (ctx) => {
    logUpdate?.(ctx, 'stat:action');
    const value = ctx.match?.[1];
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
}

export const __testables = {
  formatDateKey,
  parseDateKey,
  formatDisplayDate,
  truncateText,
  buildStatKeyboard,
  computeCr,
  buildTable,
  fetchOwnedOffers,
  fetchStatsForOffers,
  buildStatsMessage,
};
