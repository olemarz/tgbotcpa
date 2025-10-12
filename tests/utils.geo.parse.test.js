import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseGeoInput } from '../src/utils/geo.js';

describe('parseGeoInput', () => {
  it('normalizes ISO alpha-2 tokens to uppercase', () => {
    assert.deepEqual(parseGeoInput('us,ca'), ['US', 'CA']);
  });

  it('converts ISO alpha-3 codes to ISO alpha-2', () => {
    assert.deepEqual(parseGeoInput('usa, gbr'), ['US', 'GB']);
  });

  it('expands known geo zones', () => {
    const result = parseGeoInput('CIS');
    assert.ok(result.includes('RU'));
    assert.ok(result.includes('UZ'));
    assert.equal(result.length, new Set(result).size);
  });

  it('throws for unknown tokens', () => {
    assert.throws(() => parseGeoInput('ZZZ'), /Не удалось распознать гео/);
  });
});
