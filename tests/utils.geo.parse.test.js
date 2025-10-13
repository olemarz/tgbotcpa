import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseGeoInput } from '../src/utils/geo.js';

describe('parseGeoInput', () => {
  it('normalizes ISO alpha-2 tokens to uppercase', () => {
    const result = parseGeoInput('us,ca');
    assert.deepEqual(result.valid, ['US', 'CA']);
    assert.deepEqual(result.invalid, []);
  });

  it('converts ISO alpha-3 codes to ISO alpha-2', () => {
    const result = parseGeoInput('usa, gbr');
    assert.deepEqual(result.valid, ['US', 'GB']);
    assert.deepEqual(result.invalid, []);
  });

  it('expands known geo zones', () => {
    const result = parseGeoInput('CIS');
    assert.ok(result.valid.includes('RU'));
    assert.ok(result.valid.includes('UZ'));
    assert.equal(result.valid.length, new Set(result.valid).size);
    assert.deepEqual(result.invalid, []);
  });

  it('collects unknown tokens as invalid', () => {
    const result = parseGeoInput('ZZZ');
    assert.deepEqual(result.valid, []);
    assert.deepEqual(result.invalid, ['ZZZ']);
  });
});
