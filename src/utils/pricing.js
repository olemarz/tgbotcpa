// src/utils/pricing.js
import { config } from '../config.js';

export function parseGeoList(geo) {
  if (!geo) return [];
  return String(geo)
    .toUpperCase()
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function getGeoMarkupPercent(geo) {
  const list = parseGeoList(geo);
  if (list.length === 0 || list.includes('ANY')) return 0;
  let max = 0;
  for (const c of list) {
    const p = Number(config.geoMarkupPercent?.[c] ?? 0);
    if (p > max) max = p;
  }
  return max;
}

/**
 * Рассчитать выплату с учётом GEO
 */
export function adjustedPayout(base, geo) {
  const b = Number(base) || 0;
  const pct = getGeoMarkupPercent(geo);
  const raw = b * (1 + pct / 100);
  const payout = Math.ceil(raw);
  return { payout, pct };
}

/**
 * Итоговая смета оффера
 */
export function quoteOffer(base, caps, geo) {
  const { payout, pct } = adjustedPayout(base, geo);
  const totalCaps = Math.max(0, Number(caps) || 0);
  const budget = payout * totalCaps;
  return { payout, budget, pct, totalCaps };
}
