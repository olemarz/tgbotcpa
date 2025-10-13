export async function handleAdsUserCommand(ctx) {
  try {
    await ctx.reply?.('На сейчас задач нет');
  } catch (error) {
    console.error('[adsUserFlow] stub reply failed', error?.message || error);
  }
}
