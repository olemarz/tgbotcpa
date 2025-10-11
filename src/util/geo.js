const englishDisplay = new Intl.DisplayNames(['en'], { type: 'region' });
const russianDisplay = new Intl.DisplayNames(['ru'], { type: 'region' });

function normalizeToken(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildIsoList() {
  const codes = [];
  for (let a = 65; a <= 90; a += 1) {
    for (let b = 65; b <= 90; b += 1) {
      const code = String.fromCharCode(a) + String.fromCharCode(b);
      const name = englishDisplay.of(code);
      if (name && name !== code) {
        codes.push(code);
      }
    }
  }
  return codes;
}

const ISO_CODES = buildIsoList();

const aliasToIso = new Map();

function addAlias(alias, code) {
  if (!alias) return;
  const normalized = normalizeToken(alias);
  if (!normalized) return;
  if (!aliasToIso.has(normalized)) {
    aliasToIso.set(normalized, code);
  }
}

for (const code of ISO_CODES) {
  addAlias(code, code);
  addAlias(englishDisplay.of(code), code);
  addAlias(russianDisplay.of(code), code);
}

const EXTRA_ALIASES = new Map([
  ['usa', 'US'],
  ['u s a', 'US'],
  ['u.s.a', 'US'],
  ['united states of america', 'US'],
  ['states', 'US'],
  ['america', 'US'],
  ['uk', 'GB'],
  ['u k', 'GB'],
  ['great britain', 'GB'],
  ['england', 'GB'],
  ['scotland', 'GB'],
  ['wales', 'GB'],
  ['northern ireland', 'GB'],
  ['uae', 'AE'],
  ['u a e', 'AE'],
  ['emirates', 'AE'],
  ['czech republic', 'CZ'],
  ['czechia', 'CZ'],
  ['republic of korea', 'KR'],
  ['south korea', 'KR'],
  ['north korea', 'KP'],
  ['ivory coast', 'CI'],
  ['cote d ivoire', 'CI'],
  ['laos', 'LA'],
  ['viet nam', 'VN'],
  ['moldova', 'MD'],
  ['bolivia', 'BO'],
  ['brunei', 'BN'],
  ['cape verde', 'CV'],
  ['caribbean netherlands', 'BQ'],
  ['congo', 'CG'],
  ['drc', 'CD'],
  ['democratic republic of the congo', 'CD'],
  ['republic of the congo', 'CG'],
  ['micronesia', 'FM'],
  ['são tomé and príncipe', 'ST'],
  ['sao tome and principe', 'ST'],
  ['st vincent', 'VC'],
  ['st kitts', 'KN'],
  ['st lucia', 'LC'],
  ['palestine', 'PS'],
  ['vatican', 'VA'],
  ['holy see', 'VA'],
  ['bahamas', 'BS'],
  ['gambia', 'GM'],
  ['myanmar', 'MM'],
  ['burma', 'MM'],
  ['timor leste', 'TL'],
  ['east timor', 'TL'],
  ['são tomé', 'ST'],
  ['sao tome', 'ST'],
  ['tanzania', 'TZ'],
  ['iran', 'IR'],
  ['syria', 'SY'],
  ['kosovo', 'XK'],
  ['hong kong', 'HK'],
  ['macau', 'MO'],
  ['macao', 'MO'],
]);

for (const [alias, code] of EXTRA_ALIASES.entries()) {
  addAlias(alias, code);
}

const PRESET_MAP = new Map([
  [
    'tier1',
    [
      'US', 'CA', 'GB', 'DE', 'FR', 'AU', 'NZ', 'SE', 'NO', 'FI', 'DK', 'NL', 'CH', 'BE', 'AT', 'IE',
      'SG', 'JP', 'KR', 'IT', 'ES',
    ],
  ],
  [
    'tier2',
    [
      'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'PT', 'GR', 'SI', 'LT', 'LV', 'EE', 'HR', 'CY', 'MT', 'IL',
      'AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'CL', 'AR', 'MX', 'BR', 'TR',
    ],
  ],
  [
    'tier3',
    [
      'ID', 'PH', 'TH', 'VN', 'MY', 'IN', 'PK', 'BD', 'CO', 'PE', 'EC', 'UY', 'PY', 'BO', 'CR', 'PA',
      'DO', 'GT', 'HN', 'NI', 'SV', 'KE', 'NG', 'ZA', 'EG', 'MA', 'TN', 'KZ', 'UA', 'BY', 'RU',
    ],
  ],
  [
    'cis',
    ['RU', 'UA', 'BY', 'KZ', 'UZ', 'KG', 'TJ', 'TM', 'AM', 'AZ', 'GE', 'MD'],
  ],
  [
    'latam',
    [
      'AR', 'BO', 'BR', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'SV', 'GT', 'HN', 'MX', 'NI', 'PA', 'PY',
      'PE', 'PR', 'UY', 'VE', 'GY', 'SR', 'BZ',
    ],
  ],
  [
    'sea',
    ['SG', 'MY', 'TH', 'ID', 'VN', 'PH', 'KH', 'LA', 'MM', 'BN', 'TL'],
  ],
  [
    'mena',
    ['AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'JO', 'LB', 'SY', 'IQ', 'IR', 'EG', 'LY', 'MA', 'TN', 'DZ', 'YE'],
  ],
  [
    'europe',
    [
      'AL', 'AD', 'AM', 'AT', 'AZ', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES',
      'FI', 'FO', 'FR', 'GB', 'GG', 'GI', 'GR', 'HR', 'HU', 'IE', 'IM', 'IS', 'IT', 'JE', 'LI', 'LT',
      'LU', 'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'RU', 'SE', 'SI',
      'SK', 'SM', 'UA', 'VA', 'XK', 'TR', 'GE', 'KZ',
    ],
  ],
  [
    'asia',
    [
      'AF', 'AM', 'AZ', 'BH', 'BD', 'BN', 'BT', 'CN', 'HK', 'IN', 'ID', 'IR', 'IQ', 'IL', 'JO', 'JP',
      'KG', 'KH', 'KP', 'KR', 'KW', 'KZ', 'LA', 'LB', 'LK', 'MM', 'MN', 'MO', 'MV', 'MY', 'NP', 'OM',
      'PH', 'PK', 'PS', 'QA', 'SA', 'SG', 'SY', 'TH', 'TJ', 'TL', 'TM', 'TR', 'TW', 'UZ', 'VN', 'YE',
    ],
  ],
  [
    'africa',
    [
      'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CM', 'CV', 'CF', 'TD', 'KM', 'CD', 'CG', 'CI', 'DJ', 'EG',
      'GQ', 'ER', 'SZ', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'LY', 'MG', 'MW', 'ML',
      'MR', 'MU', 'YT', 'MA', 'MZ', 'NA', 'NE', 'NG', 'RE', 'RW', 'SH', 'ST', 'SN', 'SC', 'SL', 'SO',
      'ZA', 'SS', 'SD', 'TZ', 'TG', 'TN', 'UG', 'EH', 'ZM', 'ZW', 'DJ',
    ],
  ],
  [
    'na',
    ['US', 'CA', 'MX'],
  ],
  [
    'south-america',
    ['AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'GY', 'PE', 'PY', 'SR', 'UY', 'VE'],
  ],
  [
    'central-america',
    ['BZ', 'CR', 'SV', 'GT', 'HN', 'NI', 'PA'],
  ],
  [
    'global',
    ISO_CODES,
  ],
  ['world', ISO_CODES],
]);

function expandPreset(value) {
  const normalized = normalizeToken(value);
  if (!normalized) return null;
  if (PRESET_MAP.has(normalized)) {
    return PRESET_MAP.get(normalized) || [];
  }
  if (normalized.startsWith('preset ')) {
    const key = normalized.slice('preset '.length);
    return PRESET_MAP.get(key) || null;
  }
  return null;
}

export function normalizeToISO2(input) {
  if (typeof input !== 'string') {
    throw new TypeError('geo_input must be a string');
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  const rawTokens = trimmed
    .split(/[\n;,]+/)
    .flatMap((chunk) => {
      const piece = chunk.trim();
      if (!piece) return [];
      if (piece.includes(' ')) {
        return [piece];
      }
      return piece.split(/\s+/);
    })
    .map((token) => token.trim())
    .filter(Boolean);

  const seen = new Set();
  const result = [];

  for (const token of rawTokens) {
    const preset = expandPreset(token);
    if (preset) {
      for (const code of preset) {
        if (!seen.has(code)) {
          seen.add(code);
          result.push(code);
        }
      }
      continue;
    }

    const normalized = normalizeToken(token);
    if (!normalized) {
      continue;
    }

    if (aliasToIso.has(normalized)) {
      const code = aliasToIso.get(normalized);
      if (code && !seen.has(code)) {
        seen.add(code);
        result.push(code);
      }
      continue;
    }

    if (/^[a-z]{2}$/i.test(token) && aliasToIso.has(token.toLowerCase())) {
      const code = aliasToIso.get(token.toLowerCase());
      if (code && !seen.has(code)) {
        seen.add(code);
        result.push(code);
        continue;
      }
    }

    throw new Error(`Unknown geo token: ${token}`);
  }

  return result;
}

export const geoPresets = PRESET_MAP;
export const isoCountryAliases = aliasToIso;
export const isoCountryCodes = ISO_CODES;
