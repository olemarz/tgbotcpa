import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTargetLink } from '../src/utils/tgLinks.js';

describe('normalizeTargetLink', () => {
  it('parses https links and strips query params', () => {
    const link = normalizeTargetLink('https://t.me/example_channel?utm_source=test');
    assert.deepEqual(link, { type: 'public', username: 'example_channel' });
  });

  it('supports tg://resolve scheme', () => {
    const link = normalizeTargetLink('tg://resolve?domain=ExampleBot&start=foo');
    assert.deepEqual(link, { type: 'public', username: 'ExampleBot' });
  });

  it('supports invite links with + prefix', () => {
    const link = normalizeTargetLink('https://t.me/+AbCdEf123456');
    assert.deepEqual(link, { type: 'invite', invite: 'AbCdEf123456' });
  });

  it('supports joinchat invite links', () => {
    const link = normalizeTargetLink('https://t.me/joinchat/AAAAAE2Y-foo_bar');
    assert.deepEqual(link, { type: 'invite', invite: 'AAAAAE2Y-foo_bar' });
  });

  it('rejects non-telegram hosts', () => {
    const link = normalizeTargetLink('https://example.com/some-channel');
    assert.equal(link, null);
  });

  it('rejects paths without identifiers', () => {
    const link = normalizeTargetLink('https://t.me/');
    assert.equal(link, null);
  });

  it('rejects invalid usernames', () => {
    const link = normalizeTargetLink('tg://resolve?domain=@bad name');
    assert.equal(link, null);
  });
});
