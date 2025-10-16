// +30% для выделенных GEO, округление всегда вверх
const HIGH_GEO = (process.env.HIGH_GEO_LIST || '')
  .split(',')
  .map(s => s.trim().toUpperCase())
  .filter(Boolean);

/**
 * Корректирует payout в центах:
 * - если geo ∈ HIGH_GEO → *1.3 и Math.ceil
 * - иначе — без изменений
 */
export function adjustPayoutCents(baseCents, geo) {
  const n = Math.max(0, Number(baseCents || 0));
  const g = String(geo || '').trim().toUpperCase();
  if (!g || HIGH_GEO.length === 0) return n;
  if (!HIGH_GEO.includes(g)) return n;
  const bumped = n * 1.3;
  return Math.ceil(bumped);
}
