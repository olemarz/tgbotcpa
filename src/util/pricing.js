const DEFAULT_MARKUP_PERCENT = (() => {
  const raw = process.env.GEO_MARKUP_DEFAULT_PERCENT;
  if (!raw) return 0;
  const parsed = Number.parseFloat(String(raw));
  return Number.isFinite(parsed) ? parsed : 0;
})();

function parseMarkupConfig(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key.trim().toUpperCase(), Number(value)]),
      );
    }
  } catch (_error) {
    // fallback to custom delimiter-based parsing below
  }

  const result = {};
  const parts = String(raw)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const [code, percent] = part.split(':').map((token) => token.trim());
    if (!code || percent === undefined) continue;
    const numeric = Number.parseFloat(percent);
    if (!Number.isFinite(numeric)) continue;
    result[code.toUpperCase()] = numeric;
  }

  return result;
}

const GEO_MARKUP_PERCENT = (() => {
  const raw =
    process.env.GEO_MARKUP_PERCENT_JSON ||
    process.env.GEO_MARKUP_JSON ||
    process.env.GEO_MARKUP_PERCENT ||
    process.env.GEO_MARKUPS_PERCENT ||
    '';
  return parseMarkupConfig(raw);
})();

function normalizeGeoList(geo) {
  if (!geo) return [];
  if (Array.isArray(geo)) {
    return geo
      .map((value) => (typeof value === 'string' ? value.trim().toUpperCase() : ''))
      .filter(Boolean);
  }
  if (typeof geo === 'string') {
    return geo
      .split(/[,\s]+/)
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean);
  }
  return [];
}

export function adjustPayoutCents(basePayoutCents, geo) {
  const base = Number.isFinite(Number(basePayoutCents)) ? Number(basePayoutCents) : 0;
  const codes = normalizeGeoList(geo);

  let bestPercent = DEFAULT_MARKUP_PERCENT;

  for (const code of codes) {
    const percent = GEO_MARKUP_PERCENT[code];
    if (typeof percent === 'number' && Number.isFinite(percent)) {
      if (percent > bestPercent) {
        bestPercent = percent;
      }
    }
  }

  if (!bestPercent) {
    return Math.max(0, Math.round(base));
  }

  const multiplier = 1 + bestPercent / 100;
  return Math.max(0, Math.round(base * multiplier));
}

export default adjustPayoutCents;
