import type { Request } from 'express';

type GeoMode = string | null | undefined;
type GeoList = readonly string[] | string | null | undefined;

type CountryCode = string | null | undefined;

function normalizeCountry(country: CountryCode): string | null {
  if (!country) {
    return null;
  }
  const trimmed = String(country).trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toUpperCase();
}

function normalizeGeoList(list: GeoList): string[] {
  if (!list) {
    return [];
  }
  if (Array.isArray(list)) {
    return list
      .map((item) => String(item || '').trim().toUpperCase())
      .filter((item) => item.length > 0);
  }

  if (typeof list === 'string') {
    const trimmed = list.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item || '').trim().toUpperCase())
          .filter((item) => item.length > 0);
      }
    } catch (_error) {
      // ignore JSON parse errors — fall back to comma/space separated parsing
    }

    return trimmed
      .split(/[\s,;]+/)
      .map((item) => item.trim().toUpperCase())
      .filter((item) => item.length > 0);
  }

  return [];
}

function normalizeGeoMode(mode: GeoMode): string {
  if (!mode) {
    return 'any';
  }
  return String(mode).trim().toLowerCase();
}

export function isAllowedByGeo(country: CountryCode, mode: GeoMode, list: GeoList): boolean {
  const normalizedCountry = normalizeCountry(country);
  const normalizedList = normalizeGeoList(list);
  const normalizedMode = normalizeGeoMode(mode);

  if (normalizedMode === 'disabled' || normalizedMode === 'off' || normalizedMode === 'any') {
    return true;
  }

  if (!normalizedList.length) {
    return true;
  }

  if (normalizedMode === 'allow' || normalizedMode === 'whitelist' || normalizedMode === 'include') {
    if (!normalizedCountry) {
      return false;
    }
    return normalizedList.includes(normalizedCountry);
  }

  if (normalizedMode === 'deny' || normalizedMode === 'blacklist' || normalizedMode === 'exclude') {
    if (!normalizedCountry) {
      return true;
    }
    return !normalizedList.includes(normalizedCountry);
  }

  return true;
}

export type GeoCheckContext = {
  offerId: string;
  country: string | null;
  mode: GeoMode;
  list: GeoList;
  ip: string | null;
  req?: Request;
};

export type GeoCheckResult = {
  allowed: boolean;
  context: GeoCheckContext;
};

export function checkGeoAccess(country: CountryCode, mode: GeoMode, list: GeoList, context: GeoCheckContext): GeoCheckResult {
  const allowed = isAllowedByGeo(country, mode, list);
  return {
    allowed,
    context: {
      ...context,
      country: normalizeCountry(country),
      mode,
      list,
    },
  };
}
