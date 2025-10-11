import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isAllowedByGeo, normalizeToISO2 } from '../src/util/geo.js';

describe('normalizeToISO2', () => {
  it('normalizes ISO-2 codes to uppercase', () => {
    assert.equal(normalizeToISO2('us'), 'US');
  });

  it('maps russian country names', () => {
    assert.equal(normalizeToISO2('Италия'), 'IT');
  });

  it('detects group aliases', () => {
    assert.equal(normalizeToISO2('СНГ'), 'CIS');
  });

  it('parses flag emoji tokens', () => {
    assert.equal(normalizeToISO2('🇺🇸'), 'US');
  });

  it('returns null for unknown tokens', () => {
    assert.equal(normalizeToISO2('Atlantis'), null);
  });
});

describe('isAllowedByGeo', () => {
  it('allows worldwide when list is empty', () => {
    assert.equal(isAllowedByGeo([], 'BR'), true);
    assert.equal(isAllowedByGeo(undefined, 'BR'), true);
  });

  it('allows explicit ISO matches', () => {
    assert.equal(isAllowedByGeo(['IT'], 'Италия'), true);
  });

  it('denies countries outside the list', () => {
    assert.equal(isAllowedByGeo(['IT'], 'US'), false);
  });

  it('supports group definitions', () => {
    assert.equal(isAllowedByGeo(['CIS'], 'RU'), true);
    assert.equal(isAllowedByGeo(['CIS'], 'US'), false);
  });

  it('treats WW as a wildcard', () => {
    assert.equal(isAllowedByGeo(['WW'], 'AU'), true);
  });
});
