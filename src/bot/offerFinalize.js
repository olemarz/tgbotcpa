export async function finalizeOfferAndInvoiceStars(ctx, form = {}) {
  const module = await import('./telegraf.js');
  const finalize = module?.finalizeOfferAndInvoiceStars;
  if (typeof finalize !== 'function') {
    throw new Error('finalizeOfferAndInvoiceStars implementation missing');
  }
  return finalize(ctx, form);
}
