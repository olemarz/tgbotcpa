// src/util/pricing.js
// Политика ценообразования из ТЗ:
// - если рекламодатель ввёл GEO из списка HIGH_GEO_LIST → цена целевого действия +30%
// - округление всегда ВВЕРХ (Math.ceil)
// - GEO может прийти как строка "US, CA" или как массив ["US","CA"]

const HIGH_GEO = (process.env.HIGH_GEO_LIST || '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

function normalizeGeo(geo) {
  if (!geo) return [];
  if (Array.isArray(geo)) {
    return geo.map((v) => String(v || '').trim().toUpperCase()).filter(Boolean);
  }
  return String(geo)
    .split(/[,\s]+/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * @param {number} baseCents - базовая цена в центах
 * @param {string|string[]} geo - GEO код(ы): "US,CA" или ["US","CA"]
 * @returns {number} скорректированная цена в центах
 */
export function adjustPayoutCents(baseCents, geo) {
  const n = Math.max(0, Number(baseCents || 0));
  if (!n) return 0;

  const codes = normalizeGeo(geo);
  if (!codes.length || !HIGH_GEO.length) return n;

  const hasHigh = codes.some((code) => HIGH_GEO.includes(code));
  if (!hasHigh) return n;

  // +30% и ВСЕГДА вверх
  return Math.ceil(n * 1.3);
}

export default adjustPayoutCents;