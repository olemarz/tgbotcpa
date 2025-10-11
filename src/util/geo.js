const REGIONAL_INDICATOR_A = 0x1f1e6;

const GEO_GROUPS = {
  CIS: ['RU', 'BY', 'KZ'],
  WW: [],
};

const GEO_GROUP_ALIASES = new Map(
  Object.entries({
    cis: 'CIS',
    sng: 'CIS',
    'снг': 'CIS',
    'содружество независимых государств': 'CIS',
    'commonwealth of independent states': 'CIS',
    world: 'WW',
    worldwide: 'WW',
    global: 'WW',
    'весь мир': 'WW',
  })
);

const COUNTRY_ALIASES = {
  US: [
    'us',
    'usa',
    'u s a',
    'united states',
    'united states of america',
    'america',
    'сша',
    'штаты',
    'союзные штаты',
    'америка',
  ],
  RU: ['ru', 'russia', 'россия', 'рф'],
  BY: ['by', 'belarus', 'belorussia', 'беларусь', 'белоруссия'],
  KZ: ['kz', 'kazakhstan', 'kazahstan', 'казахстан'],
  UA: ['ua', 'ukraine', 'украина'],
  AM: ['am', 'armenia', 'армения'],
  AZ: ['az', 'azerbaijan', 'азербайджан'],
  KG: ['kg', 'kyrgyzstan', 'киргизия', 'кыргызстан'],
  MD: ['md', 'moldova', 'молдова'],
  TJ: ['tj', 'tajikistan', 'таджикистан'],
  TM: ['tm', 'turkmenistan', 'туркмения', 'туркменистан'],
  UZ: ['uz', 'uzbekistan', 'узбекистан'],
  IT: ['it', 'italy', 'италия'],
  DE: ['de', 'germany', 'германия'],
  FR: ['fr', 'france', 'франция'],
  ES: ['es', 'spain', 'испания'],
  GB: ['gb', 'uk', 'united kingdom', 'great britain', 'великая британия', 'англия'],
  TR: ['tr', 'turkey', 'турция'],
};

const COUNTRY_ALIAS_MAP = new Map();
for (const [code, aliases] of Object.entries(COUNTRY_ALIASES)) {
  for (const alias of aliases) {
    COUNTRY_ALIAS_MAP.set(alias, code);
  }
}

function fromFlagEmoji(value) {
  if (!value) return null;
  const chars = Array.from(value);
  if (chars.length !== 2) return null;
  const codePoints = chars.map((char) => char.codePointAt(0));
  if (codePoints.some((cp) => cp === undefined || cp < REGIONAL_INDICATOR_A || cp > REGIONAL_INDICATOR_A + 25)) {
    return null;
  }
  const letters = codePoints.map((cp) => String.fromCharCode(cp - REGIONAL_INDICATOR_A + 65));
  return letters.join('');
}

function normalizeToken(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeToISO2(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const flag = fromFlagEmoji(trimmed);
  if (flag) {
    return flag;
  }

  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const normalized = normalizeToken(trimmed);
  if (!normalized) {
    return null;
  }

  if (COUNTRY_ALIAS_MAP.has(normalized)) {
    return COUNTRY_ALIAS_MAP.get(normalized);
  }

  if (GEO_GROUP_ALIASES.has(normalized)) {
    return GEO_GROUP_ALIASES.get(normalized);
  }

  const upper = normalized.toUpperCase();
  if (GEO_GROUPS[upper]) {
    return upper;
  }

  return null;
}

export function parseGeoInput(input) {
  if (!input || typeof input !== 'string') {
    return [];
  }

  const result = new Set();
  const parts = input
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const normalized = normalizeToISO2(part);
    if (!normalized) {
      continue;
    }
    if (GEO_GROUPS[normalized]) {
      if (normalized === 'WW') {
        result.clear();
        result.add('WW');
        break;
      }
      for (const code of GEO_GROUPS[normalized]) {
        result.add(code);
      }
      continue;
    }
    if (result.has('WW')) {
      continue;
    }
    result.add(normalized);
  }

  return Array.from(result);
}

export function isAllowedByGeo(geoList, country) {
  if (!Array.isArray(geoList) || geoList.length === 0) {
    return true;
  }

  const normalizedList = new Set(geoList.map((code) => code.toUpperCase()));
  if (normalizedList.has('WW')) {
    return true;
  }

  const iso = normalizeToISO2(country ?? '');
  if (!iso) {
    return false;
  }

  if (normalizedList.has(iso)) {
    return true;
  }

  for (const [group, members] of Object.entries(GEO_GROUPS)) {
    if (normalizedList.has(group) && members.includes(iso)) {
      return true;
    }
  }

  return false;
}

export { GEO_GROUPS };
