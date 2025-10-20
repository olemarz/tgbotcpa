import { replyHtml } from './html.js';

export async function sendStarsInvoice(ctx, { title, description, totalStars, payloadMeta = {} }) {
  const disabled = String(process.env.PAYMENTS_DISABLED || '').toLowerCase() === 'true';
  if (disabled) {
    await replyHtml(
      ctx,
      `⚠️ PAYMENTS_DISABLED=true — инвойс не отправляю.\n` +
        `К оплате: <b>${Number(totalStars) || 0} ⭐</b>\n` +
        `payload: <code>${JSON.stringify({ kind: 'offer', ...payloadMeta })}</code>`,
    );
    return null;
  }

  const payloadObject = { ...payloadMeta };
  if (!payloadObject.kind) {
    payloadObject.kind = 'offer';
  }
  const payload = JSON.stringify(payloadObject);

  return ctx.replyWithInvoice({
    title: title || 'Оплата бюджета оффера',
    description: description || 'Оплата кампании в звёздах',
    currency: 'XTR',
    prices: [{ label: 'Budget', amount: Number(totalStars) }],
    payload,
    provider_token: '',
    start_parameter: 'offer_budget',
    is_flexible: false,
  });
}
