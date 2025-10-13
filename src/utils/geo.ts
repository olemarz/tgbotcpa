import type { Request } from 'express';
import { ISO_ALPHA3_TO_ALPHA2 } from './iso3166.js';

type GeoMode = string | null | undefined;
type GeoList = readonly string[] | string | null | undefined;

type CountryCode = string | null | undefined;

const CIS_CODES = ['RU', 'BY', 'UA', 'KZ', 'KG', 'AM', 'AZ', 'MD', 'TM', 'TJ', 'UZ'] as const;
const EU_CODES = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  'GB',
  'CH',
  'NO',
] as const;

const COUNTRY_ALIASES = new Map<string, string>(
  Object.entries({
    RU: ['ru', 'russia', 'россия', 'рф'],
    KZ: ['kz', 'kazakhstan', 'казахстан'],
    US: ['us', 'usa', 'united states', 'соединенные штаты', 'сша', 'штаты'],
    UA: ['ua', 'ukraine', 'украина'],
    BY: ['by', 'belarus', 'беларусь', 'белоруссия'],
    KG: ['kg', 'kyrgyzstan', 'кыргызстан', 'киргизия'],
    AM: ['am', 'armenia', 'армения'],
    AZ: ['az', 'azerbaijan', 'азербайджан'],
    MD: ['md', 'moldova', 'молдова'],
    TM: ['tm', 'turkmenistan', 'туркменистан', 'туркмения'],
    TJ: ['tj', 'tajikistan', 'таджикистан'],
    UZ: ['uz', 'uzbekistan', 'узбекистан'],
    DE: ['de', 'germany', 'германия'],
    FR: ['fr', 'france', 'франция'],
  })
    .flatMap(([code, aliases]) => aliases.map((alias) => [alias, code]))
);

const ZONE_MAP = {
  CIS: CIS_CODES,
  EU: EU_CODES,
  US: ['US'] as const,
} as const;

const ISO2_CODES = new Set<string>(Object.values(ISO_ALPHA3_TO_ALPHA2));
for (const codes of Object.values(ZONE_MAP)) {
  for (const code of codes) {
    ISO2_CODES.add(code);
  }
}

const ZONE_ALIASES = new Map<string, keyof typeof ZONE_MAP>(
  Object.entries({
    CIS: ['cis', 'sng', 'снг', 'содружество независимых государств'],
    EU: ['eu', 'europe', 'europa', 'европа', 'евросоюз'],
    US: ['usa', 'us', 'штаты', 'сша', 'united states'],
  })
    .flatMap(([zone, aliases]) => aliases.map((alias) => [alias, zone as keyof typeof ZONE_MAP]))
);

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

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapAliasToCodes(token: string): readonly string[] | null {
  const normalized = normalizeToken(token);
  if (!normalized) {
    return null;
  }

  if (ZONE_ALIASES.has(normalized)) {
    const zone = ZONE_ALIASES.get(normalized);
    return zone ? ZONE_MAP[zone] : null;
  }

  if (COUNTRY_ALIASES.has(normalized)) {
    const code = COUNTRY_ALIASES.get(normalized);
    return code ? [code] : null;
  }

  return null;
}

export interface GeoParseResult {
  ok: boolean;
  codes: string[];
  invalid: string[];
}

export function parseGeoInput(input: string): GeoParseResult {
  if (typeof input !== 'string') {
    return { ok: true, codes: [], invalid: [] };
  }

  const tokens = String(input)
    .split(/[^\p{L}\p{N}]+/u)
    .map((part) => part.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return { ok: true, codes: [], invalid: [] };
  }

  const valid = new Set<string>();
  const invalid = new Set<string>();
  let hasAllToken = false;

  for (const token of tokens) {
    const upper = token.toUpperCase();
    if (upper === 'ALL') {
      hasAllToken = true;
      continue;
    }

    let codes: readonly string[] = [];

    if (ZONE_MAP[upper as keyof typeof ZONE_MAP]) {
      codes = ZONE_MAP[upper as keyof typeof ZONE_MAP];
    } else if (upper.length === 2 && ISO2_CODES.has(upper)) {
      codes = [upper];
    } else if (upper.length === 3) {
      const iso2 = ISO_ALPHA3_TO_ALPHA2[upper as keyof typeof ISO_ALPHA3_TO_ALPHA2];
      if (iso2) {
        codes = [iso2];
      }
    } else {
      const mapped = mapAliasToCodes(token);
      if (mapped && mapped.length) {
        codes = mapped;
      }
    }

    if (!codes.length) {
      invalid.add(upper);
      continue;
    }

    let hasValid = false;
    for (const code of codes) {
      const isoCode = code.toUpperCase();
      if (ISO2_CODES.has(isoCode)) {
        valid.add(isoCode);
        hasValid = true;
      } else {
        invalid.add(isoCode);
      }
    }

    if (!hasValid) {
      invalid.add(upper);
    }
  }

  if (invalid.size > 0) {
    return { ok: false, codes: Array.from(valid), invalid: Array.from(invalid) };
  }

  if (hasAllToken) {
    return { ok: true, codes: [], invalid: [] };
  }

  return { ok: true, codes: Array.from(valid), invalid: [] };
}
