import { query } from '../db/index.js';
import { adjustPayoutCents } from '../util/pricing.js';
import { centsToXtr } from '../util/xtr.js';

let offersColumnsPromise;

/**
 * Кэшируем набор колонок таблицы offers, чтобы корректно формировать INSERT
 */
async function getOfferColumns() {
  if (!offersColumnsPromise) {
    offersColumnsPromise = query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'offers'`,
    ).then((res) => new Set(res.rows.map((row) => row.column_name)));
  }
  return offersColumnsPromise;
}

/**
 * Нормализация GEO для вставки (строка/список)
 */
function normalizeGeoForInsert(geo) {
  const list = (() => {
    if (!geo) return [];
    if (Array.isArray(geo)) {
      return geo
        .map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : ''))
        .filter(Boolean);
    }
    if (typeof geo === 'string') {
      return geo
        .split(/[,\s]+/)
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean);
    }
    return [];
  })();

  const geoInput = list.length ? list.join(',') : null;
  return { list: list.length ? list : null, input: geoInput };
}

/**
 * Создаёт оффер в БД и выставляет инвойс в Telegram Stars
 */
export async function finalizeOfferAndInvoiceStars(ctx, form = {}) {
  const columns = await getOfferColumns();
  const tgId = ctx.from?.id ?? null;

  // 1) База для payout и его корректировка по GEO (+30%, ceil — внутри adjustPayoutCents)
  const basePayoutCents = Number.isFinite(Number(form?.payout_cents))
    ? Number(form.payout_cents)
    : 0;

  const geo = form?.geo ?? null;
  const payoutAdjusted = adjustPayoutCents(basePayoutCents, geo);

  // 2) Бюджет: если явный бюджет не пришёл, используем скорректированный payout
  const providedBudgetCents = Number.isFinite(Number(form?.budget_cents))
    ? Number(form.budget_cents)
    : 0;

  const normalizedBudgetCents =
    providedBudgetCents > 0 ? providedBudgetCents : payoutAdjusted;

  // 3) Бюджет в XTR — если пришёл целый, берём его; иначе переводим из центов
  const providedBudgetXtr = Number.isFinite(Number(form?.budget_xtr))
    ? Number(form.budget_xtr)
    : null;

  const normalizedBudgetXtr =
    providedBudgetXtr && providedBudgetXtr > 0
      ? Math.floor(providedBudgetXtr)
      : centsToXtr(normalizedBudgetCents);

  // Подготовка INSERT
  const insertColumns = [];
  const values = [];
  const params = [];
  const push = (column, value) => {
    if (!columns.has(column)) return;
    insertColumns.push(column);
    values.push(value);
    params.push(`$${values.length}`);
  };

  // Заголовок
  const title = form?.title ?? form?.name ?? null;
  if (columns.has('title')) push('title', title);
  else if (columns.has('name')) push('name', title);

  // Прочие поля
  if (form?.slug != null) push('slug', form.slug);

  if (columns.has('target_url')) push('target_url', form?.target_url ?? null);
  if (columns.has('target_link') && form?.target_link != null)
    push('target_link', form.target_link);

  if (columns.has('event_type'))
    push('event_type', form?.event_type ?? 'join_group');

  if (columns.has('payout_cents')) push('payout_cents', payoutAdjusted);

  // Ставки (поддержка и в рублях, и в центах — в зависимости от схемы БД)
  const baseRateRub = Number.isFinite(Number(form?.base_rate_rub))
    ? Number(form.base_rate_rub)
    : Number.isFinite(Number(form?.base_rate))
    ? Number(form.base_rate)
    : null;

  const baseRateCents = Number.isFinite(Number(form?.base_rate_cents))
    ? Number(form.base_rate_cents)
    : baseRateRub != null
    ? Math.round(baseRateRub * 100)
    : null;

  if (columns.has('base_rate')) {
    if (baseRateCents != null) push('base_rate', baseRateCents);
    else if (baseRateRub != null) push('base_rate', baseRateRub);
    else if (!columns.has('payout_cents'))
      push('base_rate', Math.round(payoutAdjusted / 100));
  }

  const premiumRateRub = Number.isFinite(Number(form?.premium_rate_rub))
    ? Number(form.premium_rate_rub)
    : Number.isFinite(Number(form?.premium_rate))
    ? Number(form.premium_rate)
    : null;

  const premiumRateCents = Number.isFinite(Number(form?.premium_rate_cents))
    ? Number(form.premium_rate_cents)
    : premiumRateRub != null
    ? Math.round(premiumRateRub * 100)
    : null;

  if (columns.has('premium_rate')) {
    if (premiumRateCents != null) push('premium_rate', premiumRateCents);
    else if (premiumRateRub != null) push('premium_rate', premiumRateRub);
  }

  // Капы/бюджет
  if (columns.has('caps_total') && form?.caps_total != null)
    push('caps_total', form.caps_total);

  if (columns.has('budget_cents')) push('budget_cents', normalizedBudgetCents);
  if (columns.has('budget_xtr')) push('budget_xtr', normalizedBudgetXtr);

  // GEO
  const geoNorm = normalizeGeoForInsert(geo);
  if (columns.has('geo'))
    push('geo', Array.isArray(geoNorm.list) ? geoNorm.list.join(',') : geoNorm.input);
  if (columns.has('geo_input') && geoNorm.input !== null)
    push('geo_input', geoNorm.input);
  if (columns.has('geo_list') && geoNorm.list)
    push('geo_list', geoNorm.list);
  if (columns.has('geo_whitelist') && geoNorm.list)
    push('geo_whitelist', geoNorm.list);

  // Служебные
  if (columns.has('created_by_tg')) push('created_by_tg', tgId);
  if (columns.has('created_by_tg_id')) push('created_by_tg_id', tgId);
  if (columns.has('status')) push('status', form?.status ?? 'draft');

  // INSERT
  const sql = `
    INSERT INTO offers (id${insertColumns.length ? ',' + insertColumns.join(',') : ''})
    VALUES (gen_random_uuid()${params.length ? ',' + params.join(',') : ''})
    RETURNING id${
      columns.has('title') ? ', title' : ''
    }${
      !columns.has('title') && columns.has('name') ? ', name' : ''
    }${
      columns.has('budget_cents') ? ', budget_cents' : ''
    }${
      columns.has('budget_xtr') ? ', budget_xtr' : ''
    }
  `;
  const ins = await query(sql, values);
  const row = ins.rows[0] || {};

  const offer = {
    id: row.id,
    title: row.title ?? row.name ?? title ?? row.id,
    budget_cents: columns.has('budget_cents')
      ? row.budget_cents ?? normalizedBudgetCents
      : normalizedBudgetCents,
    budget_xtr: columns.has('budget_xtr')
      ? row.budget_xtr ?? normalizedBudgetXtr
      : normalizedBudgetXtr,
  };

  // ==== Инвойс в Stars ====
  // Всегда округляем ВВЕРХ до целых звёзд
  const amountInStars = Math.max(
    1,
    Math.ceil(offer.budget_xtr || centsToXtr(offer.budget_cents)),
  );

  const payoutInStars = Math.max(1, Math.ceil(centsToXtr(payoutAdjusted)));

  await ctx.replyWithInvoice({
    title: `Оплата оффера: ${offer.title || offer.id}`,
    // Только звёзды в описании — без "₽"
    description: `Бюджет: ${amountInStars} ⭐️. Payout: ${payoutInStars} ⭐️.`,
    payload: String(offer.id),

    // Для Telegram Stars токен не нужен
    provider_token: '',
    currency: 'XTR',

    // Количество — целое число XTR
    prices: [{ label: 'Budget', amount: amountInStars }],
    start_parameter: String(offer.id),
  });

  return offer;
}
