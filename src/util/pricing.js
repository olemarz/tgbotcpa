// src/util/pricing.js
const HIGH_GEO = (process.env.HIGH_GEO_LIST || '')
  .split(',')
  .map(s => s.trim().toUpperCase())
  .filter(Boolean);

/**
 * Возвращает скорректированную цену в центах:
 * - если GEO входит в HIGH_GEO → +30%, округление вверх до целых центов
 * - иначе без изменений
 * @param {number} baseCents
 * @param {string|null} geo e.g. "US", "USA", "DE", "UA"
 */
export function adjustPayoutCents(baseCents, geo) {
  const n = Math.max(0, Number(baseCents || 0));
  const g = String(geo || '').trim().toUpperCase();
  if (!g || HIGH_GEO.length === 0) return n;
  if (!HIGH_GEO.includes(g)) return n;
  const bumped = n * 1.3;
  return Math.ceil(bumped); // всегда вверх
}
