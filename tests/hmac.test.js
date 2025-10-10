import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hmacSHA256Hex } from '../src/util/hmac.js';

describe('hmacSHA256Hex', () => {
  it('creates stable signatures', () => {
    const payload = JSON.stringify({ hello: 'world' });
    const secret = 'test-secret';
    const signature = hmacSHA256Hex(payload, secret);
    assert.equal(signature, '84cc33df716ed0b0598f07437c94069ace3730358778a592bd6bbd1423d111f3');
  });
});
