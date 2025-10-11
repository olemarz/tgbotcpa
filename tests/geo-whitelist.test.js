import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseGeoInput } from '../src/utils/geo.js';

const CIS_CODES = ['RU', 'BY', 'UA', 'KZ', 'KG', 'AM', 'AZ', 'MD', 'TM', 'TJ', 'UZ'];
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
];

describe('parseGeoInput', () => {
  it('expands CIS zone', () => {
    assert.deepEqual(parseGeoInput('СНГ'), CIS_CODES);
  });

  it('expands Europe zone aliases', () => {
    assert.deepEqual(parseGeoInput('Европа'), EU_CODES);
    assert.deepEqual(parseGeoInput('EU'), EU_CODES);
  });

  it('normalizes USA aliases', () => {
    assert.deepEqual(parseGeoInput('США'), ['US']);
    assert.deepEqual(parseGeoInput('USA'), ['US']);
  });

  it('parses country names and ISO codes', () => {
    assert.deepEqual(parseGeoInput('Russia,Kazakhstan'), ['RU', 'KZ']);
    assert.deepEqual(parseGeoInput('DE, FR'), ['DE', 'FR']);
  });

  it('throws on unknown tokens', () => {
    assert.throws(() => parseGeoInput('Атлантида'), /Не удалось распознать/);
  });
});
