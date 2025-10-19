let cachedMe = null;

export async function ensureBotSelf(bot) {
  if (cachedMe) return cachedMe;
  try {
    cachedMe = await bot.telegram.getMe();
    if (cachedMe?.username) {
      bot.options.username = cachedMe.username;
    }
  } catch (e) {
    console.error('[BOOT] getMe failed:', e?.message || e);
  }
  return cachedMe;
}

export function getBotSelfCached() {
  return cachedMe;
}
