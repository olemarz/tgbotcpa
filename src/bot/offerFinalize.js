import { query } from '../db/index.js';
import { config } from '../config.js';
import { adjustPayoutCents } from '../util/pricing.js';
import { centsToXtr } from '../util/xtr.js';
import { replyHtml } from './html.js';
import { sendStarsInvoice } from './paymentsStars.js';

let offersColumnsPromise;

async function getOfferColumns() {
  if (!offersColumnsPromise) {
    offersColumnsPromise = query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'offers'`,
    ).then((res) => new Set(res.rows.map((row) => row.column_name)));
  }
  return offersColumnsPromise;
}

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

export async function finalizeOfferAndInvoiceStars(ctx, form = {}) {
  const columns = await getOfferColumns();
  const tgId = ctx.from?.id ?? null;

  const geoSource = form?.geo ?? form?.geo_input ?? form?.geo_list ?? null;
  const geoNormalized = normalizeGeoForInsert(geoSource);
  const geoForAdjust = geoNormalized.input ?? geoSource;

  const basePayoutCents = Number.isFinite(Number(form?.payout_cents))
    ? Number(form.payout_cents)
    : 0;
  const payoutAdjusted = adjustPayoutCents(basePayoutCents, geoForAdjust);

  const providedBudgetCents = Number.isFinite(Number(form?.budget_cents))
    ? Number(form.budget_cents)
    : 0;
  const normalizedBudgetCents = providedBudgetCents > 0 ? providedBudgetCents : payoutAdjusted;

  const providedBudgetXtr = Number.isFinite(Number(form?.budget_xtr))
    ? Number(form.budget_xtr)
    : null;
  const normalizedBudgetXtr =
    providedBudgetXtr && providedBudgetXtr > 0
      ? Math.floor(providedBudgetXtr)
      : centsToXtr(normalizedBudgetCents);

  const insertColumns = [];
  const values = [];
  const params = [];
  const push = (column, value) => {
    if (!columns.has(column)) return;
    insertColumns.push(column);
    values.push(value);
    params.push(`$${values.length}`);
  };

  const title = form?.title ?? form?.name ?? null;
  if (columns.has('title')) push('title', title);
  else if (columns.has('name')) push('name', title);

  if (form?.slug != null) push('slug', form.slug);

  if (columns.has('target_url')) push('target_url', form?.target_url ?? null);
  if (columns.has('target_link') && form?.target_link != null) push('target_link', form.target_link);
  if (columns.has('event_type')) push('event_type', form?.event_type ?? 'join_group');

  if (columns.has('payout_cents')) push('payout_cents', payoutAdjusted);

  const baseRateRub = Number.isFinite(Number(form?.base_rate_rub))
    ? Number(form.base_rate_rub)
    : null;
  const baseRateUnits = Number.isFinite(Number(form?.base_rate))
    ? Number(form.base_rate)
    : baseRateRub != null
    ? baseRateRub
    : Number.isFinite(Number(form?.base_rate_cents))
    ? Math.round(Number(form.base_rate_cents) / 100)
    : null;
  const baseRateCents = Number.isFinite(Number(form?.base_rate_cents))
    ? Number(form.base_rate_cents)
    : baseRateUnits != null
    ? Math.round(baseRateUnits * 100)
    : null;

  if (columns.has('base_rate')) {
    if (baseRateUnits != null) push('base_rate', baseRateUnits);
    else if (!columns.has('payout_cents')) push('base_rate', Math.round(payoutAdjusted / 100));
  }
  if (columns.has('base_rate_cents') && baseRateCents != null) push('base_rate_cents', baseRateCents);

  const premiumRateRub = Number.isFinite(Number(form?.premium_rate_rub))
    ? Number(form.premium_rate_rub)
    : null;
  const premiumRateUnits = Number.isFinite(Number(form?.premium_rate))
    ? Number(form.premium_rate)
    : premiumRateRub != null
    ? premiumRateRub
    : Number.isFinite(Number(form?.premium_rate_cents))
    ? Math.round(Number(form.premium_rate_cents) / 100)
    : null;
  const premiumRateCents = Number.isFinite(Number(form?.premium_rate_cents))
    ? Number(form.premium_rate_cents)
    : premiumRateUnits != null
    ? Math.round(premiumRateUnits * 100)
    : null;

  if (columns.has('premium_rate')) {
    if (premiumRateUnits != null) push('premium_rate', premiumRateUnits);
  }
  if (columns.has('premium_rate_cents') && premiumRateCents != null) {
    push('premium_rate_cents', premiumRateCents);
  }

  if (columns.has('caps_total') && form?.caps_total != null) push('caps_total', form.caps_total);
  if (columns.has('budget_cents')) push('budget_cents', normalizedBudgetCents);
  if (columns.has('budget_xtr')) push('budget_xtr', normalizedBudgetXtr);

  if (columns.has('geo'))
    push('geo', Array.isArray(geoNormalized.list) ? geoNormalized.list.join(',') : geoNormalized.input);
  if (columns.has('geo_input') && geoNormalized.input !== null) push('geo_input', geoNormalized.input);
  if (columns.has('geo_list') && geoNormalized.list) push('geo_list', geoNormalized.list);
  if (columns.has('geo_whitelist') && geoNormalized.list) push('geo_whitelist', geoNormalized.list);

  if (columns.has('created_by_tg')) push('created_by_tg', tgId);
  if (columns.has('created_by_tg_id')) push('created_by_tg_id', tgId);
  if (columns.has('status')) push('status', form?.status ?? 'draft');

  const sql = `
    INSERT INTO offers (id${insertColumns.length ? ',' + insertColumns.join(',') : ''})
    VALUES (gen_random_uuid()${params.length ? ',' + params.join(',') : ''})
    RETURNING id${columns.has('title') ? ', title' : ''}${
      !columns.has('title') && columns.has('name') ? ', name' : ''
    }${columns.has('budget_cents') ? ', budget_cents' : ''}${
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

  const amountInStars = Math.max(1, Math.ceil(offer.budget_xtr || centsToXtr(offer.budget_cents)));
  const payoutInStars = Math.max(1, Math.ceil(centsToXtr(payoutAdjusted)));

  const starsEnabled = String(process.env.STARS_ENABLED || '').toLowerCase() === 'true';

  if (starsEnabled) {
    await sendStarsInvoice(ctx, {
      title: `Оплата оффера: ${offer.title || offer.id}`,
      description: `Бюджет: ${amountInStars} ⭐️. Payout: ${payoutInStars} ⭐️.`,
      totalStars: amountInStars,
      payloadMeta: { offer_id: offer.id, slug: form?.slug },
    });
  } else {
    await replyHtml(
      ctx,
      `✅ Оффер создан без оплаты: <b>${form?.slug || offer.id}</b> (id=${offer.id}).\n` +
        `Бюджет: <b>${amountInStars} ⭐️</b>.`,
    );
  }

  return {
    ...offer,
    payout_cents: payoutAdjusted,
    budget_cents: offer.budget_cents,
    budget_xtr: offer.budget_xtr,
    tracking_uid: ctx.from?.id ?? null,
    base_url: config.baseUrl || process.env.BASE_URL || '',
  };
}
