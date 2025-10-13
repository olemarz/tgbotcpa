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
    const result = parseGeoInput('СНГ');
    assert.deepEqual(result.valid, CIS_CODES);
    assert.deepEqual(result.invalid, []);
  });

  it('expands Europe zone aliases', () => {
    const first = parseGeoInput('Европа');
    const second = parseGeoInput('EU');
    assert.deepEqual(first.valid, EU_CODES);
    assert.deepEqual(first.invalid, []);
    assert.deepEqual(second.valid, EU_CODES);
    assert.deepEqual(second.invalid, []);
  });

  it('normalizes USA aliases', () => {
    const cyr = parseGeoInput('США');
    const lat = parseGeoInput('USA');
    assert.deepEqual(cyr.valid, ['US']);
    assert.deepEqual(cyr.invalid, []);
    assert.deepEqual(lat.valid, ['US']);
    assert.deepEqual(lat.invalid, []);
  });

  it('parses country names and ISO codes', () => {
    const names = parseGeoInput('Russia,Kazakhstan');
    const iso = parseGeoInput('DE, FR');
    assert.deepEqual(names.valid, ['RU', 'KZ']);
    assert.deepEqual(names.invalid, []);
    assert.deepEqual(iso.valid, ['DE', 'FR']);
    assert.deepEqual(iso.invalid, []);
  });

  it('marks unknown tokens as invalid', () => {
    const result = parseGeoInput('Атлантида');
    assert.deepEqual(result.valid, []);
    assert.ok(result.invalid.length > 0);
  });
});
