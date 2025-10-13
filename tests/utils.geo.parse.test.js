import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseGeoInput } from '../src/utils/geo.js';

describe('parseGeoInput', () => {
  it('normalizes ISO alpha-2 tokens to uppercase', () => {
    const result = parseGeoInput('us,ca');
    assert.equal(result.ok, true);
    assert.deepEqual(result.codes, ['US', 'CA']);
    assert.deepEqual(result.invalid, []);
  });

  it('converts ISO alpha-3 codes to ISO alpha-2', () => {
    const result = parseGeoInput('usa, gbr');
    assert.equal(result.ok, true);
    assert.deepEqual(result.codes, ['US', 'GB']);
    assert.deepEqual(result.invalid, []);
  });

  it('expands known geo zones', () => {
    const result = parseGeoInput('CIS');
    assert.equal(result.ok, true);
    assert.ok(result.codes.includes('RU'));
    assert.ok(result.codes.includes('UZ'));
    assert.equal(result.codes.length, new Set(result.codes).size);
    assert.deepEqual(result.invalid, []);
  });

  it('collects unknown tokens as invalid', () => {
    const result = parseGeoInput('ZZZ');
    assert.equal(result.ok, false);
    assert.deepEqual(result.codes, []);
    assert.deepEqual(result.invalid, ['ZZZ']);
  });
});
