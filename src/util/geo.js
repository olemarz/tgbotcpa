import { GEO_COUNTRIES } from '../constants/geoCountries.js';

const nameToCode = new Map();

function normalizeName(value) {
  if (!value) return '';
  return value
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\d]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function addName(name, code) {
  const normalized = normalizeName(name);
  if (!normalized) {
    return;
  }
  if (!nameToCode.has(normalized)) {
    nameToCode.set(normalized, code);
  }
}

for (const [code, names] of Object.entries(GEO_COUNTRIES)) {
  addName(names.en, code);
  addName(names.ru, code);
  if (names.en?.includes('/')) {
    names.en
      .split('/')
      .map((part) => part.replace(/&/g, ' '))
      .forEach((part) => addName(part, code));
  }
  if (names.ru?.includes('/')) {
    names.ru
      .split('/')
      .map((part) => part.replace(/&/g, ' '))
      .forEach((part) => addName(part, code));
  }
  if (names.en?.includes('&')) {
    addName(names.en.replace(/&/g, ' '), code);
  }
  if (names.ru?.includes('&')) {
    addName(names.ru.replace(/&/g, ' '), code);
  }
}

const MANUAL_SYNONYMS = {
  'u.s.a': 'US',
  usa: 'US',
  'сша': 'US',
  'соединенные штаты америки': 'US',
  'соединенные штаты': 'US',
  'рф': 'RU',
  'российская федерация': 'RU',
  'оаэ': 'AE',
  'ооэ': 'AE',
  uae: 'AE',
  'объединенные арабские эмираты': 'AE',
  'юар': 'ZA',
  'южная корея': 'KR',
  'северная корея': 'KP',
  'южная осетия': 'GE',
  'hongkong': 'HK',
  'молдова': 'MD',
  'uk': 'GB',
  'gb': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
};

for (const [name, code] of Object.entries(MANUAL_SYNONYMS)) {
  addName(name, code);
}

const CODE_PATTERN = /^[A-Z]{2}$/;

export function normalizeToISO2(input) {
  if (!input) {
    return [];
  }
  const raw = input
    .toString()
    .split(/[\n;,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const parts = raw.length > 0 ? raw : [input.toString().trim()];

  const result = [];
  const seen = new Set();

  for (const part of parts) {
    if (!part) continue;
    const compact = part.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (CODE_PATTERN.test(compact)) {
      if (!seen.has(compact)) {
        seen.add(compact);
        result.push(compact);
      }
      continue;
    }

    const normalized = normalizeName(part);
    const code = nameToCode.get(normalized);
    if (code && !seen.has(code)) {
      seen.add(code);
      result.push(code);
    }
  }

  return result;
}
